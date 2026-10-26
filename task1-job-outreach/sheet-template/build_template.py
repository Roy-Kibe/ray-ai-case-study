"""Build the Google Sheet template for the RAY lead engine.

Run:  python build_template.py
Out:  RAY_Lead_Engine_Template.xlsx (upload to Google Drive -> Open with Google Sheets)

The n8n workflow reads `Settings` by the hidden ID column (A), so labels in
column B can be reworded freely without breaking anything.
"""
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation

OUT = "RAY_Lead_Engine_Template.xlsx"
MAX_ROWS = 2000  # rows covered by dropdowns on data tabs

FONT = Font(name="Arial", size=10)
BOLD = Font(name="Arial", size=10, bold=True)
HEADER_FONT = Font(name="Arial", size=10, bold=True, color="FFFFFF")
HEADER_FILL = PatternFill("solid", fgColor="1F2937")
SECTION_FILL = PatternFill("solid", fgColor="E5E7EB")
INPUT_FILL = PatternFill("solid", fgColor="FFF9C4")  # yellow = "you edit this"
WRAP = Alignment(wrap_text=True, vertical="top")

RAY_PITCH = (
    "RAY AI provides dedicated, full-time (40 hrs/week) human executive assistants who are "
    "trained to work with AI tools, for founders and investors in the US and Europe. RAYs are "
    "selected from 120k+ applicants a year (top 0.03%), go through a 4-week bootcamp, and are "
    "backed by coaches, a mentor, and a community of automation and design experts. They handle "
    "inbox, calendar, travel, expenses, CRM, and follow-ups, at a fraction of the cost of a "
    "traditional hire. GDPR-compliant and $1M insured."
)

AGENCIES = (
    "Wing Assistant, Assist World, OurAssistants, My Hero VA, Assistant Launch, VirtuHire, "
    "Hire Hangar, Globibo, ScaleJet, Green Key Resources, Hays, Reed, Gainor Staffing, "
    "AscendHire, Joss Search"
)

# (id, label, value, help). id=None marks a section row. "yesno" in value => dropdown.
SETTINGS = [
    (None, "🔎 WHAT TO SEARCH", None, None),
    ("search_terms", "Job titles to search for",
     "Executive Assistant, Administrative Assistant, Personal Assistant, Virtual Assistant, "
     "Chief of Staff, Office Manager", "Separate with commas."),
    ("source_himalayas", "Search Himalayas?", "Yes", "Main source: remote jobs worldwide."),
    ("source_arbeitnow", "Search Arbeitnow?", "Yes", "Second source: mostly Europe."),
    ("jobs_per_run", "How many jobs to check per run", 100,
     "Per source. The workflow works out the pages for you."),
    ("max_age_days", "Only jobs posted in the last ___ days", 14, ""),
    ("max_new_leads", "Max new leads per day", 25, "Keeps AI costs predictable."),
    (None, "🚫 WHAT TO SKIP", None, None),
    ("exclude_title_words", "Skip titles containing",
     "intern, paralegal, legal secretary, medical, dental, teaching assistant",
     "Separate with commas."),
    ("agency_blocklist", "Skip these companies (agencies & recruiters)", AGENCIES,
     "Exact company names, separated by commas. These are competitors or middlemen, not "
     "leads. The AI also catches agencies that aren't on this list."),
    ("allow_bilingual", "Allow roles needing a second language?", "No",
     "RAYs work in English. 'No' rejects roles that require e.g. Spanish or German."),
    ("min_fit_score", "Minimum lead quality (0–100)", 60,
     "Lower = more leads, less precise."),
    (None, "✉️ YOUR MESSAGES", None, None),
    ("sender_name", "Your name", "Roy Githara", "Used in the email signature."),
    ("sender_title", "Your job title", "", "Optional."),
    ("company_pitch", "About RAY (facts the AI may use)", RAY_PITCH,
     "The AI will not claim anything that isn't written here."),
    ("call_to_action", "Closing question", "Would a 15-minute call this week be useful?", ""),
    ("booking_link", "Booking link", "", "Optional, e.g. a Calendly link."),
    ("max_words", "Max message length (words)", 150, ""),
    (None, "📬 DAILY EMAIL", None, None),
    ("digest_enabled", "Send me a daily summary?", "Yes", ""),
    ("digest_to", "Send it to", "roygithara6@gmail.com", ""),
    ("digest_top_n", "How many top leads to include", 10, ""),
    ("alert_to", "Send error alerts to", "roygithara6@gmail.com", ""),
    (None, "⚙️ ADVANCED (no need to change)", None, None),
    ("classifier_model", "AI model for checking jobs", "claude-haiku-5-5",
     "Fast, low-cost model for the 4 checks."),
    ("writer_model", "AI model for writing messages", "claude-sonnet-5-5",
     "Stronger model for outreach messages."),
]
YESNO_IDS = {"source_himalayas", "source_arbeitnow", "allow_bilingual", "digest_enabled"}

