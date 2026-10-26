# RAY AI — AI Automation Engineer Case Study

## Project overview
- **Candidate:** Roy Githara
- **Company / role:** RAY AI (getray.ai), AI Automation Engineer (Technical Assistants, Kenya, fully remote)
- **Deadline:** **Saturday, 31 October 2026, 23:59 UTC.** Late submissions are not accepted.
- **Submission:** ONE PDF (max 25 MB) with a clear heading per task. It briefly explains what was built and links to everything: the GitHub repo, the Google Sheet, the n8n workflow export, and the Notion share link. **Every link must be viewable by anyone with the link.**
- **Grading:** only the result is evaluated (working automations, technical judgment, LLM integration, research, clear documentation). Short notes on the process are welcome.

## Working style (important)
- Roy is learning Claude Code. Go **step by step**: explain what each step does and *why*, then wait for Roy's OK before moving on.
- **Ask instead of guessing.** Never invent API fields, endpoints, URLs, credential names, or n8n node parameters. Verify them by calling the API, using the n8n MCP docs tools, or asking Roy.
- Steps that happen in a web UI (n8n credentials, Google OAuth, Notion) are done by Roy. Give clear click-by-click instructions.
- **Never write API keys or secrets into files or the repo.** Keep them in n8n credentials, or in `.env`, which is gitignored. Commit only `.env.example`.

## Task 1 — Executive Assistant job outreach automation (n8n)
**Stack (decided):** an n8n workflow on **n8n Cloud** (managed via the n8n MCP) with **Anthropic Claude** as the LLM and Google Sheets as the output.

**Framing (decided): a lead-generation pipeline for RAY AI.** A company hiring an EA/Admin Assistant is a warm lead for RAY's assistant service. The outreach message pitches RAY's service to that company; it is not a job application. Goal: build something RAY could actually use in production, whatever the hiring outcome.

**Pipeline:**
1. Schedule Trigger (daily)
2. HTTP Request to the job board API(s)
3. Normalize fields: Job Title, Company Name, Location, Job Description, Job Posting URL, Language requirements
4. Filter/validate. Keep a posting only if it passes all four checks:
   - **Remote**
   - **English-speaking** (no non-English language requirement, and the description is in English)
   - **Relevant** to an Executive Assistant / Admin Assistant role
   - **Real end client, not an agency or recruiter** (our own addition). VA agencies and staffing firms (e.g. Wing Assistant, Assist World, OurAssistants, My Hero VA, Green Key Resources, Hays) are RAY's competitors or middlemen, not leads. The check combines an editable list of agency names in `Settings` with Claude's judgment. Rejected postings go to the `Rejected` tab with the reason "staffing/VA agency (competitor)".
5. Claude generates a genuinely personalized outreach message per posting
6. Append/upsert to Google Sheets, deduplicated by Job Posting URL
7. Also produce a sample data output (JSON/CSV) for the repo

**Google Sheet `Leads` tab: required columns FIRST, in this exact order:** Job Posting URL | Job Title | Company Name | Location | Job Description | LLM-Generated Outreach Message
Then the working columns for the sales rep: Fit Score | Why it matched | Status (dropdown: New / Contacted / Replied / Won / Lost) | Date Found | Follow-up Date | Prompt Version | Source | Notes

**Other Sheet tabs:**
- `Settings`: key/value config the end user edits (relevance keywords, excluded languages, remote signals, max jobs per run, sources on/off, digest recipient). Each row has a note; dropdowns where useful; protected headers. Only sources that already have a connector node can be switched on/off; a new board still needs a node (state this in the README).
- `Prompts`: several prompt versions with an **Active** checkbox. Each lead row logs the prompt version that produced its message (for A/B tone testing).
- `Rejected`: postings that were filtered out, with the reason (lets the filter be audited).
- `Run Log`: one row per run (timestamp, fetched, kept, rejected, errors).

**Priority list (decided, build in this order):**
1. Lead-gen framing (above)
2. Transparent validation: cheap keyword pre-filter, then Claude classification returning JSON (`is_remote`, `english_ok`, `relevant`, `confidence`, `reason`)
3. `Rejected` tab
4. Idempotent daily runs: dedupe by Job Posting URL
5. `Run Log` tab + n8n error workflow alert
6. Prompt versioning via the `Prompts` tab
7. **Daily digest email to the sales rep** with the top new leads
8. Polished docs: README with an architecture diagram, user guide for the sales rep, and a short Loom

Model use: a fast/cheap Claude model for classification and a stronger one for writing messages. The prompt must use only facts from the posting (no invented details).

