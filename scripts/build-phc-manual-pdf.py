from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    Image,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf" / "PHC_Clinical_User_Manual.pdf"
ASSETS = ROOT / "public" / "images" / "training"

NAVY = colors.HexColor("#0f2742")
TEAL = colors.HexColor("#087f83")
EMERALD = colors.HexColor("#047857")
MINT = colors.HexColor("#e8f7f1")
PALE_BLUE = colors.HexColor("#eff7ff")
AMBER = colors.HexColor("#b45309")
INK = colors.HexColor("#172033")
MUTED = colors.HexColor("#5b6878")
LINE = colors.HexColor("#d8e1e8")


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="CoverTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=27,
    leading=32, textColor=colors.white, alignment=TA_LEFT, spaceAfter=5 * mm,
))
styles.add(ParagraphStyle(
    name="CoverSub", parent=styles["Normal"], fontName="Helvetica", fontSize=12,
    leading=18, textColor=colors.HexColor("#5b6878"), alignment=TA_LEFT,
))
styles.add(ParagraphStyle(
    name="Section", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=20,
    leading=24, textColor=NAVY, spaceBefore=1 * mm, spaceAfter=3 * mm,
))
styles.add(ParagraphStyle(
    name="SectionLead", parent=styles["Normal"], fontName="Helvetica", fontSize=10.5,
    leading=15, textColor=MUTED, spaceAfter=4 * mm,
))
styles.add(ParagraphStyle(
    name="H2", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=13,
    leading=16, textColor=TEAL, spaceBefore=2 * mm, spaceAfter=2 * mm,
))
styles.add(ParagraphStyle(
    name="Body", parent=styles["BodyText"], fontName="Helvetica", fontSize=9.3,
    leading=13.2, textColor=INK, spaceAfter=2.5 * mm,
))
styles.add(ParagraphStyle(
    name="Small", parent=styles["BodyText"], fontName="Helvetica", fontSize=8,
    leading=10.5, textColor=MUTED,
))
styles.add(ParagraphStyle(
    name="Callout", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=9.2,
    leading=13, textColor=NAVY,
))
styles.add(ParagraphStyle(
    name="TableHead", parent=styles["BodyText"], fontName="Helvetica-Bold", fontSize=8.5,
    leading=11, textColor=colors.white,
))
styles.add(ParagraphStyle(
    name="TableCell", parent=styles["BodyText"], fontName="Helvetica", fontSize=8,
    leading=10, textColor=INK,
))


def P(text, style="Body"):
    return Paragraph(escape(text).replace("\n", "<br/>"), styles[style])


def rich(text, style="Body"):
    return Paragraph(text, styles[style])


