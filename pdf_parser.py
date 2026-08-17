"""Parses an SMD "Dossier" PDF (SRF Regionaljournal Basel Baselland transcripts)
into structured Segments, one per broadcast edition covered in the dossier.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date

import pymupdf as fitz

TIMESTAMP_RE = re.compile(r"^(\d{2}):(\d{2}):(\d{2})\s+(.*)$", re.DOTALL)
DATE_HEADER_RE = re.compile(r"srf Audio (\d{2})-(\d{2})-(\d{4})\s*$")
TRANSCRIPTION_MARKER = "[Automatische Transkription]"
FOOTER_PREFIX = "Dossier - Bello Bajour -"
SUBTITLE = "Regionaljournal Basel Baselland"


@dataclass
class Paragraph:
    timestamp: str  # "HH:MM:SS"
    seconds: int
    text: str


@dataclass
class Segment:
    broadcast_date: date
    headline: str
    teaser_blocks: list[str] = field(default_factory=list)
    paragraphs: list[Paragraph] = field(default_factory=list)


def _parse_timestamp(ts: str) -> int:
    h, m, s = ts.split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


def _block_text(block: dict) -> str:
    lines = ["".join(span["text"] for span in line["spans"]) for line in block["lines"]]
    # a line ending in "-" is a hyphenated word continuing on the next line (e.g.
    # "FCB-" / "Fans" -> "FCB-Fans") - join those directly, without a space
    text = ""
    for line in lines:
        text = line if not text else (text + line if text.endswith("-") else text + " " + line)
    text = text.strip()
    # the PDF embeds typographic ligature glyphs (ﬀ, ﬁ, ﬂ, ...); normalize them
    # back to plain letters (ff, fi, fl, ...) so extracted text matches normal spelling
    return unicodedata.normalize("NFKC", text)


def _page_blocks(page: "fitz.Page") -> list[tuple[dict, str]]:
    raw = page.get_text("dict")["blocks"]
    out = []
    for b in raw:
        if "lines" not in b:
            continue  # image or other non-text block
        text = _block_text(b)
        if text:
            out.append((b, text))
    return out


def _reflow(texts: list[str]) -> list[Paragraph]:
    """Turn an ordered list of block texts into paragraphs, merging any block
    that doesn't start with a timestamp into the previous paragraph (this is
    how a paragraph that got split across a page break is stitched back together).
    """
    paragraphs: list[Paragraph] = []
    for text in texts:
        m = TIMESTAMP_RE.match(text)
        if m:
            h, mnt, s, rest_text = m.groups()
            ts = f"{h}:{mnt}:{s}"
            paragraphs.append(Paragraph(timestamp=ts, seconds=_parse_timestamp(ts), text=rest_text.strip()))
        elif paragraphs:
            paragraphs[-1].text += " " + text.strip()
        # else: stray text before any paragraph started - defensively dropped
    return paragraphs


def parse_dossier(pdf_path: str) -> list[Segment]:
    """Parse every segment (one per broadcast edition) contained in a dossier PDF.

    A page starts a new segment iff it contains a "[Automatische Transkription]"
    marker block; pages without it are continuation pages of the current segment
    (or, before any segment has started, front matter like the table of contents,
    which is skipped).
    """
    doc = fitz.open(pdf_path)
    segments: list[Segment] = []
    body_texts_by_segment: list[list[str]] = []
    current: Segment | None = None
    current_body_texts: list[str] | None = None

    for page in doc:
        mid_x = page.rect.width / 2
        blocks = _page_blocks(page)
        marker_idx = next((i for i, (_, t) in enumerate(blocks) if t == TRANSCRIPTION_MARKER), None)

        if marker_idx is not None:
            preamble_blocks = blocks[:marker_idx]
            date_text = next((t for _, t in preamble_blocks if DATE_HEADER_RE.search(t)), None)
            if date_text is None:
                raise ValueError(f"segment starting on page {page.number + 1} of {pdf_path!r} has no date header")
            m = DATE_HEADER_RE.search(date_text)
            broadcast_date = date(int(m.group(3)), int(m.group(2)), int(m.group(1)))

            rest = [t for _, t in preamble_blocks if t != date_text and t != SUBTITLE]
            headline = rest[0] if rest else ""
            teaser_blocks = rest[1:]

            current = Segment(broadcast_date=broadcast_date, headline=headline, teaser_blocks=teaser_blocks)
            segments.append(current)
            current_body_texts = []
            body_texts_by_segment.append(current_body_texts)
            body_blocks = blocks[marker_idx + 1:]
        else:
            if current is None:
                continue  # front matter (e.g. table of contents) before the first segment
            body_blocks = blocks

        left, right = [], []
        for b, t in body_blocks:
            if t.startswith(FOOTER_PREFIX) or DATE_HEADER_RE.search(t):
                continue  # page chrome: footer or repeated per-page date header
            x0 = b["bbox"][0]
            (left if x0 < mid_x else right).append(t)
        current_body_texts.extend(left + right)

    doc.close()

    for segment, texts in zip(segments, body_texts_by_segment):
        segment.paragraphs = _reflow(texts)
    return segments