**Requirements:**
- **Swappable prompt:** the LLM prompt lives in ONE editable place (a "Prompt Config" Set node, or a `Prompt` tab in the Sheet) so tone and wording can be tested without rebuilding the workflow.
- **Configurable filters:** relevance keywords, excluded languages, and remote signals are kept as editable lists, not hard-coded in several places.
- **Compliant sources only:** no LinkedIn. Use official/public APIs and respect each source's ToS and attribution rules.
- **Job sources (DECIDED 2026-10-26 after test-calling the APIs):**
  - **Primary: Himalayas** (`https://himalayas.app/jobs/api/search?q=...`, 20 per page, `?page=N`). Free with no key, and a free API key gives higher rate limits. The search returned 1,240 results for "executive assistant", with full descriptions (~4k chars). Fields: title, companyName, companySlug, locationRestrictions, timezoneRestrictions, categories, description, pubDate, expiryDate, applicationLink, guid. **Terms (clause 113) allow commercial use** with these conditions: use `applicationLink` unchanged for job links; credit Himalayas visibly as the source with a link; don't pass the jobs to third-party boards or aggregators; cache, stay within rate limits, and remove jobs after `expiryDate`; keep keys private.
  - **Secondary (on/off in `Settings`): Arbeitnow** (`https://www.arbeitnow.com/api/job-board-api?page=N`, 300 per page). Fields: slug, company_name, title, description, remote (bool), url, tags, job_types, location, created_at. Low EA volume (4 of 900, none remote) and about 25% German descriptions, so it mainly shows the filters at work. Terms: "don't abuse it, link back."
  - **Rejected:** **Adzuna** (descriptions cut off at 500 chars, results dominated by recruiters and on-site/hybrid roles, and £8/month after 25 trial calls, of which 2 are used). Mention it in the README as a possible paid source later. **Remotive** (free feed capped at 10 jobs; its terms say the API exists for re-sharing jobs, so our lead-gen use is questionable). **Jobicy** (low EA volume). **The Muse** (blocks API requests with a 403).
  - Explain these source choices in the README; they show compliance judgment.

## Task 2 — Executive Travel Planner (Notion)
Built by Roy in Notion with guidance from Claude.
- **Single Trips database:** one record per trip with trip name, traveler(s), date range, status, flights, hotels and addresses, confirmations, transfers, meetings, visas, notes, and emergency contacts.
- **Trip Brief template:** an auto-generated, founder-ready, mobile-friendly summary with a chronological timeline of key events, space for documents (tickets, visas), and emergency/primary contact info.
- **Saved views:** a Timeline/Calendar view of upcoming trips, and a Board grouped by status (Planned / In-Progress / Done).
- **Share to web:** the page title must be exactly **"Executive Travel Planner – Roy Githara"**.
- Optional bonus: a short note or Loom explaining the design choices.

## Planned repo layout
```
D:\RAY AI\
├── CLAUDE.md
├── README.md                      # top-level overview + links
├── .gitignore / .env.example
├── task1-job-outreach/
│   ├── workflow/                  # n8n workflow JSON export
│   ├── prompts/                   # outreach prompt versions
│   ├── sample-output/             # sample JSON/CSV
│   └── README.md                  # user guide (install, run, filters, prompt, troubleshooting, sales-rep usage)
├── task2-notion-travel-planner/   # design notes, screenshots
└── submission/                    # final PDF
```

## Deliverables checklist
- [x] Job board source chosen and verified (Himalayas + Arbeitnow)
- [ ] n8n workflow built and tested (scrape → validate → LLM → Sheets)
- [ ] Daily schedule active on n8n Cloud
- [ ] Workflow JSON exported to the repo (no secrets)
- [ ] Sample data output (JSON/CSV)
- [ ] Task 1 README/user guide
- [ ] Google Sheet populated and shared (anyone with the link can view)
- [ ] GitHub repo public
- [ ] Notion Travel Planner built and shared to web
- [ ] (Optional) Loom / design note
- [ ] Final PDF with all links, every link checked

## Tools available
- **n8n: Claude has NO access to Roy's n8n Cloud instance (by Roy's choice).** Claude writes workflow JSON files into `task1-job-outreach/workflow/`, and Roy imports them in the n8n UI (Workflows → Import from File), adds credentials, and runs them. Roy reports back results or errors (screenshots or pasted output).
  - Claude may use the n8n MCP's offline documentation/validation tools (e.g. `search_nodes`, `get_node`, `validate_node`, `validate_workflow`) to check node types and parameters, but must NEVER call tools that touch an instance (`n8n_create_workflow`, `n8n_test_workflow`, etc.).
  - Credentials are never written into workflow JSON. Nodes reference credentials by name, and Roy picks them after importing.
- **Google Drive connector** (needs authentication)
- **Claude Code:** files, shell (PowerShell/Git Bash on Windows), web fetch for API testing
