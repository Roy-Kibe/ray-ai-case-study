"""Assemble the n8n workflow JSON files from the Code-node sources in src/.

Run:  python build_workflow.py
Out:  RAY_Lead_Engine.json              the main daily workflow
      RAY_Lead_Engine_Error_Alert.json  emails you if the main workflow crashes
In n8n: Workflows > Import from File (once per file).

The JavaScript lives in src/*.js so it can be read, diffed and tested locally
(see test/run_local.js). Edit the .js files, rebuild, re-import.
No credentials are stored here: nodes reference credentials by name and you
pick them in n8n after importing.
"""
import json
import uuid
from pathlib import Path

HERE = Path(__file__).parent
SHEET_ID = "1qs8KZSVPqFrMvPLQ9kXMcUAyStUmYLxjEu0-Vt5EMPk"
SHEET_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit"
GSHEETS_CRED = {"googleSheetsOAuth2Api": {"name": "Google Sheets - RAY"}}
ANTHROPIC_CRED = {"anthropicApi": {"name": "Anthropic - RAY"}}
GMAIL_CRED = {"gmailOAuth2": {"name": "Gmail - RAY"}}
TIMEZONE = "Africa/Nairobi"  # the daily schedule runs at 7am in this timezone

LEADS_COLUMNS = [
    "Job Posting URL", "Job Title", "Company Name", "Location", "Job Description",
    "LLM-Generated Outreach Message", "Fit Score", "Why it matched", "Status", "Date Found",
    "Follow-up Date", "Language Requirements", "Expires", "Prompt Version", "Source", "Notes",
]
REJECTED_COLUMNS = ["Date", "Job Posting URL", "Job Title", "Company Name", "Source", "Failed Check", "Reason"]
RUNLOG_COLUMNS = ["Run Time", "Status", "Jobs Fetched", "After Pre-filter", "Classified", "New Leads",
                  "Rejected", "Duplicates Skipped", "Errors"]


def js(name):
    return (HERE / "src" / name).read_text(encoding="utf-8").replace("__SHEET_URL__", SHEET_URL)


def node(name, type_, version, position, parameters, **extra):
    return {
        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"ray-lead-engine/{name}")),  # stable across rebuilds
        "name": name,
        "type": type_,
        "typeVersion": version,
        "position": position,
        "parameters": parameters,
        **extra,
    }


def sticky(name, position, width, height, content):
    return node(name, "n8n-nodes-base.stickyNote", 1, position,
                {"content": content, "width": width, "height": height})


def code(name, position, file, **extra):
    return node(name, "n8n-nodes-base.code", 2, position, {"jsCode": js(file)}, **extra)


def sheet_ref(tab):
    return {
        "documentId": {"__rl": True, "mode": "id", "value": SHEET_ID},
        "sheetName": {"__rl": True, "mode": "name", "value": tab},
    }


def read_tab(name, position, tab):
    # executeOnce: read the tab once, not once per incoming item.
    # alwaysOutputData: an empty tab still lets the run continue.
    return node(name, "n8n-nodes-base.googleSheets", 4.7, position,
                {"operation": "read", **sheet_ref(tab), "options": {}},
                credentials=GSHEETS_CRED, executeOnce=True, alwaysOutputData=True)


def write_tab(name, position, tab, columns, match_on=None):
    # Auto-maps item fields to columns by header name; extra fields (e.g. `kind`) are ignored.
    # RAW keeps values exactly as written (dates stay "2026-12-25").
    schema = [{"id": c, "displayName": c, "required": False, "defaultMatch": False, "display": True,
               "type": "string", "canBeUsedToMatch": True} for c in columns]
    return node(name, "n8n-nodes-base.googleSheets", 4.7, position, {
        "operation": "appendOrUpdate" if match_on else "append",
        **sheet_ref(tab),
        "columns": {
            "mappingMode": "autoMapInputData",
            "value": {},
            "matchingColumns": [match_on] if match_on else [],
            "schema": schema,
            "attemptToConvertTypes": False,
            "convertFieldsToString": False,
        },
        "options": {"cellFormat": "RAW", "handlingExtraData": "ignoreIt"},
    }, credentials=GSHEETS_CRED)


