"""Builds docs/MuVi_Rehab_Technical_Report.docx (Day 20).

    .\\scripts\\docs\\make_report.ps1            (creates tools/docs/.venv, builds, fills the
                                               table of contents with Word and counts pages)
    tools\\docs\\.venv\\Scripts\\python.exe tools\\docs\\build_report.py   (the .docx only)

Everything comes from the repository: the identity from web/src/config/project.ts, the version
from server/app/__init__.py, the games from shared/game-specs.json, the measures from
shared/metrics-catalog.json, the EMG thresholds from web/src/emg/emgSettings.json, the routes from
docs/api-contract.md, the tables from docs/data-dictionary.md, the settings from
server/.env.example, the results from docs/results-summary.md, and the images from docs/images/.
The explanations are in report_content.py, with the file that handles each part.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "MuVi_Rehab_Technical_Report.docx"
IMAGES = ROOT / "docs" / "images"
TEAL = RGBColor(0x0F, 0x5C, 0x5C)


# ---------------------------------------------------------------------------------------------
# Facts read from the repository


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


@dataclass
class Facts:
    project: dict[str, Any] = field(default_factory=dict)
    version: str = ""
    strings: dict[str, str] = field(default_factory=dict)
    games: list[dict[str, Any]] = field(default_factory=list)
    metrics: list[dict[str, Any]] = field(default_factory=list)
    emg_settings: dict[str, dict[str, Any]] = field(default_factory=dict)
    routes: list[tuple[str, str, str, str]] = field(default_factory=list)
    tables: list[tuple[str, str, int]] = field(default_factory=list)
    settings: list[tuple[str, str, str]] = field(default_factory=list)
    results: list[tuple[str, str, str, str]] = field(default_factory=list)


def load_project() -> dict[str, Any]:
    text = read("web/src/config/project.ts")
    def one(key: str) -> str:
        match = re.search(rf'{key}:\s*\n?\s*"([^"]+)"', text)
        return match.group(1) if match else ""
    # \s* after "affiliation:": a long value is wrapped onto the next line by the formatter.
    people = re.findall(r'name: "([^"]+)",\s*role: "([^"]+)",\s*affiliation:\s*"([^"]+)"', text)
    supervisors = [p for p in people if p[1] == "Supervisor"]
    team = [p for p in people if p[1] != "Supervisor"]
    institution = re.search(r'institution: \{\s*name: "([^"]+)"', text)
    department = re.search(r'department: "([^"]+)"', text)
    collaborator = re.search(r'collaborator: \{\s*name: "([^"]+)"', text)
    return {
        "name": one("name"),
        "nameLong": one("nameLong"),
        "tagline": one("tagline"),
        "researchTitle": one("researchTitle"),
        "institution": institution.group(1) if institution else "",
        "department": department.group(1) if department else "",
        "collaborator": collaborator.group(1) if collaborator else "",
        "supervisors": supervisors,
        "team": team,
    }


def load_strings() -> dict[str, str]:
    text = read("web/src/i18n/en.ts")
    # A value may be on the key's line or, when long, on the next line.
    pattern = r'^\s*"([^"]+)":\s*\n?\s*"((?:[^"\\]|\\.)*)",?$'
    return {key: json.loads(f'"{value}"') for key, value in re.findall(pattern, text, re.M)}


def load_routes() -> list[tuple[str, str, str, str]]:
    text = read("docs/api-contract.md")
    block = text.split("## Routes", 1)[1].split("\n## ", 1)[0]
    routes = []
    for line in block.splitlines():
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) >= 4 and cells[1].startswith("`/"):
            routes.append((cells[0], cells[1].strip("`"), cells[2].strip("`"), cells[3]))
    return routes


def load_tables() -> list[tuple[str, str, int]]:
    text = read("docs/data-dictionary.md")
    found = []
    for match in re.finditer(r"### `([^`]+)`\n\n(.*?)\n\n\| Column(.*?)(?=\n\n|\Z)", text, re.S):
        columns = len(re.findall(r"^\| `", match.group(3), re.M))
        found.append((match.group(1), match.group(2).strip(), columns))
    return found


def load_settings() -> list[tuple[str, str, str]]:
    rows = []
    comment: list[str] = []
    for line in read("server/.env.example").splitlines():
        if line.startswith("#"):
            text = line.lstrip("# ").strip()
            if "=" not in text.split(" ")[0]:
                comment.append(text)
            continue
        if "=" in line:
            key, value = line.split("=", 1)
            rows.append((key.strip(), value.strip(), " ".join(comment)))
        comment = []
    return rows


def load_results() -> list[tuple[str, str, str, str]]:
    rows = []
    for line in read("docs/results-summary.md").splitlines():
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) == 4 and cells[0] not in ("Result", "---"):
            rows.append(tuple(cells))  # type: ignore[arg-type]
    return rows


def load_facts() -> Facts:
    version = re.search(r'__version__ = "([^"]+)"', read("server/app/__init__.py"))
    return Facts(
        project=load_project(),
        version=version.group(1) if version else "PENDING",
        strings=load_strings(),
        games=json.loads(read("shared/game-specs.json"))["games"],
        metrics=json.loads(read("shared/metrics-catalog.json"))["metrics"],
        emg_settings=json.loads(read("web/src/emg/emgSettings.json"))["settings"],
        routes=load_routes(),
        tables=load_tables(),
        settings=load_settings(),
        results=load_results(),
    )


# ---------------------------------------------------------------------------------------------
# The Word document


def add_field(paragraph: Any, instruction: str, placeholder: str = "") -> None:
    """A Word field (PAGE, TOC...), updated by Word when the document is opened or printed."""
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    begin.set(qn("w:dirty"), "true")
    text = OxmlElement("w:instrText")
    text.set(qn("xml:space"), "preserve")
    text.text = instruction
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    shown = OxmlElement("w:t")
    shown.text = placeholder
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    for element in (begin, text, separate, shown, end):
        run._r.append(element)


class Report:
    """Numbered headings, captions and the WHAT / HOW / WHY / ALTERNATIVES blocks."""

    def __init__(self, facts: Facts) -> None:
        self.facts = facts
        self.doc = Document()
        self.chapter = 0
        self.section = 0
        self.subsection = 0
        self.figures = 0
        self.tables = 0
        self.missing_images: list[str] = []
        self._styles()

    # Set-up

    def _styles(self) -> None:
        section = self.doc.sections[0]
        section.orientation = WD_ORIENT.PORTRAIT
        section.page_width, section.page_height = Cm(21.0), Cm(29.7)
        for side in ("left_margin", "right_margin"):
            setattr(section, side, Cm(2.3))
        section.top_margin, section.bottom_margin = Cm(2.2), Cm(2.2)
        normal = self.doc.styles["Normal"]
        normal.font.name = "Calibri"
        normal.font.size = Pt(10.5)
        normal.paragraph_format.space_after = Pt(5)
        normal.paragraph_format.line_spacing = 1.12
        for level, size in ((1, 17), (2, 13), (3, 11.5)):
            style = self.doc.styles[f"Heading {level}"]
            style.font.name = "Calibri"
            style.font.size = Pt(size)
            style.font.color.rgb = TEAL
            style.paragraph_format.space_before = Pt(14 if level == 1 else 9)
            style.paragraph_format.space_after = Pt(5)
            style.paragraph_format.keep_with_next = True
        caption = self.doc.styles["Caption"]
        caption.font.size = Pt(9)
        caption.font.italic = True
        caption.font.color.rgb = RGBColor(0x44, 0x44, 0x44)
        # Page numbers in every footer.
        footer = section.footer.paragraphs[0]
        footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
        footer.add_run(f"{self.facts.project['name']} technical report · page ")
        add_field(footer, "PAGE", "1")
        footer.add_run(" of ")
        add_field(footer, "NUMPAGES", "1")

    # Building blocks

    def title_page(self) -> None:
        p = self.facts.project
        doc = self.doc
        for _ in range(3):
            doc.add_paragraph()
        title = doc.add_paragraph()
        title.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = title.add_run(p["name"])
        run.bold, run.font.size, run.font.color.rgb = True, Pt(34), TEAL
        sub = doc.add_paragraph()
        sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
        sub.add_run(p["nameLong"].split("—")[-1].strip() + "\n").font.size = Pt(14)
        sub.add_run("Technical report").font.size = Pt(14)
        doc.add_paragraph()
        research = doc.add_paragraph()
        research.alignment = WD_ALIGN_PARAGRAPH.CENTER
        label = research.add_run("Research title\n")
        label.italic = True
        r = research.add_run(p["researchTitle"])
        r.bold, r.font.size = True, Pt(13)
        doc.add_paragraph()
        inst = doc.add_paragraph()
        inst.alignment = WD_ALIGN_PARAGRAPH.CENTER
        inst.add_run(f"{p['department']}\n{p['institution']}\nin collaboration with the {p['collaborator']}")
        doc.add_paragraph()
        people = doc.add_paragraph()
        people.alignment = WD_ALIGN_PARAGRAPH.CENTER
        people.add_run("Supervisors\n").bold = True
        for name, _, affiliation in p["supervisors"]:
            people.add_run(f"{name} ({affiliation})\n")
        people.add_run("\nTeam\n").bold = True
        for name, role, affiliation in p["team"]:
            people.add_run(f"{name}, {role} ({affiliation})\n")
        doc.add_paragraph()
        meta = doc.add_paragraph()
        meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
        meta.add_run(f"Version {self.facts.version} · {date.today().strftime('%d %B %Y')}\n").bold = True
        note = meta.add_run(
            "A research prototype, not a medical device. Every result marked PENDING has not been measured yet."
        )
        note.italic, note.font.size = True, Pt(9)
        self.page_break()

    def contents(self) -> None:
        heading = self.doc.add_paragraph()
        run = heading.add_run("Contents")
        run.bold, run.font.size, run.font.color.rgb = True, Pt(17), TEAL
        add_field(self.doc.add_paragraph(), 'TOC \\o "1-2" \\h \\z \\u',
                  "Right-click and choose Update Field to show the table of contents.")
        self.page_break()

    def page_break(self) -> None:
        self.doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    def h1(self, title: str, *, numbered: bool = True, new_page: bool = True) -> None:
        if new_page and self.chapter > 0:
            self.page_break()
        if numbered:
            self.chapter += 1
            self.section = 0
            title = f"{self.chapter} {title}"
        self.doc.add_heading(title, level=1)

    def h2(self, title: str) -> None:
        self.section += 1
        self.subsection = 0
        self.doc.add_heading(f"{self.chapter}.{self.section} {title}", level=2)

    def h3(self, title: str) -> None:
        self.subsection += 1
        self.doc.add_heading(f"{self.chapter}.{self.section}.{self.subsection} {title}", level=3)

    def p(self, text: str, *, bold_lead: str | None = None, italic: bool = False) -> None:
        paragraph = self.doc.add_paragraph()
        if bold_lead:
            paragraph.add_run(bold_lead + " ").bold = True
        self._rich(paragraph, text, italic=italic)

    def _rich(self, paragraph: Any, text: str, italic: bool = False) -> None:
        """`code` in a monospace font; the rest plain."""
        for index, part in enumerate(re.split(r"`([^`]+)`", text)):
            if not part:
                continue
            run = paragraph.add_run(part)
            run.italic = italic
            if index % 2 == 1:
                run.font.name = "Consolas"
                run.font.size = Pt(9.5)
                run.font.color.rgb = RGBColor(0x1F, 0x3A, 0x3A)

    def bullets(self, items: list[str], style: str = "List Bullet") -> None:
        for item in items:
            paragraph = self.doc.add_paragraph(style=style)
            # "**Lead:** the rest": the lead in bold.
            match = re.match(r"^\*\*(.+?)\*\*\s*(.*)$", item, re.S)
            if match:
                paragraph.add_run(match.group(1) + " ").bold = True
                self._rich(paragraph, match.group(2))
            else:
                self._rich(paragraph, item)

    def numbered(self, items: list[str]) -> None:
        """A numbered list that starts again at 1 (Word otherwise continues one count throughout)."""
        start = len(self.doc.paragraphs)
        self.bullets(items, style="List Number")
        style_num = self.doc.styles["List Number"].element.pPr.numPr.numId.val
        numbering = self.doc.part.numbering_part.element
        abstract = numbering.num_having_numId(style_num).abstractNumId.val
        num = numbering.add_num(abstract)
        num.add_lvlOverride(ilvl=0).add_startOverride(1)
        for paragraph in self.doc.paragraphs[start:]:
            num_pr = paragraph._p.get_or_add_pPr().get_or_add_numPr()
            num_pr.get_or_add_ilvl().val = 0
            num_pr.get_or_add_numId().val = num.numId

    def part(self, title: str, *, what: str, how: list[str], why: str, alternatives: list[str]) -> None:
        """One component: WHAT it is, HOW it works step by step, WHY, and ALTERNATIVES rejected."""
        self.h2(title)
        self.p(what, bold_lead="What.")
        paragraph = self.doc.add_paragraph()
        paragraph.add_run("How.").bold = True
        self.numbered(how)
        self.p(why, bold_lead="Why.")
        paragraph = self.doc.add_paragraph()
        paragraph.add_run("Alternatives considered.").bold = True
        self.bullets(alternatives)

    def table(self, headers: list[str], rows: list[list[str]], caption: str, widths: list[float] | None = None) -> None:
        self.tables += 1
        cap = self.doc.add_paragraph(style="Caption")
        cap.add_run(f"Table {self.tables}. {caption}")
        cap.paragraph_format.keep_with_next = True
        table = self.doc.add_table(rows=1, cols=len(headers))
        table.style = "Light Grid Accent 1"
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        for cell, text in zip(table.rows[0].cells, headers):
            cell.text = ""
            run = cell.paragraphs[0].add_run(text)
            run.bold, run.font.size = True, Pt(9)
        for row in rows:
            cells = table.add_row().cells
            for cell, text in zip(cells, row):
                cell.text = ""
                self._rich(cell.paragraphs[0], str(text))
                for run in cell.paragraphs[0].runs:
                    run.font.size = Pt(8.5)
        if widths:
            for row in table.rows:
                for cell, width in zip(row.cells, widths):
                    cell.width = Cm(width)
        self.doc.add_paragraph()

    def figure(self, relative: str, caption: str, width_cm: float = 15.5) -> None:
        path = IMAGES / relative
        if not path.exists():
            self.missing_images.append(relative)
            self.p(f"[Image missing: docs/images/{relative}; run scripts/docs/make_screenshots.ps1]", italic=True)
            return
        self.figures += 1
        picture = self.doc.add_paragraph()
        picture.alignment = WD_ALIGN_PARAGRAPH.CENTER
        picture.paragraph_format.keep_with_next = True
        picture.add_run().add_picture(str(path), width=Cm(width_cm))
        cap = self.doc.add_paragraph(style="Caption")
        cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
        cap.add_run(f"Figure {self.figures}. {caption} (docs/images/{relative})")

    def save(self) -> Path:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        self.doc.save(OUT)
        return OUT


EXPECTED_CHAPTERS = [
    "Introduction", "System overview", "Technology stack", "Computer vision", "Calibration and warm-up",
    "Games", "Input abstraction and camera fallback", "AI adaptation", "Metrics", "LLM feedback",
    "EMG (muscle sensor)", "Dashboards and research mode", "Privacy, security and safety",
    "Testing and validation", "Limitations and future work", "Presentation Q&A",
]  # fmt: skip


def check(path: Path = OUT) -> int:
    """Reads the saved report back: chapters, appendices, images, captions and questions."""
    doc = Document(str(path))
    headings = [(p.style.name, p.text) for p in doc.paragraphs if p.style.name.startswith("Heading")]
    chapters = [text for style, text in headings if style == "Heading 1"]
    images = len(doc.inline_shapes)
    figures = sum(1 for p in doc.paragraphs if p.style.name == "Caption" and p.text.startswith("Figure"))
    tables = sum(1 for p in doc.paragraphs if p.style.name == "Caption" and p.text.startswith("Table"))
    questions = sum(1 for p in doc.paragraphs if re.match(r"Q\d+\. ", p.text))
    problems = []
    for number, title in enumerate(EXPECTED_CHAPTERS, start=1):
        if f"{number} {title}" not in chapters:
            problems.append(f"missing chapter {number} {title}")
    for letter in "ABCDE":
        if not any(text.startswith(f"Appendix {letter}.") for text in chapters):
            problems.append(f"missing appendix {letter}")
    if images != figures:
        problems.append(f"{images} images but {figures} figure captions")
    if questions < 60:
        problems.append(f"only {questions} questions")
    print(f"Read back {path.relative_to(ROOT)}:")
    print(f"  headings: {len(chapters)} level 1, {sum(1 for s, _ in headings if s == 'Heading 2')} level 2, "
          f"{sum(1 for s, _ in headings if s == 'Heading 3')} level 3")
    print(f"  images: {images} embedded, {figures} figure captions, {tables} table captions, {len(doc.tables)} tables")
    print(f"  questions: {questions}")
    for title in chapters:
        print(f"    {title}")
    for problem in problems:
        print(f"  PROBLEM: {problem}")
    return 1 if problems else 0


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")
    if "--check" in sys.argv:
        return check()
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import report_content  # noqa: E402  (the chapters)

    facts = load_facts()
    report = Report(facts)
    report_content.build(report)
    path = report.save()
    print(f"Wrote {path.relative_to(ROOT)}: {report.chapter} chapters, {report.figures} figures, {report.tables} tables")
    if report.missing_images:
        print("Missing images: " + ", ".join(report.missing_images))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
