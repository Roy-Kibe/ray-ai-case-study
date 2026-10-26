// Node: "Build Config"  (Code node, Run Once for All Items)
// Input: rows from the Settings tab (columns: ID | Setting | Your choice | Help).
// Output: one item per API request to make, each carrying the parsed config.

const cfg = {};
for (const { json: row } of $input.all()) {
  const id = String(row.ID ?? '').trim();
  if (id) cfg[id] = row['Your choice'];
}

const text = (v) => String(v ?? '').trim();
const list = (v) => text(v).split(',').map((s) => s.trim()).filter(Boolean);
const yes = (v) => text(v).toLowerCase() === 'yes';
const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const config = {
  searchTerms: list(cfg.search_terms),
  useHimalayas: yes(cfg.source_himalayas),
  useArbeitnow: yes(cfg.source_arbeitnow),
  jobsPerRun: num(cfg.jobs_per_run, 100),
  maxAgeDays: num(cfg.max_age_days, 14),
  maxNewLeads: num(cfg.max_new_leads, 25),
  excludeTitleWords: list(cfg.exclude_title_words).map((s) => s.toLowerCase()),
  agencyBlocklist: list(cfg.agency_blocklist).map((s) => s.toLowerCase()),
  allowBilingual: yes(cfg.allow_bilingual),
  minFitScore: num(cfg.min_fit_score, 60),
  senderName: text(cfg.sender_name),
  senderTitle: text(cfg.sender_title),
  companyPitch: text(cfg.company_pitch),
  callToAction: text(cfg.call_to_action),
  bookingLink: text(cfg.booking_link),
  maxWords: num(cfg.max_words, 150),
  digestEnabled: yes(cfg.digest_enabled),
  digestTo: text(cfg.digest_to),
  digestTopN: num(cfg.digest_top_n, 10),
  alertTo: text(cfg.alert_to),
  classifierModel: text(cfg.classifier_model) || 'claude-haiku-5-5',
  writerModel: text(cfg.writer_model) || 'claude-sonnet-5-5',
};

if (!config.searchTerms.length) {
  throw new Error('Settings: "Job titles to search for" is empty.');
}

const requests = [];

if (config.useHimalayas) {
  // Himalayas search returns 20 jobs per page; spread the budget across search terms.
  // sort=recent puts the newest postings on page 1 (default sort is by relevance).
  const pages = Math.max(1, Math.ceil(config.jobsPerRun / (20 * config.searchTerms.length)));
  for (const term of config.searchTerms) {
    for (let page = 1; page <= pages; page++) {
      requests.push({
        source: 'Himalayas',
        url: `https://himalayas.app/jobs/api/search?q=${encodeURIComponent(term)}&sort=recent&page=${page}`,
      });
    }
  }
}

if (config.useArbeitnow) {
  // Arbeitnow has no search; it returns 300 jobs per page.
  const pages = Math.max(1, Math.ceil(config.jobsPerRun / 300));
  for (let page = 1; page <= pages; page++) {
    requests.push({ source: 'Arbeitnow', url: `https://www.arbeitnow.com/api/job-board-api?page=${page}` });
  }
}

if (!requests.length) {
  throw new Error('Settings: both job sources are switched off.');
}

return requests.map((r) => ({ json: { ...r, config } }));