def claude_call(name, position, headers_from_item=False, batch=3, timeout=120000):
    params = {
        "method": "POST",
        "url": "https://api.anthropic.com/v1/messages",
        "authentication": "predefinedCredentialType",
        "nodeCredentialType": "anthropicApi",
        "sendHeaders": True,
        "sendBody": True,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify($json.body) }}",
        "options": {"batching": {"batch": {"batchSize": batch, "batchInterval": 1000}}, "timeout": timeout},
    }
    if headers_from_item:
        params.update({"specifyHeaders": "json", "jsonHeaders": "={{ JSON.stringify($json.headers) }}"})
    else:
        params["headerParameters"] = {"parameters": [{"name": "anthropic-version", "value": "2023-06-01"}]}
    return node(name, "n8n-nodes-base.httpRequest", 4.2, position, params, credentials=ANTHROPIC_CRED,
                onError="continueRegularOutput", retryOnFail=True, maxTries=3, waitBetweenTries=5000)


def condition(left):
    return {
        "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2},
        "conditions": [{
            "id": str(uuid.uuid5(uuid.NAMESPACE_URL, left)),
            "leftValue": left,
            "rightValue": "",
            "operator": {"type": "boolean", "operation": "true", "singleValue": True},
        }],
        "combinator": "and",
    }


def if_node(name, position, left):
    return node(name, "n8n-nodes-base.if", 2.2, position, {"conditions": condition(left), "options": {}})


def route_rule(kind):
    return {
        "outputKey": kind,
        "renameOutput": True,
        "conditions": {
            "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2},
            "conditions": [{
                "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"route/{kind}")),
                "leftValue": "={{ $json.kind }}",
                "rightValue": kind,
                "operator": {"type": "string", "operation": "equals"},
            }],
            "combinator": "and",
        },
    }


