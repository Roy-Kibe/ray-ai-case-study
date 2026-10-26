// Run the workflow's Code nodes locally against saved data, without n8n.
//
// Usage:
//   node run_local.js [--live] <fixtures_dir> <api_response.json> [more_responses.json ...]
//
// fixtures_dir must contain settings.json and prompts.json: the Settings and Prompts
// tabs as arrays of row objects keyed by header (see make_fixtures.py).
// Each api_response.json = one raw response body from Himalayas or Arbeitnow.
//
// Claude calls are MOCKED by default (free, tests the plumbing and edge cases).
// --live calls the real Anthropic API with ANTHROPIC_API_KEY from the environment.
// MAX_NEW_LEADS=<n> overrides that setting, to exercise the daily cap.
// The daily summary email is written to <fixtures_dir>/digest.html for viewing.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

// Mimics an n8n Code node: top-level `return`, `$input.all()`, `$('Node').first()/.all()/.itemMatching()`.
// Like n8n, referencing a node that didn't run throws.
function runCodeNode(file, inputItems, nodeOutputs) {
  const code = fs.readFileSync(path.join(SRC, file), 'utf8').replace('__SHEET_URL__', 'https://docs.google.com/spreadsheets/d/TEST/edit');
  const $input = { all: () => inputItems, first: () => inputItems[0] };
  const $ = (name) => {
    const items = nodeOutputs[name];
    if (!items) throw new Error(`Node "${name}" hasn't been executed`);
    return { all: () => items, first: () => items[0], itemMatching: (i) => items[i] };
  };
  return new Function('$input', '$', code)($input, $);
}
// n8n's alwaysOutputData: an empty output becomes one empty item.
const always = (items) => (items.length ? items : [{ json: {} }]);

// ---- Mock Claude: plausible answers plus deliberate edge cases -------------
function mockCheck(body, index) {
  const posting = body.messages[0].content;
  const title = (posting.match(/Job title: (.*)/) || [])[1] || '';
  if (index === 1) return { error: { message: 'mock: 529 overloaded' } };
  if (index === 2) return { stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"is_rem' }] };
  const agency = /our client|the client is|clients? (in|across|based)|we place|talent pool/i.test(posting);
  const offRole = /graphic|legal|litigation|customer service|dispatch|real estate|human resources/i.test(title);
  const senior = /ceo|founder|chief of staff|executive/i.test(title);
  const answer = {
    is_remote: true, english_ok: true,
    other_languages_required: /spanish/i.test(title) ? ['Spanish'] : [],
    relevant: !offRole, is_agency_or_recruiter: agency,
    agency_evidence: agency ? 'mock: "our client"' : '', hiring_company: '',
    fit_score: agency || offRole ? 20 : senior ? 85 : 55,
    hooks: ['mock hook 1', 'mock hook 2'], reason: 'mock reason',
  };
  return { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(answer) }] };
}

function mockWrite(body, index) {
  if (index === 0) return { error: { message: 'mock: writer failed' } };
  const email = { subject: 'Mock subject line', body: `Hi there,\n\n${body.messages[0].content.slice(0, 80)}...\n\nRoy Githara\nRAY AI` };
  return { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(email) }] };
}

async function liveClaude(body, headers = { 'anthropic-version': '2023-06-01' }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, ...headers },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return res.ok ? json : { error: json };
}

