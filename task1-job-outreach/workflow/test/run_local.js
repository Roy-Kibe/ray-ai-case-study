// Run the workflow's Code nodes locally against saved data, without n8n.
//
// Usage:
//   node run_local.js <settings.json> <api_response.json> [more_responses.json ...]
//
// settings.json = array of Settings-tab rows: [{ "ID": ..., "Setting": ..., "Your choice": ..., "Help": ... }]
// Each api_response.json = one raw response body from Himalayas or Arbeitnow.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

// Mimics an n8n Code node: top-level `return`, `$input.all()`, `$('Node').first()`.
function runCodeNode(file, inputItems, nodeOutputs) {
  const code = fs.readFileSync(path.join(SRC, file), 'utf8');
  const $input = { all: () => inputItems, first: () => inputItems[0] };
  const $ = (name) => {
    const items = nodeOutputs[name];
    if (!items) throw new Error(`Node "${name}" has no output in this test`);
    return { all: () => items, first: () => items[0] };
  };
  return new Function('$input', '$', code)($input, $);
}

const [settingsFile, ...responseFiles] = process.argv.slice(2);
if (!settingsFile || !responseFiles.length) {
  console.error('Usage: node run_local.js <settings.json> <api_response.json> [...]');
  process.exit(1);
}

const outputs = {};

const settingsItems = read(settingsFile).map((json) => ({ json }));
outputs['Build Config'] = runCodeNode('01_build_config.js', settingsItems, outputs);
console.log(`Build Config -> ${outputs['Build Config'].length} requests`);
for (const { json } of outputs['Build Config']) console.log(`   ${json.source}: ${json.url}`);

// Stand-in for "Fetch Jobs": use the saved responses instead of calling the APIs.
const fetched = responseFiles.map((f) => ({ json: read(f) }));
const jobs = runCodeNode('02_normalize_prefilter.js', fetched, outputs);

const passed = jobs.filter((j) => j.json.passed);
const failed = jobs.filter((j) => !j.json.passed);
console.log(`\nNormalize & Pre-filter -> ${jobs.length} unique jobs: ${passed.length} passed, ${failed.length} rejected`);

const byReason = {};
for (const { json } of failed) byReason[json.reason] = (byReason[json.reason] || 0) + 1;
console.log('\nRejected by reason:');
Object.entries(byReason).sort((a, b) => b[1] - a[1]).slice(0, 15)
  .forEach(([r, n]) => console.log(`  ${String(n).padStart(4)}  ${r}`));

console.log('\nPassed (first 15):');
for (const { json } of passed.slice(0, 15)) {
  console.log(`  - ${json.job_title} | ${json.company_name} | ${json.location} | ${json.date_posted} | lang: ${json.language_requirements || '-'}`);
}

if (passed[0]) {
  const s = passed[0].json;
  console.log('\nSample passed item (description shortened):');
  console.log(JSON.stringify({ ...s, job_description: s.job_description.slice(0, 300) + '…' }, null, 2));
}