# ---------------------------------------------------------------------------
# Main workflow
# ---------------------------------------------------------------------------
nodes = [
    sticky("Sticky: Stage A", [-40, -330], 1100, 250,
           "## A. Fetch & pre-filter\n"
           "Runs daily at 7am (or manually). Reads **Settings** from the Google Sheet, fetches jobs "
           "from Himalayas and Arbeitnow (1 request/second, retries on failure), standardizes the "
           "fields, removes duplicates, and applies cheap rule-based checks (age, title, agency "
           "blocklist, remote, English)."),
    node("Run manually", "n8n-nodes-base.manualTrigger", 1, [0, -60], {}),
    node("Daily at 7am", "n8n-nodes-base.scheduleTrigger", 1.2, [0, 100],
         {"rule": {"interval": [{"field": "days", "triggerAtHour": 7}]}}),
    node("Read Settings", "n8n-nodes-base.googleSheets", 4.7, [220, 20],
         {"operation": "read", **sheet_ref("Settings"), "options": {}}, credentials=GSHEETS_CRED),
    code("Build Config", [440, 20], "01_build_config.js"),
    node("Fetch Jobs", "n8n-nodes-base.httpRequest", 4.2, [660, 20], {
        "url": "={{ $json.url }}",
        "sendHeaders": True,
        "headerParameters": {"parameters": [{"name": "User-Agent", "value": "RAY-Lead-Engine/1.0"}]},
        "options": {"batching": {"batch": {"batchSize": 1, "batchInterval": 1000}}, "timeout": 30000},
    }, onError="continueRegularOutput", retryOnFail=True, maxTries=3, waitBetweenTries=2000),
    code("Normalize & Pre-filter", [880, 20], "02_normalize_prefilter.js", alwaysOutputData=True),

    sticky("Sticky: Stage B", [1080, -330], 1560, 250,
           "## B. AI checks (Claude Haiku)\n"
           "Skips jobs already in **Leads** or **Rejected** (no repeat AI calls, no duplicate rows). "
           "Claude judges each new job (remote, English, relevant, real company vs agency) and returns "
           "strict JSON with a fit score and 2-3 concrete hooks. **Apply AI Decision** turns judgments "
           "into keep/reject using the Settings tab. Failed AI answers are rejected as "
           "*AI check failed*, never lost."),
    read_tab("Read Leads", [1100, 20], "Leads"),
    read_tab("Read Rejected", [1320, 20], "Rejected"),
    code("Skip Known Jobs", [1540, 20], "03_skip_known.js", alwaysOutputData=True),
    if_node("New candidates?", [1760, 20], "={{ !!$json.job_url }}"),
    code("Build AI Check", [1980, -80], "04_build_ai_check.js"),
    claude_call("AI Check (Claude)", [2200, -80]),
    code("Apply AI Decision", [2420, -80], "05_apply_ai_decision.js"),

    sticky("Sticky: Stage C", [2620, -330], 1340, 250,
           "## C. Outreach messages (Claude Sonnet)\n"
           "Uses the **Active** prompt from the **Prompts** tab (switch tone without touching this "
           "workflow). Fixed guardrails are added in code: only facts from the posting and the RAY "
           "pitch, no invented claims, no placeholders. Each lead is added to **Leads** with its "
           "message, fit score and prompt version."),
    read_tab("Read Prompts", [2640, -80], "Prompts"),
    code("Build Outreach", [2860, -80], "06_build_outreach.js", alwaysOutputData=True),
    if_node("Any leads to write?", [3080, -80], "={{ !!$json.body }}"),
    claude_call("Write Outreach (Claude)", [3300, -180], headers_from_item=True, batch=2, timeout=180000),
    code("Prepare Lead Rows", [3520, -180], "07_prepare_lead_rows.js"),
    write_tab("Add to Leads", [3740, -180], "Leads", LEADS_COLUMNS),

    sticky("Sticky: Stage D", [3940, 0], 760, 620,
           "## D. Wrap-up (every run)\n"
           "Every path ends here, so this runs even when there are no new leads.\n\n"
           "- **Rejected**: AI rejections plus meaningful rule rejections (agency, not remote, not "
           "English), upserted by URL (no duplicates)\n"
           "- **Run Log**: one row per run with counts and warnings\n"
           "- **Expired**: untouched leads past their expiry are marked *Expired* and their job text "
           "cleared (Himalayas API terms)\n"
           "- **Daily summary** email with the top new leads\n\n"
           "Crashes are emailed by the separate *RAY Lead Engine: Error Alert* workflow."),
    code("Summarize Run", [3960, 240], "08_summarize_run.js"),
    node("Route", "n8n-nodes-base.switch", 3.2, [4180, 240], {
        "rules": {"values": [route_rule(k) for k in ("rejected", "runlog", "expired", "digest")]},
        "options": {},
    }),
    write_tab("Log Rejections", [4440, 100], "Rejected", REJECTED_COLUMNS, match_on="Job Posting URL"),
    write_tab("Log Run", [4440, 240], "Run Log", RUNLOG_COLUMNS),
    write_tab("Mark Expired Leads", [4440, 380], "Leads", ["Job Posting URL", "Status", "Job Description"],
              match_on="Job Posting URL"),
    node("Send Daily Summary", "n8n-nodes-base.gmail", 2.1, [4440, 520], {
        "resource": "message",
        "operation": "send",
        "sendTo": "={{ $json.to }}",
        "subject": "={{ $json.subject }}",
        "emailType": "html",
        "message": "={{ $json.html }}",
        "options": {"appendAttribution": False},
    }, credentials=GMAIL_CRED),
]


def link(*names):
    return {a: {"main": [[{"node": b, "type": "main", "index": 0}]]} for a, b in zip(names, names[1:])}


def to(*names):
    return [{"node": n, "type": "main", "index": 0} for n in names]


connections = {}
connections.update(link("Run manually", "Read Settings"))
connections.update(link("Daily at 7am", "Read Settings"))
connections.update(link("Read Settings", "Build Config", "Fetch Jobs", "Normalize & Pre-filter",
                        "Read Leads", "Read Rejected", "Skip Known Jobs"))
