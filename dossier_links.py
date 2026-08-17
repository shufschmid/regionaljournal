"""CLI: turn a daily SMD "Dossier" PDF into a Markdown file with SRF deep-links,
one per timestamped paragraph - the automated equivalent of manually replacing
each mm:ss timestamp with a play link.

Usage:
    python dossier_links.py "Dossier (1).pdf" [-o OUTPUT.md] [--verbose]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from markdown_writer import render_dossier
from pdf_parser import parse_dossier
from srgssr_client import SrgssrClient


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", help="Path to the dossier PDF")
    parser.add_argument("-o", "--output", help="Output Markdown path (default: '<stem> mit links.md')")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    pdf_path = Path(args.pdf)
    output_path = Path(args.output) if args.output else pdf_path.with_name(f"{pdf_path.stem} mit links.md")

    segments = parse_dossier(str(pdf_path))
    if args.verbose:
        print(f"Parsed {len(segments)} segment(s) from {pdf_path.name}", file=sys.stderr)

    client = SrgssrClient()
    had_failure = False
    results = []
    for seg in segments:
        try:
            urn = client.resolve_episode(seg.headline, seg.broadcast_date)["urn"]
            if args.verbose:
                print(f"  {seg.broadcast_date} {seg.headline!r} -> {urn}", file=sys.stderr)
        except LookupError as e:
            had_failure = True
            urn = None
            print(f"WARNING: could not resolve urn for {seg.broadcast_date} {seg.headline!r}: {e}", file=sys.stderr)
        results.append((seg, urn))

    output_path.write_text(render_dossier(results), encoding="utf-8")
    print(f"Wrote {output_path}")

    return 1 if had_failure else 0


if __name__ == "__main__":
    raise SystemExit(main())
