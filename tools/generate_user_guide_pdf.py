from __future__ import annotations

import html
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
GUIDE = ROOT / "docs" / "USER_GUIDE.md"
OUTPUT = ROOT / "output" / "pdf" / "Mike-AutomationAI-Huong-dan-su-dung.pdf"
ICON = ROOT / "icons" / "mike-128.png"


def register_fonts() -> tuple[str, str, str]:
    candidates = [
        (
            Path("C:/Windows/Fonts/arial.ttf"),
            Path("C:/Windows/Fonts/arialbd.ttf"),
            Path("C:/Windows/Fonts/ariali.ttf"),
            "Arial",
        ),
        (
            Path("C:/Windows/Fonts/segoeui.ttf"),
            Path("C:/Windows/Fonts/segoeuib.ttf"),
            Path("C:/Windows/Fonts/segoeuii.ttf"),
            "SegoeUI",
        ),
        (
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
            Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf"),
            "DejaVuSans",
        ),
    ]

    for regular, bold, italic, base in candidates:
        if regular.exists() and bold.exists():
            pdfmetrics.registerFont(TTFont(base, str(regular)))
            pdfmetrics.registerFont(TTFont(f"{base}-Bold", str(bold)))
            if italic.exists():
                pdfmetrics.registerFont(TTFont(f"{base}-Italic", str(italic)))
                italic_name = f"{base}-Italic"
            else:
                italic_name = base
            return base, f"{base}-Bold", italic_name

    return "Helvetica", "Helvetica-Bold", "Helvetica-Oblique"


FONT, FONT_BOLD, FONT_ITALIC = register_fonts()


def register_mono_font() -> str:
    candidates = [
        (Path("C:/Windows/Fonts/consola.ttf"), "Consolas"),
        (Path("C:/Windows/Fonts/cour.ttf"), "CourierNew"),
        (Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"), "DejaVuSansMono"),
    ]
    for font_path, name in candidates:
        if font_path.exists():
            pdfmetrics.registerFont(TTFont(name, str(font_path)))
            return name
    return FONT


FONT_MONO = register_mono_font()


def build_styles():
    styles = getSampleStyleSheet()
    navy = colors.HexColor("#172554")
    gold = colors.HexColor("#a16207")
    ink = colors.HexColor("#111827")
    muted = colors.HexColor("#4b5563")

    styles.add(
        ParagraphStyle(
            name="CoverTitle",
            fontName=FONT_BOLD,
            fontSize=28,
            leading=34,
            alignment=TA_CENTER,
            textColor=navy,
            spaceAfter=8,
        )
    )
    styles.add(
        ParagraphStyle(
            name="CoverSub",
            fontName=FONT,
            fontSize=12,
            leading=18,
            alignment=TA_CENTER,
            textColor=muted,
            spaceAfter=4,
        )
    )
    styles.add(
        ParagraphStyle(
            name="H1Guide",
            fontName=FONT_BOLD,
            fontSize=20,
            leading=26,
            textColor=navy,
            spaceBefore=14,
            spaceAfter=8,
        )
    )
    styles.add(
        ParagraphStyle(
            name="H2Guide",
            fontName=FONT_BOLD,
            fontSize=15,
            leading=20,
            textColor=navy,
            spaceBefore=14,
            spaceAfter=6,
        )
    )
    styles.add(
        ParagraphStyle(
            name="H3Guide",
            fontName=FONT_BOLD,
            fontSize=12,
            leading=16,
            textColor=gold,
            spaceBefore=10,
            spaceAfter=4,
        )
    )
    styles.add(
        ParagraphStyle(
            name="BodyGuide",
            fontName=FONT,
            fontSize=9.7,
            leading=13.8,
            textColor=ink,
            alignment=TA_LEFT,
            spaceAfter=5,
        )
    )
    styles.add(
        ParagraphStyle(
            name="BulletGuide",
            parent=styles["BodyGuide"],
            leftIndent=12,
            firstLineIndent=0,
            bulletIndent=0,
            bulletFontName=FONT,
            bulletFontSize=9.7,
            spaceAfter=3,
        )
    )
    styles.add(
        ParagraphStyle(
            name="CodeGuide",
            fontName=FONT_MONO,
            fontSize=8.5,
            leading=11.5,
            textColor=colors.HexColor("#1f2937"),
            backColor=colors.HexColor("#f3f4f6"),
            borderPadding=5,
            leftIndent=4,
            rightIndent=4,
            spaceBefore=3,
            spaceAfter=8,
        )
    )
    styles.add(
        ParagraphStyle(
            name="TableHead",
            fontName=FONT_BOLD,
            fontSize=8.7,
            leading=11,
            textColor=colors.white,
        )
    )
    styles.add(
        ParagraphStyle(
            name="TableCell",
            fontName=FONT,
            fontSize=8.3,
            leading=10.5,
            textColor=ink,
        )
    )
    styles.add(
        ParagraphStyle(
            name="Footer",
            fontName=FONT,
            fontSize=8,
            leading=10,
            textColor=colors.HexColor("#6b7280"),
        )
    )
    return styles


STYLES = build_styles()


def inline(text: str) -> str:
    value = html.escape(text)
    value = re.sub(r"`([^`]+)`", rf'<font name="{FONT_MONO}">\1</font>', value)
    value = re.sub(r"\*\*([^*]+)\*\*", rf'<font name="{FONT_BOLD}">\1</font>', value)

    def repl_link(match: re.Match[str]) -> str:
        label = match.group(1)
        url = match.group(2)
        return f'<link href="{html.escape(url)}"><u>{label}</u></link>'

    value = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", repl_link, value)
    return value


def split_table_row(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def table_flowable(rows: list[str]) -> Table:
    parsed = [split_table_row(row) for row in rows if not re.match(r"^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$", row)]
    if not parsed:
        return Table([[""]])

    col_count = max(len(row) for row in parsed)
    for row in parsed:
        row.extend([""] * (col_count - len(row)))

    body = []
    for r_index, row in enumerate(parsed):
        style = STYLES["TableHead"] if r_index == 0 else STYLES["TableCell"]
        body.append([Paragraph(inline(cell), style) for cell in row])

    available_width = A4[0] - 36 * mm
    first_width = min(48 * mm, available_width * 0.35) if col_count == 2 else available_width / col_count
    if col_count == 2:
        widths = [first_width, available_width - first_width]
    else:
        widths = [available_width / col_count] * col_count

    table = Table(body, colWidths=widths, hAlign="LEFT", repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1d4ed8")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#d1d5db")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#f8fafc")),
            ]
        )
    )
    return table


