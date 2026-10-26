// Node: "Prepare Lead Rows"  (Code node, Run Once for All Items)
// Input: Claude responses from "Write Outreach (Claude)", one per lead, same order.
// Output: one row per lead, keyed by the exact Leads-tab column headers.
// A failed message still produces a row (empty message + a note), so a good
// lead is never lost; the rep can write that one by hand.

const requests = $('Build Outreach').all();
const requestFor = (i) => {
  try {
    return $('Build Outreach').itemMatching(i).json;
  } catch (e) {
    return requests[i].json;
  }
};

const parseEmail = (res) => {
  if (!res || res.error) return [null, `API error: ${JSON.stringify(res && res.error).slice(0, 150)}`];
  if (res.stop_reason !== 'end_turn') return [null, `stop_reason ${res.stop_reason}`];
  const text = (res.content || []).find((b) => b.type === 'text');
  if (!text) return [null, 'no text block'];
  try {
    const email = JSON.parse(text.text);
    return email.subject && email.body ? [email, null] : [null, 'empty subject or body'];
  } catch (e) {
    return [null, 'invalid JSON'];
  }
};

const today = new Date().toISOString().slice(0, 10);

const rows = $input.all().map(({ json: res }, i) => {
  const { lead, prompt_id } = requestFor(i);
  const [email, error] = parseEmail(res);
  return {
    'Job Posting URL': lead.job_url,
    'Job Title': lead.job_title,
    'Company Name': lead.company_name,
    'Location': lead.location,
    'Job Description': lead.job_description,
    'LLM-Generated Outreach Message': email ? `Subject: ${email.subject}\n\n${email.body}` : '',
    'Fit Score': lead.fit_score,
    'Why it matched': lead.why_matched,
    'Status': 'New',
    'Date Found': today,
    'Follow-up Date': '',
    'Language Requirements': lead.language_requirements,
    'Expires': lead.expires,
    'Prompt Version': prompt_id,
    'Source': lead.source,
    'Notes': email ? '' : `Message generation failed (${error}). Write this one manually or re-run.`,
  };
});

rows.sort((a, b) => b['Fit Score'] - a['Fit Score']);
return rows.map((json) => ({ json }));
