// Node: "Normalize & Pre-filter"  (Code node, Run Once for All Items)
// Input: raw API responses from "Fetch Jobs" (Himalayas and/or Arbeitnow).
// Output: one item per unique job, in a common shape, marked passed=true/false.
// Cheap rule-based checks only; the AI checks (Stage B) run on the passed ones.

const config = $('Build Config').first().json.config;
const now = Date.now();
const DAY = 86400000;

const stripHtml = (html) =>
  String(html ?? '')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/ul|\/ol)[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;|&rsquo;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();

const isoDate = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');

// Languages mentioned next to words like "fluent", "native", "required".
const LANGS = ['English', 'German', 'French', 'Spanish', 'Portuguese', 'Italian', 'Dutch',
  'Polish', 'Swedish', 'Danish', 'Norwegian', 'Finnish', 'Japanese', 'Mandarin', 'Chinese',
  'Korean', 'Arabic', 'Hebrew', 'Russian', 'Turkish', 'Hindi', 'Tagalog'];
const languageRequirements = (desc) => {
  const found = LANGS.filter((lang) =>
    new RegExp(
      `(fluent|fluency|native|proficien\\w*|bilingual|speak\\w*|written and spoken|business[- ]level|\\bC1\\b|\\bC2\\b)[^.\\n]{0,60}\\b${lang}\\b` +
      `|\\b${lang}\\b[^.\\n]{0,40}(fluen\\w*|native|required|proficien\\w*|skills|speaking|is a must)`,
      'i',
    ).test(desc),
  );
  if (/\bDeutsch(kenntnisse)?\b/i.test(desc) && !found.includes('German')) found.push('German');
  return found.join(', ');
};

// Rough check for German-language descriptions (Arbeitnow has many).
const GERMAN_WORDS = /\b(und|der|die|das|wir|mit|für|sie|ist|auf|eine|deine|ihre|bei|oder|nicht|unsere?)\b/gi;
const looksGerman = (desc) => {
  const words = desc.split(/\s+/).length || 1;
  return (desc.match(GERMAN_WORDS) || []).length / words > 0.05;
};

// 1) Flatten API responses into a common job shape.
const jobs = [];
let fetchErrors = 0;
for (const { json } of $input.all()) {
  if (json.error) { fetchErrors++; continue; }

  if (Array.isArray(json.jobs)) {
    for (const j of json.jobs) {
      const where = (j.locationRestrictions || []).join(', ') || 'Worldwide';
      jobs.push({
        source: 'Himalayas',
        // Himalayas terms: link to applicationLink unchanged. Their docs: de-duplicate on guid.
        job_url: j.applicationLink || j.guid,
        dedupe_key: j.guid || j.applicationLink,
        job_title: String(j.title ?? '').trim(),
        company_name: String(j.companyName ?? '').trim(),
        location: `Remote · ${where}`,
        remote: true,
        posted_ms: Number(j.pubDate) * 1000 || 0,
        expires_ms: Number(j.expiryDate) * 1000 || 0,
        description: stripHtml(j.description),
      });
    }
  } else if (Array.isArray(json.data)) {
    for (const j of json.data) {
      jobs.push({
        source: 'Arbeitnow',
        job_url: j.url,
        dedupe_key: j.url,
        job_title: String(j.title ?? '').trim(),
        company_name: String(j.company_name ?? '').trim(),
        location: j.remote ? `Remote · ${j.location}` : String(j.location ?? ''),
        remote: Boolean(j.remote),
        posted_ms: Number(j.created_at) * 1000 || 0,
        expires_ms: 0,
        description: stripHtml(j.description),
      });
    }
  }
}

// 2) De-duplicate: same job id, or same company + title (keep the newest).
jobs.sort((a, b) => b.posted_ms - a.posted_ms);
const seen = new Set();
const unique = jobs.filter((j) => {
  const keys = [j.dedupe_key, `${j.company_name}|${j.job_title}`.toLowerCase()];
  if (!j.job_url || keys.some((k) => seen.has(k))) return false;
  keys.forEach((k) => seen.add(k));
  return true;
});

// 3) Cheap rule-based checks. First failing check wins.
const titleWords = [...config.searchTerms.map((t) => t.toLowerCase()), 'assistant', 'secretary', 'chief of staff', 'office manager'];

const check = (j) => {
  const title = j.job_title.toLowerCase();
  if (j.posted_ms && now - j.posted_ms > config.maxAgeDays * DAY)
    return ['Too old', `Older than ${config.maxAgeDays} days`];
  if (j.expires_ms && j.expires_ms < now)
    return ['Expired', `Expired on ${isoDate(j.expires_ms)}`];
  if (!titleWords.some((w) => title.includes(w)))
    return ['Relevance', 'Title is not an EA/Admin role'];
  const bad = config.excludeTitleWords.find((w) => title.includes(w));
  if (bad) return ['Relevance', `Title contains excluded word "${bad}"`];
  if (config.agencyBlocklist.includes(j.company_name.toLowerCase()))
    return ['Agency', 'Staffing/VA agency (competitor), on the blocklist'];
  if (!j.remote) return ['Remote', 'Not marked as remote by the job board'];
  if (looksGerman(j.description)) return ['English', 'Description is not in English'];
  return null;
};

return unique.map((j) => {
  const failed = check(j);
  return {
    json: {
      source: j.source,
      job_url: j.job_url,
      job_title: j.job_title,
      company_name: j.company_name,
      location: j.location,
      job_description: j.description.slice(0, 8000),
      language_requirements: languageRequirements(j.description),
      date_posted: isoDate(j.posted_ms),
      expires: isoDate(j.expires_ms),
      passed: !failed,
      failed_check: failed ? failed[0] : '',
      reason: failed ? failed[1] : '',
      fetch_errors: fetchErrors,
    },
  };
});