PLACEHOLDERS = (
    "Placeholders: {{job_title}} {{company_name}} {{location}} {{job_description}} {{hooks}} "
    "{{company_pitch}} {{sender_name}} {{sender_title}} {{call_to_action}} {{booking_link}} "
    "{{max_words}}"
)

PROMPTS = [
    ("v1", "Yes", "Consultative",
     "You're writing a cold email on behalf of {{sender_name}} {{sender_title}} at RAY AI.\n\n"
     "{{company_name}} is hiring a \"{{job_title}}\" ({{location}}).\n"
     "Specific details from their posting: {{hooks}}\n\n"
     "What RAY offers: {{company_pitch}}\n\n"
     "Write an email to the hiring founder/manager that:\n"
     "1. Opens with something specific to their posting, not flattery.\n"
     "2. Connects one or two of their stated needs to how RAY's assistants handle them.\n"
     "3. Positions RAY as a faster, more capable alternative or complement to the hire, without "
     "criticizing their plan.\n"
     "4. Ends with: {{call_to_action}} {{booking_link}}\n\n"
     "Tone: warm, peer-to-peer. Max {{max_words}} words.",
     "Default. " + PLACEHOLDERS),
    ("v2", "No", "Short & direct",
     "Write a cold email from {{sender_name}} {{sender_title}} at RAY AI to {{company_name}}, "
     "which is hiring a \"{{job_title}}\".\n\n"
     "Details from their posting: {{hooks}}\n"
     "What RAY offers: {{company_pitch}}\n\n"
     "Rules: at most 80 words and 3 sentences. Sentence 1 references one specific detail from "
     "the posting. Sentence 2 says how a RAY assistant covers it. Sentence 3 is the ask: "
     "{{call_to_action}} {{booking_link}}",
     "For testing whether shorter emails get more replies."),
    ("v3", "No", "Founder-to-founder",
     "Write a cold email from {{sender_name}} {{sender_title}} at RAY AI to the founder of "
     "{{company_name}}, who is hiring a \"{{job_title}}\" ({{location}}).\n\n"
     "Details from their posting: {{hooks}}\n"
     "What RAY offers: {{company_pitch}}\n\n"
     "Write as one founder-minded person to another. Focus on the founder's time: hiring an EA "
     "takes weeks of sourcing and interviews, and RAY skips that with a pre-vetted, "
     "AI-trained assistant. Reference one specific detail from their posting. End with: "
     "{{call_to_action}} {{booking_link}}\n\nMax {{max_words}} words.",
     "Time-saving angle."),
]

# Required columns first, in the exact order from the brief; then working columns.
LEADS_COLS = [
    ("Job Posting URL", 40), ("Job Title", 28), ("Company Name", 22), ("Location", 20),
    ("Job Description", 50), ("LLM-Generated Outreach Message", 60),
    ("Fit Score", 10), ("Why it matched", 40), ("Status", 12), ("Date Found", 12),
    ("Follow-up Date", 14), ("Language Requirements", 18), ("Expires", 12),
    ("Prompt Version", 10), ("Source", 12), ("Notes", 30),
]
REJECTED_COLS = [
    ("Date", 12), ("Job Posting URL", 40), ("Job Title", 28), ("Company Name", 22),
    ("Source", 12), ("Failed Check", 18), ("Reason", 60),
]
RUNLOG_COLS = [
    ("Run Time", 20), ("Status", 10), ("Jobs Fetched", 12), ("After Pre-filter", 14),
    ("Classified", 11), ("New Leads", 10), ("Rejected", 10), ("Duplicates Skipped", 16),
    ("Errors", 50),
]