class StepCard(Flowable):
    def __init__(self, number, title, body, kind="check"):
        super().__init__()
        self.number = str(number)
        self.title = title
        self.body = body
        self.kind = kind
        self.height = 29 * mm
        self.width = 80 * mm

    def wrap(self, width, height):
        self.width = width
        return width, self.height

    def _icon(self, canvas, x, y):
        canvas.saveState()
        canvas.setStrokeColor(TEAL)
        canvas.setFillColor(colors.white)
        canvas.setLineWidth(1.2)
        if self.kind in {"scope", "person"}:
            canvas.circle(x + 7 * mm, y + 8 * mm, 3 * mm, stroke=1, fill=0)
            canvas.line(x + 3 * mm, y + 2 * mm, x + 11 * mm, y + 2 * mm)
            canvas.line(x + 4 * mm, y + 4 * mm, x + 10 * mm, y + 4 * mm)
        elif self.kind in {"check", "consent", "sign"}:
            canvas.circle(x + 7 * mm, y + 7 * mm, 5 * mm, stroke=1, fill=0)
            canvas.line(x + 4.5 * mm, y + 7 * mm, x + 6.5 * mm, y + 5 * mm)
            canvas.line(x + 6.5 * mm, y + 5 * mm, x + 10.5 * mm, y + 9 * mm)
        elif self.kind in {"arrow", "handoff", "referral"}:
            canvas.line(x + 2 * mm, y + 7 * mm, x + 11 * mm, y + 7 * mm)
            canvas.line(x + 8 * mm, y + 10 * mm, x + 11 * mm, y + 7 * mm)
            canvas.line(x + 8 * mm, y + 4 * mm, x + 11 * mm, y + 7 * mm)
        elif self.kind in {"record", "note"}:
            canvas.rect(x + 3 * mm, y + 2 * mm, 8 * mm, 10 * mm, stroke=1, fill=0)
            canvas.line(x + 5 * mm, y + 9 * mm, x + 9 * mm, y + 9 * mm)
            canvas.line(x + 5 * mm, y + 6 * mm, x + 9 * mm, y + 6 * mm)
        elif self.kind == "video":
            canvas.rect(x + 2 * mm, y + 4 * mm, 8 * mm, 7 * mm, stroke=1, fill=0)
            canvas.line(x + 10 * mm, y + 9 * mm, x + 13 * mm, y + 11 * mm)
            canvas.line(x + 13 * mm, y + 11 * mm, x + 13 * mm, y + 4 * mm)
            canvas.line(x + 13 * mm, y + 4 * mm, x + 10 * mm, y + 6 * mm)
        elif self.kind == "offline":
            canvas.circle(x + 5 * mm, y + 7 * mm, 3 * mm, stroke=1, fill=0)
            canvas.circle(x + 9 * mm, y + 8 * mm, 3.5 * mm, stroke=1, fill=0)
            canvas.line(x + 3 * mm, y + 4 * mm, x + 12 * mm, y + 4 * mm)
            canvas.line(x + 7 * mm, y + 1 * mm, x + 7 * mm, y - 2 * mm)
            canvas.line(x + 4 * mm, y + 1 * mm, x + 7 * mm, y - 2 * mm)
            canvas.line(x + 10 * mm, y + 1 * mm, x + 7 * mm, y - 2 * mm)
        elif self.kind == "alert":
            canvas.setFillColor(colors.HexColor("#fff7ed"))
            canvas.setStrokeColor(AMBER)
            canvas.line(x + 7 * mm, y + 12 * mm, x + 1 * mm, y + 2 * mm)
            canvas.line(x + 1 * mm, y + 2 * mm, x + 13 * mm, y + 2 * mm)
            canvas.line(x + 13 * mm, y + 2 * mm, x + 7 * mm, y + 12 * mm)
            canvas.setFillColor(AMBER)
            canvas.circle(x + 7 * mm, y + 5 * mm, 0.7 * mm, stroke=0, fill=1)
            canvas.line(x + 7 * mm, y + 7 * mm, x + 7 * mm, y + 9 * mm)
        elif self.kind == "shield":
            canvas.setStrokeColor(EMERALD)
            path = canvas.beginPath()
            path.moveTo(x + 7 * mm, y + 13 * mm)
            path.lineTo(x + 12 * mm, y + 10 * mm)
            path.lineTo(x + 11 * mm, y + 4 * mm)
            path.lineTo(x + 7 * mm, y + 1 * mm)
            path.lineTo(x + 3 * mm, y + 4 * mm)
            path.lineTo(x + 2 * mm, y + 10 * mm)
            path.close()
            canvas.drawPath(path, stroke=1, fill=0)
            canvas.line(x + 4.5 * mm, y + 7 * mm, x + 6.5 * mm, y + 5 * mm)
            canvas.line(x + 6.5 * mm, y + 5 * mm, x + 9.5 * mm, y + 9 * mm)
        canvas.restoreState()

    def draw(self):
        c = self.canv
        c.saveState()
        c.setFillColor(colors.white)
        c.setStrokeColor(LINE)
        c.roundRect(0, 0, self.width, self.height, 3 * mm, stroke=1, fill=1)
        c.setFillColor(MINT)
        c.roundRect(2 * mm, 2 * mm, 18 * mm, self.height - 4 * mm, 2 * mm, stroke=0, fill=1)
        c.setFillColor(TEAL)
        c.circle(11 * mm, self.height - 9 * mm, 5 * mm, stroke=0, fill=1)
        c.setFillColor(colors.white)
        c.setFont("Helvetica-Bold", 8)
        c.drawCentredString(11 * mm, self.height - 11 * mm, self.number)
        self._icon(c, 4 * mm, 5 * mm)
        title = Paragraph(escape(self.title), styles["Callout"])
        body = Paragraph(escape(self.body), styles["Small"])
        text_x = 24 * mm
        available = self.width - text_x - 4 * mm
        _, title_h = title.wrap(available, 20 * mm)
        _, body_h = body.wrap(available, 19 * mm)
        title.drawOn(c, text_x, self.height - 7 * mm - title_h)
        body.drawOn(c, text_x, self.height - 10 * mm - title_h - body_h)
        c.restoreState()


