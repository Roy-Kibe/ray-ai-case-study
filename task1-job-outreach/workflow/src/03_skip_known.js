// Node: "Skip Known Jobs"  (Code node, Run Once for All Items)
// Drops jobs already in the Leads or Rejected tab, so daily runs never repeat
// AI calls or create duplicate rows.
// Input: rows from "Read Rejected" (Read Leads is referenced by name).
// Output: new candidate jobs (passed the pre-filter, not seen before).

const known = new Set();
for (const node of ['Read Leads', 'Read Rejected']) {
  for (const { json } of $(node).all()) {
    const url = String(json['Job Posting URL'] ?? '').trim();
    if (url) known.add(url);
  }
}

const candidates = $('Normalize & Pre-filter').all()
  .map((item) => item.json)
  .filter((job) => job.passed && !known.has(job.job_url));

return candidates.map((job) => ({ json: { ...job, already_known: known.size } }));