connections["New candidates?"] = {"main": [to("Build AI Check"), to("Summarize Run")]}
connections.update(link("Skip Known Jobs", "New candidates?"))
connections.update(link("Build AI Check", "AI Check (Claude)", "Apply AI Decision", "Read Prompts",
                        "Build Outreach", "Any leads to write?"))
connections["Any leads to write?"] = {"main": [to("Write Outreach (Claude)"), to("Summarize Run")]}
connections.update(link("Write Outreach (Claude)", "Prepare Lead Rows", "Add to Leads", "Summarize Run"))
connections.update(link("Summarize Run", "Route"))
connections["Route"] = {"main": [to("Log Rejections"), to("Log Run"), to("Mark Expired Leads"),
                                 to("Send Daily Summary")]}

workflow = {
    "name": "RAY Lead Engine",
    "nodes": nodes,
    "connections": connections,
    "settings": {"executionOrder": "v1", "timezone": TIMEZONE},
    "pinData": {},
}

# ---------------------------------------------------------------------------
# Error-alert workflow (set it as the main workflow's Error Workflow in n8n)
# ---------------------------------------------------------------------------
alert_code = """// Build the alert email. The recipient comes from Settings ("Send error alerts to");
// if the Settings tab itself can't be read, the fallback address below is used.
const FALLBACK_TO = 'roygithara6@gmail.com';
let to = FALLBACK_TO;
for (const { json: r } of $input.all()) {
  if (String(r.ID ?? '').trim() === 'alert_to' && String(r['Your choice'] ?? '').trim()) {
    to = String(r['Your choice']).trim();
  }
}
const err = $('Error Trigger').first().json;
const ex = err.execution || {};
const wf = err.workflow || {};
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const message = (ex.error && ex.error.message) || 'Unknown error';
const html = `<div style="font-family:Arial,sans-serif;font-size:14px">
  <h3 style="margin:0 0 8px;color:#b91c1c">${esc(wf.name || 'A workflow')} failed</h3>
  <p><b>Error:</b> ${esc(message)}</p>
  <p><b>Failed at node:</b> ${esc(ex.lastNodeExecuted || 'unknown')}</p>
  ${ex.url ? `<p><a href="${esc(ex.url)}">Open the failed execution in n8n</a></p>` : ''}
  <p style="color:#666">See the Troubleshooting section of the README for common fixes.</p>
</div>`;
return [{ json: { to, subject: `[Alert] ${wf.name || 'Workflow'} failed`, html } }];
"""

error_nodes = [
    node("Error Trigger", "n8n-nodes-base.errorTrigger", 1, [0, 0], {}),
    node("Read Settings", "n8n-nodes-base.googleSheets", 4.7, [220, 0],
         {"operation": "read", **sheet_ref("Settings"), "options": {}},
         credentials=GSHEETS_CRED, onError="continueRegularOutput", alwaysOutputData=True),
    node("Build Alert", "n8n-nodes-base.code", 2, [440, 0], {"jsCode": alert_code}),
    node("Send Alert", "n8n-nodes-base.gmail", 2.1, [660, 0], {
        "resource": "message",
        "operation": "send",
        "sendTo": "={{ $json.to }}",
        "subject": "={{ $json.subject }}",
        "emailType": "html",
        "message": "={{ $json.html }}",
        "options": {"appendAttribution": False},
    }, credentials=GMAIL_CRED),
]
error_workflow = {
    "name": "RAY Lead Engine: Error Alert",
    "nodes": error_nodes,
    "connections": link("Error Trigger", "Read Settings", "Build Alert", "Send Alert"),
    "settings": {"executionOrder": "v1", "timezone": TIMEZONE},
    "pinData": {},
}

for filename, wf in [("RAY_Lead_Engine.json", workflow), ("RAY_Lead_Engine_Error_Alert.json", error_workflow)]:
    (HERE / filename).write_text(json.dumps(wf, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Saved {filename} ({len([n for n in wf['nodes'] if 'stickyNote' not in n['type']])} nodes)")