def step_grid(steps):
    cells = [StepCard(*step) for step in steps]
    rows = []
    for index in range(0, len(cells), 2):
        row = cells[index:index + 2]
        if len(row) == 1:
            row.append(Spacer(1, 1))
        rows.append(row)
    table = Table(rows, colWidths=[87 * mm, 87 * mm], hAlign="LEFT")
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
    ]))
    return table


def hero_image(name, width=178 * mm, height=72 * mm):
    return Image(str(ASSETS / name), width=width, height=height)


def section_heading(number, title, lead):
    return [P(f"{number}  {title}", "Section"), P(lead, "SectionLead")]


def callout(title, body, fill=MINT):
    t = Table([[rich(f"<b>{escape(title)}</b><br/>{escape(body)}", "Body")]], colWidths=[178 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), fill),
        ("BOX", (0, 0), (-1, -1), 0.6, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 5 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 3 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm),
    ]))
    return t


def header_footer(canvas, doc):
    canvas.saveState()
    page = canvas.getPageNumber()
    if page > 1:
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(16 * mm, 283 * mm, 194 * mm, 283 * mm)
        canvas.setFont("Helvetica-Bold", 8)
        canvas.setFillColor(TEAL)
        canvas.drawString(16 * mm, 287 * mm, "DOCTARX NIGERIA | PHC FIELD GUIDE")
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(194 * mm, 287 * mm, "Nurse and doctor training workbook")
        canvas.setStrokeColor(LINE)
        canvas.line(16 * mm, 13 * mm, 194 * mm, 13 * mm)
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(16 * mm, 8 * mm, "Use with local clinical SOPs. No real patient data in training materials.")
        canvas.drawRightString(194 * mm, 8 * mm, f"Page {page}")
    canvas.restoreState()


