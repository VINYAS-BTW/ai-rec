from __future__ import annotations

import textwrap
from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas


REPO_ROOT = Path(__file__).resolve().parents[1]
MD_PATH = REPO_ROOT / "docs" / "AGENTS_AND_SUPERAGENT.md"
PDF_PATH = REPO_ROOT / "docs" / "AGENTS_AND_SUPERAGENT.pdf"


def md_to_pdf(md_path: Path, pdf_path: Path) -> None:
    lines = md_path.read_text(encoding="utf-8").splitlines()

    c = canvas.Canvas(str(pdf_path), pagesize=letter)
    width, height = letter

    left = 0.8 * inch
    right = 0.8 * inch
    top = 0.8 * inch
    bottom = 0.8 * inch
    max_width = width - left - right

    y = height - top

    def new_page() -> None:
        nonlocal y
        c.showPage()
        y = height - top

    def draw_wrapped(text: str, font_name: str, font_size: int, leading: float | None = None) -> None:
        nonlocal y
        if leading is None:
            leading = font_size * 1.25
        c.setFont(font_name, font_size)

        # crude wrap by character count (works fine for simple docs)
        wrap_width = max(20, int(max_width / (font_size * 0.55)))
        for para in text.split("\n"):
            wrapped = textwrap.wrap(
                para,
                width=wrap_width,
                replace_whitespace=False,
                drop_whitespace=False,
            )
            if not wrapped:
                wrapped = [""]
            for wline in wrapped:
                if y < bottom + leading:
                    new_page()
                    c.setFont(font_name, font_size)
                c.drawString(left, y, wline.rstrip("\n"))
                y -= leading

    title = "Agents & SuperAgent"
    if lines and lines[0].startswith("# "):
        title = lines[0][2:].strip() or title
    c.setTitle(title)

    for raw in lines:
        line = raw.rstrip()
        if not line.strip():
            y -= 10
            if y < bottom + 20:
                new_page()
            continue

        if line.startswith("# "):
            draw_wrapped(line[2:].strip(), "Helvetica-Bold", 18, leading=22)
            y -= 6
            continue
        if line.startswith("## "):
            draw_wrapped(line[3:].strip(), "Helvetica-Bold", 14, leading=18)
            y -= 4
            continue
        if line.startswith("### "):
            draw_wrapped(line[4:].strip(), "Helvetica-Bold", 12, leading=16)
            y -= 2
            continue

        if line.lstrip().startswith("- "):
            txt = "• " + line.lstrip()[2:]
            draw_wrapped(txt, "Helvetica", 10, leading=13)
            continue

        # code-ish
        if line.startswith("    ") or line.startswith("```") or "`" in line:
            draw_wrapped(line.replace("```", ""), "Courier", 9, leading=12)
            continue

        draw_wrapped(line, "Helvetica", 10, leading=13)

    c.save()


if __name__ == "__main__":
    if not MD_PATH.exists():
        raise SystemExit(f"Missing markdown file: {MD_PATH}")
    md_to_pdf(MD_PATH, PDF_PATH)
    print(f"Wrote {PDF_PATH}")

