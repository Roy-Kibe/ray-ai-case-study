// Run the workflow's Code nodes locally against saved data, without n8n.
//
// Usage:
//   node run_local.js [--live] <settings.json> <api_response.json> [more_responses.json ...]
//
// settings.json = array of Settings-tab rows: [{ "ID": ..., "Setting": ..., "Your choice": ..., "Help": ... }]
// Each api_response.json = one raw response body from Himalayas or Arbeitnow.
//
// Claude calls are MOCKED by default (free, tests the plumbing and edge cases).
// --live calls the real Anthropic API with ANTHROPIC_API_KEY from the environment
// (tests the prompt itself; costs about $0.01 per run with Haiku).
// MAX_NEW_LEADS=<n> overrides that setting, to exercise the cap.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

// Mimics an n8n Code node: top-level `return`, `$input.all()`, `$('Node').first()/.all()/.itemMatching()`.
function runCodeNode(file, inputItems, nodeOutputs) {
  const code = fs.readFileSync(path.join(SRC, file), 'utf8');
  const $input = { all: () => inputItems, first: () => inputItems[0] };
  const $ = (name) => {
    const items = nodeOutputs[name];
    if (!items) throw new Error(`Node "${name}" has no output in this test`);
    return { all: () => items, first: () => items[0], itemMatching: (i) => items[i] };
  };
  return new Function('$input', '$', code)($input, $);
}

// ---- Mock Claude: plausible answers plus deliberate edge cases -------------
function mockClaude(body, index) {
  const posting = body.messages[0].content;
  const title = (posting.match(/Job title: (.*)/) || [])[1] || '';
  if (index === 1) return { error: { message: 'mock: 529 overloaded' } };
  if (index === 2) return { stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"is_rem' }] };

  const agency = /our client|the client is|clients? (in|across|based)|we place|talent pool/i.test(posting);
  const offRole = /graphic|legal|litigation|customer service|dispatch|real estate|human resources/i.test(title);
  const senior = /ceo|founder|chief of staff|executive/i.test(title);
  const answer = {
    is_remote: true,
    english_ok: true,
    other_languages_required: /spanish/i.test(title) ? ['Spanish'] : [],
    relevant: !offRole,
    is_agency_or_recruiter: agency,
    agency_evidence: agency ? 'mock: "our client"' : '',
    hiring_company: '',
    fit_score: agency || offRole ? 20 : senior ? 85 : 55,
    hooks: ['mock hook 1', 'mock hook 2'],
    reason: 'mock reason',
  };
  // Thinking block first, like the real API on models with thinking on.
  return { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(answer) }] };
}

async function liveClaude(body) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return res.ok ? json : { error: json };
}

// ---- Pipeline ---------------------------------------------------------------
(async () => {
  const args = process.argv.slice(2);
  const live = args[0] === '--live';
  if (live) args.shift();
  const [settingsFile, ...responseFiles] = args;
  if (!settingsFile || !responseFiles.length) {
    console.error('Usage: node run_local.js [--live] <settings.json> <api_response.json> [...]');
    process.exit(1);
  }
  if (live && !process.env.ANTHROPIC_API_KEY) {
    console.error('--live needs ANTHROPIC_API_KEY in the environment');
    process.exit(1);
  }

  const out = {};
  const settings = read(settingsFile);
  if (process.env.MAX_NEW_LEADS) {
    settings.find((r) => r.ID === 'max_new_leads')['Your choice'] = Number(process.env.MAX_NEW_LEADS);
  }

  // Stage A
  out['Build Config'] = runCodeNode('01_build_config.js', settings.map((json) => ({ json })), out);
  console.log(`Build Config -> ${out['Build Config'].length} requests`);

  const fetched = responseFiles.map((f) => ({ json: read(f) })); // stand-in for "Fetch Jobs"
  out['Normalize & Pre-filter'] = runCodeNode('02_normalize_prefilter.js', fetched, out);
  const jobs = out['Normalize & Pre-filter'];
  const passed = jobs.filter((j) => j.json.passed);
  console.log(`Normalize & Pre-filter -> ${jobs.length} unique jobs: ${passed.length} passed, ${jobs.length - passed.length} rejected`);

  // Stage B. Empty tabs: the Sheets nodes have alwaysOutputData, so they emit one empty item.
  out['Read Leads'] = [{ json: {} }];
  out['Read Rejected'] = [{ json: { 'Job Posting URL': passed[0] && passed[0].json.job_url } }]; // pretend 1 is known
  out['Skip Known Jobs'] = runCodeNode('03_skip_known.js', out['Read Rejected'], out);
  console.log(`Skip Known Jobs -> ${out['Skip Known Jobs'].length} new candidates (1 skipped as already known)`);

  out['Build AI Check'] = runCodeNode('04_build_ai_check.js', out['Skip Known Jobs'], out);
  const sample = out['Build AI Check'][0].json.body;
  console.log(`Build AI Check -> ${out['Build AI Check'].length} requests | model: ${sample.model} | effort: ${sample.output_config.effort}`);

  console.log(live ? '\nCalling Claude (live)...' : '\nClaude responses are MOCKED (use --live for real calls)');
  const responses = [];
  for (const [i, { json }] of out['Build AI Check'].entries()) {
    responses.push({ json: live ? await liveClaude(json.body) : mockClaude(json.body, i) });
  }

  const decided = runCodeNode('05_apply_ai_decision.js', responses, out);
  const kept = decided.filter((d) => d.json.qualified);
  console.log(`Apply AI Decision -> ${decided.length} items: ${kept.length} qualified, ${decided.length - kept.length} rejected, ${decided[0] ? decided[0].json.deferred_count : 0} deferred by the daily cap`);

  console.log('\nQualified leads:');
  for (const { json: j } of kept) {
    console.log(`  [${j.fit_score}] ${j.job_title} | ${j.company_name} | ${j.location}`);
    console.log(`        why: ${j.why_matched}`);
    if (live) j.hooks.forEach((h) => console.log(`        hook: ${h}`));
  }
  console.log('\nRejected by AI:');
  for (const { json: j } of decided.filter((d) => !d.json.qualified)) {
    console.log(`  [${j.failed_check}] ${j.job_title} | ${j.company_name} -> ${String(j.reason).slice(0, 140)}`);
  }
})();
