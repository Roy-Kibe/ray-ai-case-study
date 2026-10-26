"""Assemble the n8n workflow JSON from the Code-node sources in src/.

Run:  python build_workflow.py
Out:  RAY_Lead_Engine.json  -> in n8n: Workflows > Import from File

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
GSHEETS_CRED = {"googleSheetsOAuth2Api": {"name": "Google Sheets - RAY"}}


def js(name):
    return (HERE / "src" / name).read_text(encoding="utf-8")


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


def sheet_ref(tab):
    return {
        "documentId": {"__rl": True, "mode": "id", "value": SHEET_ID},
        "sheetName": {"__rl": True, "mode": "name", "value": tab},
    }


nodes = [
    node("Sticky: Stage A", "n8n-nodes-base.stickyNote", 1, [-40, -260], {
        "content": (
            "## Stage A: fetch & pre-filter\n"
            "Reads **Settings** from the Google Sheet, fetches jobs from Himalayas and Arbeitnow "
            "(1 request/second, retries on failure), standardizes the fields, removes duplicates, "
            "and applies cheap rule-based checks (age, title, agency blocklist, remote, English).\n\n"
            "**True** branch = candidates for the AI checks (Stage B).\n"
            "**False** branch = rejected, with `failed_check` + `reason`."
        ),
        "height": 220, "width": 560,
    }),
    node("Run manually", "n8n-nodes-base.manualTrigger", 1, [0, 0], {}),
    node("Read Settings", "n8n-nodes-base.googleSheets", 4.7, [220, 0], {
        "operation": "read",
        **sheet_ref("Settings"),
        "options": {},
    }, credentials=GSHEETS_CRED),
    node("Build Config", "n8n-nodes-base.code", 2, [440, 0], {
        "jsCode": js("01_build_config.js"),
    }),
    node("Fetch Jobs", "n8n-nodes-base.httpRequest", 4.2, [660, 0], {
        "url": "={{ $json.url }}",
        "sendHeaders": True,
        "headerParameters": {"parameters": [{"name": "User-Agent", "value": "RAY-Lead-Engine/1.0"}]},
        "options": {
            "batching": {"batch": {"batchSize": 1, "batchInterval": 1000}},
            "timeout": 30000,
        },
    }, onError="continueRegularOutput", retryOnFail=True, maxTries=3, waitBetweenTries=2000),
    node("Normalize & Pre-filter", "n8n-nodes-base.code", 2, [880, 0], {
        "jsCode": js("02_normalize_prefilter.js"),
    }),
    node("Passed pre-filter?", "n8n-nodes-base.if", 2.2, [1100, 0], {
        "conditions": {
            "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 2},
            "conditions": [{
                "id": "passed-check",
                "leftValue": "={{ $json.passed }}",
                "rightValue": "",
                "operator": {"type": "boolean", "operation": "true", "singleValue": True},
            }],
            "combinator": "and",
        },
        "options": {},
    }),
]


def link(*names):
    return {a: {"main": [[{"node": b, "type": "main", "index": 0}]]} for a, b in zip(names, names[1:])}


connections = link("Run manually", "Read Settings", "Build Config", "Fetch Jobs", "Normalize & Pre-filter", "Passed pre-filter?")

workflow = {
    "name": "RAY Lead Engine",
    "nodes": nodes,
    "connections": connections,
    "settings": {"executionOrder": "v1"},
    "pinData": {},
}

out = HERE / "RAY_Lead_Engine.json"
out.write_text(json.dumps(workflow, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"Saved {out.name} ({len(nodes)} nodes)")
