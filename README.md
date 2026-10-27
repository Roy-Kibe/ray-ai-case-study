# RAY AI — AI Automation Engineer Case Study

**Candidate:** Roy Githara · **Role:** AI Automation Engineer (Technical Assistants)

| Task | What was built | Links |
|---|---|---|
| **1. Executive Assistant job outreach** | An n8n workflow that finds remote, English-speaking EA/Admin jobs every day, filters out agencies and poor fits with Claude, and writes a personalized outreach message for each real end client into a Google Sheet. | [README & user guide](task1-job-outreach/README.md) · [n8n export](task1-job-outreach/workflow/) · [Sample output](task1-job-outreach/sample-output/) · Google Sheet: _link added before submission_ |
| **2. Executive Travel Planner** | A Notion workspace for founder travel: one Trips database, a mobile-friendly Trip Brief template, and Timeline and Status views. | _Notion link added before submission_ |

## Task 1 at a glance

- **Framing:** a company hiring an EA is a warm sales lead for RAY's assistant service, so the message offers RAY's service rather than applying for the job.
- **Stack:** n8n Cloud · Himalayas + Arbeitnow public APIs · Claude Haiku (checks) and Claude Sonnet (writing) · Google Sheets · Gmail.
- **Validation:** remote, English-speaking, relevant, and **a real end client, not a staffing agency**. Free rule checks run first, then a structured Claude verdict. Every rejection is logged with its reason.
- **Production features:** de-duplicated daily runs, a Run Log, error alerts, a daily summary email for the sales rep, settings and prompt versions editable in the Sheet, and handling for expired jobs as the source's terms require.
- **Real result:** 524 jobs checked → 16 qualified leads with ready-to-send messages.

## Repository layout

```
├── README.md                         ← you are here
├── task1-job-outreach/
│   ├── README.md                     ← architecture, setup, user guide, troubleshooting
│   ├── workflow/                     ← n8n workflow exports (main + error alert)
│   ├── sheet-template/               ← empty Google Sheet template (.xlsx)
│   └── sample-output/                ← real run output: leads, rejections, run log (CSV/JSON)
└── task2-notion-travel-planner/      ← design notes and screenshots
```

No API keys or credentials are stored in this repository. They live only in n8n's credential store.
