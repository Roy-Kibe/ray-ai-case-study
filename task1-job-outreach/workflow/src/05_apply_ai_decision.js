// Node: "Apply AI Decision"  (Code node, Run Once for All Items)
// Input: Claude API responses from "AI Check" (one per job, same order).
// Output: one item per job with the AI judgment, marked qualified=true/false.
// Rules live here, in code, so they are predictable and driven by Settings.
// Qualified leads are capped at "Max new leads per day" (best fit first);
// the overflow is left unprocessed and is reconsidered on the next run.

const config = $('Build Config').first().json.config;
const requests = $('Build AI Check').all();

// Find the request that produced response i (n8n item pairing, index fallback).
const jobFor = (i) => {
  try {
    return $('Build AI Check').itemMatching(i).json.job;
  } catch (e) {
    return requests[i].json.job;
  }
};

// Claude's answer is the text block (a thinking block may come first).
const parseAnswer = (res) => {
  if (!res || res.error) return [null, `API error: ${JSON.stringify(res && res.error).slice(0, 200)}`];
  if (res.stop_reason !== 'end_turn') return [null, `Unexpected stop_reason: ${res.stop_reason}`];
  const text = (res.content || []).find((b) => b.type === 'text');
  if (!text) return [null, 'No text block in response'];
  try {
    return [JSON.parse(text.text), null];
  } catch (e) {
    return [null, 'Response was not valid JSON'];
  }
};

const decide = (ai) => {
  if (!ai.relevant) return ['Relevance', ai.reason];
  if (ai.is_agency_or_recruiter)
    return ['Agency', `Staffing/VA agency or recruiter (competitor): ${ai.agency_evidence || ai.reason}`];
  if (!ai.is_remote) return ['Remote', ai.reason];
  if (!ai.english_ok) return ['English', 'Posting is not in English'];
  if (!config.allowBilingual && ai.other_languages_required.length)
    return ['Language', `Requires ${ai.other_languages_required.join(', ')}`];
  if (ai.fit_score < config.minFitScore)
    return ['Low fit', `Fit score ${ai.fit_score} < ${config.minFitScore}: ${ai.reason}`];
  return null;
};

const results = $input.all().map(({ json: res }, i) => {
  const job = jobFor(i);
  const [ai, error] = parseAnswer(res);
  if (!ai) {
    return { ...job, qualified: false, failed_check: 'AI check failed', reason: error,
      fit_score: '', why_matched: '', hooks: [] };
  }
  const failed = decide(ai);
  const languages = ['English', ...ai.other_languages_required].join(', ');
  return {
    ...job,
    qualified: !failed,
    failed_check: failed ? failed[0] : '',
    reason: failed ? failed[1] : '',
    fit_score: ai.fit_score,
    why_matched: ai.reason,
    hooks: ai.hooks,
    hiring_company: ai.hiring_company,
    language_requirements: languages,
  };
});

// Cap qualified leads: keep the best-fit ones, defer the rest to the next run.
const qualified = results.filter((r) => r.qualified).sort((a, b) => b.fit_score - a.fit_score);
const keep = new Set(qualified.slice(0, config.maxNewLeads));
const deferred = qualified.length - keep.size;

return results
  .filter((r) => !r.qualified || keep.has(r))
  .map((r) => ({ json: { ...r, deferred_count: deferred } }));
