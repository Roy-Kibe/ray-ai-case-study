// Node: "Summarize Run"  (Code node, Run Once for All Items)
// The single end point of every run, whichever path the run took.
// Output items carry a `kind` that the "Route" switch sends to the right place:
//   rejected -> Rejected tab   runlog -> Run Log tab
//   expired  -> Leads tab (mark expired)   digest -> daily summary email
// Nodes that didn't run on this path (e.g. no new candidates) are read as empty.

const SHEET_URL = '__SHEET_URL__';
const config = $('Build Config').first().json.config;

const safe = (name) => {
  try {
    return $(name).all().map((i) => i.json);
  } catch (e) {
    return [];
  }
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const now = new Date();
const today = now.toISOString().slice(0, 10);

const fetched = safe('Fetch Jobs');
const fetchErrors = fetched.filter((r) => r.error).length;
const jobs = safe('Normalize & Pre-filter').filter((j) => j.job_url);
const candidates = safe('Skip Known Jobs').filter((j) => j.job_url);
const decided = safe('Apply AI Decision').filter((j) => j.job_url);
const newLeads = safe('Prepare Lead Rows').filter((r) => r['Job Posting URL']);
const outreach = safe('Build Outreach');
const passedPrefilter = jobs.filter((j) => j.passed).length;

// 1) Rejections worth auditing. Obvious misses (not an EA title, too old) are
//    left out on purpose: hundreds per day would bury the useful ones.
const MEANINGFUL = ['Agency', 'Remote', 'English'];
const prefilterRejects = jobs.filter((j) => !j.passed &&
  (MEANINGFUL.includes(j.failed_check) || j.reason.startsWith('Title contains excluded word')));
const aiRejects = decided.filter((j) => !j.qualified);
const rejected = [...prefilterRejects, ...aiRejects].map((j) => ({
  kind: 'rejected',
  'Date': today,
  'Job Posting URL': j.job_url,
  'Job Title': j.job_title,
  'Company Name': j.company_name,
  'Source': j.source,
  'Failed Check': j.failed_check,
  'Reason': j.reason,
}));

// 2) Expired leads (Himalayas terms: remove jobs once they expire). Only untouched
//    ("New") leads are changed; the copied job description is cleared.
//    Dates are written as text (RAW), but accept other formats in case of manual edits.
const toIsoDate = (v) => {
  if (typeof v === 'number') return new Date((v - 25569) * 86400000).toISOString().slice(0, 10); // Sheets serial
  const d = new Date(String(v ?? ''));
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
};
const expired = safe('Read Leads')
  .filter((r) => r['Job Posting URL'] && toIsoDate(r.Expires) && toIsoDate(r.Expires) < today &&
    ['', 'new'].includes(String(r.Status ?? '').trim().toLowerCase()))
  .map((r) => ({ kind: 'expired', 'Job Posting URL': r['Job Posting URL'], 'Status': 'Expired', 'Job Description': '' }));

// 3) Run log.
const aiFailures = decided.filter((j) => j.failed_check === 'AI check failed').length;
const writeFailures = newLeads.filter((r) => r.Notes).length;
const deferred = decided[0] ? decided[0].deferred_count : 0;
const problems = [
  fetchErrors && `${fetchErrors} job-board request(s) failed`,
  aiFailures && `${aiFailures} AI check(s) failed`,
  writeFailures && `${writeFailures} outreach message(s) failed`,
  outreach[0] && outreach[0].prompt_warning,
].filter(Boolean);

const runlog = {
  kind: 'runlog',
  'Run Time': `${today} ${now.toISOString().slice(11, 16)} UTC`,
  'Status': problems.length ? 'Warnings' : 'OK',
  'Jobs Fetched': jobs.length,
  'After Pre-filter': passedPrefilter,
  'Classified': decided.length,
  'New Leads': newLeads.length,
  'Rejected': rejected.length,
  'Duplicates Skipped': passedPrefilter - candidates.length,
  'Errors': [...problems, deferred && `${deferred} qualified lead(s) deferred by the daily cap`].filter(Boolean).join('; '),
};

// 4) Daily summary email.
const items = [...rejected, runlog, ...expired];
if (config.digestEnabled && config.digestTo) {
  const top = newLeads.slice(0, config.digestTopN);
  const rowsHtml = top.map((r) => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center"><b>${esc(r['Fit Score'])}</b></td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(r['Company Name'])}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee"><a href="${esc(r['Job Posting URL'])}">${esc(r['Job Title'])}</a></td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;color:#555">${esc(r['Why it matched'])}</td>
    </tr>`).join('');

  const html = `
  <div style="font-family:Arial,sans-serif;font-size:14px;color:#111;max-width:760px">
    <h2 style="margin:0 0 4px">${newLeads.length ? `${newLeads.length} new lead${newLeads.length === 1 ? '' : 's'} today` : 'No new leads today'}</h2>
    <p style="margin:0 0 16px;color:#555">Checked ${jobs.length} jobs: ${passedPrefilter} passed the quick filter,
      ${decided.length} were reviewed by AI, ${rejected.length} were logged as rejected.</p>
    ${top.length ? `
    <table style="border-collapse:collapse;width:100%">
      <tr style="background:#f3f4f6;text-align:left">
        <th style="padding:6px 8px">Fit</th><th style="padding:6px 8px">Company</th>
        <th style="padding:6px 8px">Role</th><th style="padding:6px 8px">Why</th>
      </tr>${rowsHtml}
    </table>` : ''}
    ${problems.length ? `<p style="margin:16px 0 0;color:#b45309"><b>Needs attention:</b> ${esc(problems.join('; '))}</p>` : ''}
    <p style="margin:20px 0">
      <a href="${SHEET_URL}" style="background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">
        Open the Leads sheet</a>
    </p>
    <p style="color:#888;font-size:12px">Outreach messages are ready in the Leads tab. Review, send from your inbox, then set Status to Contacted.
      Job data from Himalayas (himalayas.app) and Arbeitnow (arbeitnow.com).</p>
  </div>`;

  items.push({
    kind: 'digest',
    to: config.digestTo,
    subject: newLeads.length ? `RAY leads: ${newLeads.length} new (${today})` : `RAY leads: no new leads (${today})`,
    html,
  });
}

return items.map((json) => ({ json }));