// ---- Pipeline (mirrors the n8n graph) --------------------------------------
async function runPipeline({ fixtures, responses, live, readLeads, label }) {
  console.log(`\n========== ${label} ==========`);
  const out = {};
  const settings = read(path.join(fixtures, 'settings.json'));
  if (process.env.MAX_NEW_LEADS) settings.find((r) => r.ID === 'max_new_leads')['Your choice'] = Number(process.env.MAX_NEW_LEADS);

  out['Build Config'] = runCodeNode('01_build_config.js', settings.map((json) => ({ json })), out);
  out['Fetch Jobs'] = responses.map((f) => ({ json: read(f) }));
  out['Normalize & Pre-filter'] = always(runCodeNode('02_normalize_prefilter.js', out['Fetch Jobs'], out));
  const jobs = out['Normalize & Pre-filter'].filter((j) => j.json.job_url);
  console.log(`Fetched & normalized: ${jobs.length} jobs, ${jobs.filter((j) => j.json.passed).length} passed the pre-filter`);

  out['Read Leads'] = always(readLeads);
  out['Read Rejected'] = always([]);
  out['Skip Known Jobs'] = always(runCodeNode('03_skip_known.js', out['Read Rejected'], out));
  const candidates = out['Skip Known Jobs'].filter((i) => i.json.job_url); // "New candidates?" true branch
  console.log(`New candidates: ${candidates.length}`);

  if (candidates.length) {
    out['Build AI Check'] = runCodeNode('04_build_ai_check.js', candidates, out);
    const checks = [];
    for (const [i, { json }] of out['Build AI Check'].entries()) checks.push({ json: live ? await liveClaude(json.body) : mockCheck(json.body, i) });
    out['AI Check (Claude)'] = checks;
    out['Apply AI Decision'] = runCodeNode('05_apply_ai_decision.js', checks, out);
    const d = out['Apply AI Decision'].map((i) => i.json);
    console.log(`AI decision: ${d.filter((j) => j.qualified).length} qualified, ${d.filter((j) => !j.qualified).length} rejected`);

    out['Read Prompts'] = read(path.join(fixtures, 'prompts.json')).map((json) => ({ json }));
    out['Build Outreach'] = always(runCodeNode('06_build_outreach.js', out['Read Prompts'], out));
    const toWrite = out['Build Outreach'].filter((i) => i.json.body); // "Any leads to write?" true branch
    if (toWrite.length) {
      const b = toWrite[0].json;
      console.log(`Build Outreach: ${toWrite.length} requests | prompt ${b.prompt_id} | model ${b.body.model} | headers ${JSON.stringify(b.headers)}`);
      const writes = [];
      for (const [i, { json }] of toWrite.entries()) writes.push({ json: live ? await liveClaude(json.body, json.headers) : mockWrite(json.body, i) });
      out['Write Outreach (Claude)'] = writes;
      out['Prepare Lead Rows'] = runCodeNode('07_prepare_lead_rows.js', writes, out);
      out['Add to Leads'] = out['Prepare Lead Rows'];
    }
  }

  const summary = runCodeNode('08_summarize_run.js', [{ json: {} }], out).map((i) => i.json);
  const byKind = (k) => summary.filter((s) => s.kind === k);
  const leads = out['Prepare Lead Rows'] ? out['Prepare Lead Rows'].map((i) => i.json) : [];

  console.log(`\nLeads tab: +${leads.length} rows`);
  for (const r of leads.slice(0, live ? 50 : 3)) {
    console.log(`  [${r['Fit Score']}] ${r['Company Name']} | ${r['Job Title']} | prompt ${r['Prompt Version']}${r.Notes ? ` | NOTE: ${r.Notes}` : ''}`);
    if (r['LLM-Generated Outreach Message']) console.log('      ' + r['LLM-Generated Outreach Message'].replace(/\n/g, '\n      '));
  }
  console.log(`Rejected tab: ${byKind('rejected').length} rows (by check: ${JSON.stringify(byKind('rejected').reduce((a, r) => ({ ...a, [r['Failed Check']]: (a[r['Failed Check']] || 0) + 1 }), {}))})`);
  if (live) byKind('rejected').forEach((r) => console.log(`  [${r['Failed Check']}] ${r['Company Name']} | ${r['Job Title']} -> ${String(r.Reason).slice(0, 150)}`));
  console.log(`Expired leads marked: ${byKind('expired').length} ${JSON.stringify(byKind('expired'))}`);
  console.log(`Run Log: ${JSON.stringify(byKind('runlog')[0])}`);
  const digest = byKind('digest')[0];
  console.log(`Daily summary: ${digest ? `to ${digest.to} | "${digest.subject}"` : 'none'}`);
  if (digest) fs.writeFileSync(path.join(fixtures, 'digest.html'), digest.html);
}

(async () => {
  const args = process.argv.slice(2);
  const live = args[0] === '--live';
  if (live) args.shift();
  const [fixtures, ...responses] = args;
  if (!fixtures || !responses.length) {
    console.error('Usage: node run_local.js [--live] <fixtures_dir> <api_response.json> [...]');
    process.exit(1);
  }
  if (live && !process.env.ANTHROPIC_API_KEY) {
    console.error('--live needs ANTHROPIC_API_KEY in the environment');
    process.exit(1);
  }

  // Scenario 1: a normal day. The Leads tab already holds one expired, untouched lead.
  const expiredLead = { json: { 'Job Posting URL': 'https://example.com/old-job', Status: 'New', Expires: '2026-01-31', row_number: 2 } };
  await runPipeline({ fixtures, responses, live, readLeads: [expiredLead], label: 'Scenario 1: normal day' });

  // Scenario 2: a quiet day. Every candidate is already known, so the AI stages never run.
  if (!live) {
    const allKnown = responses.flatMap((f) => {
      const r = read(f);
      return (r.jobs || []).map((j) => ({ json: { 'Job Posting URL': j.applicationLink || j.guid } }))
        .concat((r.data || []).map((j) => ({ json: { 'Job Posting URL': j.url } })));
    });
    await runPipeline({ fixtures, responses, live, readLeads: allKnown, label: 'Scenario 2: quiet day (nothing new)' });
  }
})();