def build_story():
    story = []
    story.append(Spacer(1, 11 * mm))
    cover = Table([[rich("<font color='#d9fff2'>DOCTARX NIGERIA</font><br/><br/>PHC CLINICAL<br/>USER MANUAL", "CoverTitle"), hero_image("phc-nurse-intake.png", 95 * mm, 63 * mm)]], colWidths=[78 * mm, 100 * mm], rowHeights=[80 * mm])
    cover.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (0, 0), 9 * mm),
        ("RIGHTPADDING", (0, 0), (0, 0), 4 * mm),
        ("LEFTPADDING", (1, 0), (1, 0), 0),
        ("RIGHTPADDING", (1, 0), (1, 0), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(cover)
    story.append(Spacer(1, 8 * mm))
    story.append(P("A visual, teach-back friendly guide for PHC nurses, remote doctors, consultants, supervisors, facility administrators, and controlled developer demonstrations.", "CoverSub"))
    story.append(Spacer(1, 7 * mm))
    story.append(callout("How to use this workbook", "Read the short instruction, study the visual step card, then demonstrate the action in the Training & assessment tab at /ng/phc. The qualified assessor records the official result in the facility training register.", PALE_BLUE))
    story.append(Spacer(1, 7 * mm))
    story.append(P("Manual version 1.0 | Generated for DoctaRx Nigeria PHC workspace | Print-friendly PDF", "Small"))
    story.append(PageBreak())

    story.extend(section_heading("1", "Before you begin", "The safest workflow starts before the first patient record is opened."))
    story.append(hero_image("phc-scope-consent.png"))
    story.append(Spacer(1, 3 * mm))
    story.append(step_grid([
        ("01", "Use your own account", "Never share a password or leave a signed-in device unattended.", "person"),
        ("02", "Confirm programme scope", "Read the programme and facility badges. Stop if the scope is wrong.", "scope"),
        ("03", "Confirm identity and consent", "Use minimum necessary identifiers and protect the conversation.", "consent"),
        ("04", "Use fictional training data", "Never type a real patient identifier into a checklist, screenshot, or demo note.", "shield"),
        ("05", "Know the escalation route", "For danger signs or safeguarding concerns, follow the facility pathway first.", "alert"),
    ]))
    story.append(callout("Safety boundary", "The workspace supports clinical work; it is not an emergency response service and this workbook does not replace local SOPs or professional judgement.", colors.HexColor("#fff7ed")))
    story.append(PageBreak())

    story.extend(section_heading("2", "The five-minute safe start", "Use this visual sequence at the beginning of every supervised practice case."))
    story.append(hero_image("phc-nurse-intake.png"))
    story.append(Spacer(1, 3 * mm))
    story.append(step_grid([
        ("01", "Confirm scope", "Read the programme, facility, and role badge before opening a record.", "scope"),
        ("02", "Confirm the person", "Check identity and consent before documenting the complaint or observations.", "person"),
        ("03", "Capture clearly", "Use the correct observation type and unit; re-check surprising values.", "record"),
        ("04", "Close the loop", "Assign or claim the work, sign the core note, and name the next action.", "sign"),
        ("05", "Escalate early", "Use local emergency and safeguarding pathways when danger signs appear.", "alert"),
    ]))
    story.append(callout("Teach-back prompt", "Ask the learner to explain what they would do if the programme badge is wrong, consent is unclear, or an observation does not fit the clinical picture.", MINT))
    story.append(PageBreak())

    story.extend(section_heading("3", "Nurse workflow: intake to handoff", "Nurses turn a respectful patient conversation into a structured, readable clinician handoff."))
    story.append(hero_image("phc-nurse-handoff.png"))
    story.append(Spacer(1, 3 * mm))
    story.append(step_grid([
        ("01", "Sign in and open PHC", "Use /ng/provider/login, then open /ng/phc.", "person"),
        ("02", "Select the assigned context", "Choose the correct programme and facility shown in the header.", "scope"),
        ("03", "Find the enrolled patient", "Confirm identity and consent before starting or resuming intake.", "person"),
        ("04", "Record the complaint", "Use clear, minimum-necessary language; avoid adding a clinician diagnosis.", "record"),
        ("05", "Add observations", "Capture blood pressure, pulse, temperature, or oxygen saturation with units.", "record"),
        ("06", "Review the summary", "Correct missing or surprising values before dispatching the encounter.", "check"),
        ("07", "Dispatch to the queue", "Send the completed intake to the clinician queue using the permitted action.", "handoff"),
        ("08", "Arrange continuity", "Create a follow-up when the next contact or review date is known.", "referral"),
    ]))
    story.append(callout("Nurse teach-back", "The learner should explain why every observation has a unit, how to correct a mistaken value, and who owns the next action after dispatch.", PALE_BLUE))
    story.append(PageBreak())

    story.extend(section_heading("4", "Doctor or consultant workflow", "Assigned clinicians review the queue, consult with context, sign the core note, and close the loop."))
    story.append(hero_image("phc-remote-consult.png"))
    story.append(Spacer(1, 3 * mm))
    story.append(step_grid([
        ("01", "Sign in and confirm context", "Use /ng/provider/login and verify the programme and facility badge.", "scope"),
        ("02", "Review assigned work", "Open only queue items assigned to the clinician role.", "record"),
        ("03", "Claim the case", "Move the item through called and in-consultation status as appropriate.", "handoff"),
        ("04", "Consult with context", "Review intake, observations, and relevant history with the patient.", "video"),
        ("05", "Document assessment and plan", "Write the clinical note. Treat optional AI suggestions as drafts only.", "note"),
        ("06", "Sign the core note", "A qualified clinician must sign before the encounter can be completed.", "sign"),
        ("07", "Complete or refer", "Complete the encounter, create a follow-up, or create a referral.", "referral"),
        ("08", "Re-check ownership", "Confirm no assigned case is left without a next action.", "check"),
    ]))
    story.append(callout("Human sign-off", "AI is optional and review-only. The qualified clinician owns the final assessment, note, plan, and referral decision.", colors.HexColor("#fff7ed")))
    story.append(PageBreak())

    story.extend(section_heading("5", "Follow-ups and referrals", "Continuity is visible when the next owner and outcome are explicit."))
    story.append(hero_image("phc-followup-referral.png"))
    story.append(Spacer(1, 3 * mm))
    story.append(step_grid([
        ("01", "Choose follow-up or referral", "Use a follow-up for the same care team; use a referral for another service.", "referral"),
        ("02", "Name the next owner", "State who will contact, accept, review, or complete the next action.", "person"),
        ("03", "Track acceptance", "A referral remains open until the receiving service accepts it.", "handoff"),
        ("04", "Record the outcome", "Close only when the outcome or closure reason is recorded.", "check"),
    ]))
    story.append(callout("Do not close on send", "Sending a message is not the same as a completed referral. Confirm acceptance and outcome through the referral workflow.", MINT))
    story.append(PageBreak())

    story.extend(section_heading("6", "Offline capture and synchronisation", "Offline means encrypted and queued - not uploaded. Keep the device and context stable."))
    story.append(hero_image("phc-offline-sync.png"))
    story.append(Spacer(1, 3 * mm))
    story.append(step_grid([
        ("01", "Check the status", "Start only when the programme has explicitly enabled protected offline capture.", "offline"),
        ("02", "Capture the minimum", "Record only what is needed and keep the device physically secure.", "record"),
        ("03", "Keep scope stable", "Do not change programme or facility context while an item is pending.", "scope"),
        ("04", "Return online and sync", "Confirm the correct context, then use Sync when the connection returns.", "offline"),
        ("05", "Resolve conflicts safely", "Ask a supervisor to reconcile rejected or conflicted items; never create a duplicate patient.", "shield"),
    ]))
    story.append(callout("Offline safety", "If the device is lost or compromised, follow the facility security and incident process immediately. Do not copy queued clinical text into personal notes or external tools.", colors.HexColor("#fff7ed")))
    story.append(PageBreak())

    story.extend(section_heading("7", "Privacy, AI, and escalation", "The workspace is designed around least privilege, auditability, and human accountability."))
    story.append(hero_image("phc-escalation.png"))
    story.append(Spacer(1, 3 * mm))
    story.append(step_grid([
        ("01", "Stay inside role scope", "Programme and facility scope is enforced for every clinical request.", "scope"),
        ("02", "Use break-glass only in an emergency", "Emergency access is audited and must have a documented reason.", "alert"),
        ("03", "Treat AI as a draft", "Verify every suggestion against the patient and accepted clinical guidance.", "note"),
        ("04", "Escalate danger signs", "Use the local emergency, safeguarding, and supervisor pathways first.", "alert"),
        ("05", "Protect minimum necessary data", "Do not place identifiers in screenshots, training notes, or external tools.", "shield"),
    ]))
    story.append(callout("Government reporting boundary", "Government views are aggregate-only. They do not expose patient-level clinical records and DHIS2 integration remains dry-run only.", PALE_BLUE))
    story.append(PageBreak())

    story.extend(section_heading("8", "Supervisor teach-back assessment", "Use the product checklist during observation; record official results in the approved local training register."))
    story.append(hero_image("phc-assessment.png"))
    story.append(Spacer(1, 3 * mm))
    story.append(step_grid([
        ("01", "Observe the whole flow", "Watch the learner select scope, confirm identity, and start the right workflow.", "person"),
        ("02", "Ask for an explanation", "Use teach-back instead of yes/no questions.", "check"),
        ("03", "Test a correction", "Ask how the learner would correct a wrong value or unclear consent.", "record"),
        ("04", "Test ownership", "Ask who owns the next action after dispatch, follow-up, or referral.", "handoff"),
        ("05", "Test sign-off knowledge", "Ask why the clinician core note must be signed before completion.", "sign"),
        ("06", "Test offline safety", "Ask what must remain stable before a queued item is synced.", "offline"),
        ("07", "Record the outcome locally", "Keep patient identifiers out of the checklist and use the facility register.", "shield"),
    ]))
    story.append(PageBreak())

    story.extend(section_heading("9", "Assessment rubric and troubleshooting", "The visual checklist supports a consistent conversation; the assessor makes the final training decision."))
    rubric = [
        [rich("Domain", "TableHead"), rich("Meets standard when the learner can...", "TableHead")],
        [P("Scope", "TableCell"), P("Select the correct programme and facility and explain why accounts must not be shared.", "TableCell")],
        [P("Consent and privacy", "TableCell"), P("Explain consent, minimum necessary access, and emergency escalation.", "TableCell")],
        [P("Observations", "TableCell"), P("Capture a value with the right unit, recognise an implausible value, and re-check it.", "TableCell")],
        [P("Queue ownership", "TableCell"), P("Dispatch or claim only the work permitted by the learner's role.", "TableCell")],
        [P("Documentation", "TableCell"), P("Explain that the clinician signs the core note before completion.", "TableCell")],
        [P("Continuity", "TableCell"), P("Create the correct follow-up or referral and identify the next owner.", "TableCell")],
        [P("Offline safety", "TableCell"), P("Protect the device, preserve scope, and sync without duplicating or bypassing conflicts.", "TableCell")],
    ]
    rubric_table = Table(rubric, colWidths=[42 * mm, 136 * mm], repeatRows=1)
    rubric_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5 * mm),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f7fafc")]),
    ]))
    story.append(rubric_table)
    story.append(Spacer(1, 5 * mm))
    story.append(P("Quick fixes", "H2"))
    story.append(step_grid([
        ("01", "No programme visible", "Contact the facility administrator; do not use another person's account.", "scope"),
        ("02", "Queue action unavailable", "The role or current status may not permit that transition.", "handoff"),
        ("03", "Cannot complete", "Check that the required clinician core note is signed.", "sign"),
        ("04", "Sync conflict", "Stop editing the item and ask a supervisor to reconcile it.", "offline"),
    ]))
    story.append(PageBreak())

    story.extend(section_heading("10", "Developer demonstration", "Use fictional accounts only, and keep training evidence separate from clinical records."))
    story.append(hero_image("phc-nurse-intake.png"))
    story.append(Spacer(1, 4 * mm))
    story.append(P("The online developer accounts and routes are maintained in ng/docs/DEVELOPER_DEMO_LOGINS.md. Government and executive accounts require MFA. The in-product checklist is intentionally local to the browser and contains no PHI.", "Body"))
    story.append(callout("Print and share safely", "Use the Training & assessment tab's Print / save guide button or this PDF for orientation. Before sharing externally, remove any locally added notes and confirm no patient identifiers are present.", PALE_BLUE))
    story.append(Spacer(1, 8 * mm))
    story.append(P("Ownership and review", "H2"))
    story.append(P("Review this guide whenever the intake, queue, sign-off, referral, offline, AI, or permission model changes. Local clinical governance remains authoritative.", "Body"))
    story.append(Spacer(1, 15 * mm))
    story.append(P("End of manual", "Small"))
    return story


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    frame = Frame(16 * mm, 18 * mm, 178 * mm, 260 * mm, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc = BaseDocTemplate(
        str(OUT), pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm,
        topMargin=18 * mm, bottomMargin=18 * mm, title="DoctaRx Nigeria PHC Clinical User Manual",
        author="DoctaRx",
    )
    doc.addPageTemplates([PageTemplate(id="manual", frames=[frame], onPage=header_footer)])
    doc.build(build_story())
    print(f"Created {OUT}")


if __name__ == "__main__":
    main()