START_HERE = [
    ("RAY Lead Engine: how to use this Sheet", BOLD),
    ("", FONT),
    ("Every day, an n8n workflow finds companies hiring Executive/Admin Assistants, checks that "
     "each job is remote, English-speaking, relevant, and posted by a real company (not an "
     "agency), then writes a personalized outreach email pitching RAY. Results land in "
     "the Leads tab.", FONT),
    ("", FONT),
    ("TABS", BOLD),
    ("Leads: your work queue. Work top-down by Fit Score, then update Status and Follow-up Date.", FONT),
    ("Settings: change what to search, what to skip, and your signature. Edit only the yellow cells.", FONT),
    ("Prompts: email styles. Set exactly one row to Active = Yes to switch the tone.", FONT),
    ("Rejected: jobs that were filtered out, and why. Check here if you think a good lead was missed.", FONT),
    ("Run Log: one row per run, showing how many jobs were found, kept, and rejected.", FONT),
    ("", FONT),
    ("DAILY ROUTINE FOR THE SALES REP", BOLD),
    ("1. Open the daily summary email, or filter Leads by Status = New.", FONT),
    ("2. Read the message, edit it if needed, and send it from your own inbox.", FONT),
    ("3. Set Status to Contacted and set a Follow-up Date.", FONT),
    ("4. Update Status as replies come in (Replied / Won / Lost).", FONT),
    ("", FONT),
    ("EXAMPLE LEAD ROW (what a good lead looks like)", BOLD),
    ("Job Title: Executive Assistant to the CEO | Company: Percona | Location: Europe/UK | "
     "Fit Score: 85 | Status: New | Source: Himalayas", FONT),
    ("", FONT),
    ("Job data comes from Himalayas (himalayas.app) and Arbeitnow (arbeitnow.com). Job links "
     "point back to the original postings, as their API terms require.", FONT),
]


def header(ws, cols):
    for i, (name, width) in enumerate(cols, start=1):
        c = ws.cell(row=1, column=i, value=name)
        c.font, c.fill, c.alignment = HEADER_FONT, HEADER_FILL, WRAP
        ws.column_dimensions[c.column_letter].width = width
    ws.freeze_panes = "A2"


def yesno(ws, ref):
    dv = DataValidation(type="list", formula1='"Yes,No"', allow_blank=False)
    ws.add_data_validation(dv)
    dv.add(ref)


def build():
    wb = Workbook()

    ws = wb.active
    ws.title = "Start Here"
    ws.column_dimensions["A"].width = 110
    for r, (text, font) in enumerate(START_HERE, start=1):
        c = ws.cell(row=r, column=1, value=text)
        c.font, c.alignment = font, WRAP

    ws = wb.create_sheet("Leads")
    header(ws, LEADS_COLS)
    dv = DataValidation(type="list", formula1='"New,Contacted,Replied,Won,Lost,Expired"')
    ws.add_data_validation(dv)
    dv.add(f"I2:I{MAX_ROWS}")

    ws = wb.create_sheet("Settings")
    header(ws, [("ID", 18), ("Setting", 42), ("Your choice", 70), ("Help", 55)])
    ws.column_dimensions["A"].hidden = True
    for r, (sid, label, value, help_) in enumerate(SETTINGS, start=2):
        if sid is None:
            for col in range(1, 5):
                ws.cell(row=r, column=col).fill = SECTION_FILL
            ws.cell(row=r, column=2, value=label).font = BOLD
            continue
        ws.cell(row=r, column=1, value=sid).font = FONT
        ws.cell(row=r, column=2, value=label).font = FONT
        v = ws.cell(row=r, column=3, value=value)
        v.font, v.fill, v.alignment = FONT, INPUT_FILL, WRAP
        h = ws.cell(row=r, column=4, value=help_)
        h.font, h.alignment = Font(name="Arial", size=9, italic=True, color="6B7280"), WRAP
        if sid in YESNO_IDS:
            yesno(ws, f"C{r}")

    ws = wb.create_sheet("Prompts")
    header(ws, [("Prompt ID", 10), ("Active", 9), ("Tone", 18), ("Prompt Template", 90), ("Notes", 45)])
    for r, row in enumerate(PROMPTS, start=2):
        for col, val in enumerate(row, start=1):
            c = ws.cell(row=r, column=col, value=val)
            c.font, c.alignment = FONT, WRAP
            if col in (2, 4):
                c.fill = INPUT_FILL
    yesno(ws, f"B2:B{MAX_ROWS}")

    ws = wb.create_sheet("Rejected")
    header(ws, REJECTED_COLS)

    ws = wb.create_sheet("Run Log")
    header(ws, RUNLOG_COLS)

    wb.save(OUT)
    print(f"Saved {OUT}")


if __name__ == "__main__":
    build()