def build_story(markdown: str):
    story = []
    title = "Hướng Dẫn Sử Dụng Mike-AutomationAI"
    lines = markdown.splitlines()

    for line in lines:
        if line.startswith("# "):
            title = line[2:].strip()
            break

    story.append(Spacer(1, 24 * mm))
    if ICON.exists():
        img = Image(str(ICON), width=28 * mm, height=28 * mm)
        img.hAlign = "CENTER"
        story.append(img)
        story.append(Spacer(1, 7 * mm))
    story.append(Paragraph(inline(title), STYLES["CoverTitle"]))
    story.append(Paragraph("Mike-AutomationAI 1.2.0", STYLES["CoverSub"]))
    story.append(Paragraph("Tài liệu hướng dẫn cài đặt, vận hành, xử lý lỗi và sử dụng có trách nhiệm", STYLES["CoverSub"]))
    story.append(Paragraph("Cập nhật: 2026-07-02", STYLES["CoverSub"]))
    story.append(PageBreak())

    in_code = False
    code_lines: list[str] = []
    table_lines: list[str] = []
    first_h1 = True

    def flush_code():
        if code_lines:
            text = "<br/>".join(html.escape(line) for line in code_lines)
            story.append(Paragraph(text, STYLES["CodeGuide"]))
            code_lines.clear()

    def flush_table():
        if table_lines:
            story.append(Spacer(1, 2 * mm))
            story.append(table_flowable(table_lines))
            story.append(Spacer(1, 5 * mm))
            table_lines.clear()

    for raw in lines:
        line = raw.rstrip()

        if line.startswith("```"):
            if in_code:
                in_code = False
                flush_code()
            else:
                flush_table()
                in_code = True
            continue

        if in_code:
            code_lines.append(line)
            continue

        if line.strip().startswith("|") and "|" in line.strip()[1:]:
            table_lines.append(line)
            continue
        flush_table()

        if not line.strip():
            story.append(Spacer(1, 2 * mm))
            continue

        if line.startswith("# "):
            if first_h1:
                first_h1 = False
                continue
            story.append(Paragraph(inline(line[2:].strip()), STYLES["H1Guide"]))
        elif line.startswith("## "):
            story.append(KeepTogether([Paragraph(inline(line[3:].strip()), STYLES["H2Guide"])]))
        elif line.startswith("### "):
            story.append(Paragraph(inline(line[4:].strip()), STYLES["H3Guide"]))
        elif line.startswith("- "):
            story.append(Paragraph(inline(line[2:].strip()), STYLES["BulletGuide"], bulletText="-"))
        elif re.match(r"^\d+\.\s+", line):
            match = re.match(r"^(\d+)\.\s+(.*)", line)
            number = match.group(1)
            text = match.group(2)
            story.append(Paragraph(inline(text), STYLES["BulletGuide"], bulletText=f"{number}."))
        else:
            story.append(Paragraph(inline(line), STYLES["BodyGuide"]))

    flush_table()
    flush_code()
    return story


def draw_footer(canvas, doc):
    canvas.saveState()
    width, _ = A4
    footer = "Mike-AutomationAI - Hướng dẫn sử dụng"
    page = f"Trang {doc.page}"
    canvas.setFont(FONT, 8)
    canvas.setFillColor(colors.HexColor("#6b7280"))
    canvas.drawString(18 * mm, 11 * mm, footer)
    canvas.drawRightString(width - 18 * mm, 11 * mm, page)
    canvas.restoreState()


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    markdown = GUIDE.read_text(encoding="utf-8")
    doc = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=17 * mm,
        bottomMargin=18 * mm,
        title="Hướng dẫn sử dụng Mike-AutomationAI",
        author="Mike-AutomationAI",
        subject="Tài liệu hướng dẫn sử dụng Chrome extension Mike-AutomationAI",
    )
    doc.build(build_story(markdown), onFirstPage=draw_footer, onLaterPages=draw_footer)
    print(OUTPUT)


if __name__ == "__main__":
    main()
