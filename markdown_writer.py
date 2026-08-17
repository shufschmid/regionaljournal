"""Renders parsed Segments (with resolved urns) to Markdown, in the same style
as the user's own hand-made "srf mit links.md" reference file.
"""
from __future__ import annotations

from pdf_parser import Segment

PLAY_URL = "https://www.srf.ch/play/embed?urn={urn}&startTime={seconds}"


def render_segment(segment: Segment, urn: str | None) -> str:
    parts = [segment.headline, ""]
    for teaser in segment.teaser_blocks:
        parts.append(f"*{teaser}*")
        parts.append("")
    parts.append("[Automatische Transkription]")
    parts.append("")

    for p in segment.paragraphs:
        if urn:
            link = PLAY_URL.format(urn=urn, seconds=p.seconds)
            parts.append(f"[{p.timestamp}]({link}) {p.text}")
        else:
            parts.append(f"{p.timestamp} {p.text}  <!-- urn not resolved -->")
        parts.append("")

    return "\n".join(parts).rstrip() + "\n"


def render_dossier(segments_with_urns: list[tuple[Segment, str | None]]) -> str:
    return "\n\n---\n\n".join(render_segment(seg, urn) for seg, urn in segments_with_urns)
