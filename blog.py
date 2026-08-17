"""CLI: build the edition-grouped blog HTML from one or more dossier PDFs.

Usage:
    python blog.py "Dossier (1).pdf" "Dossier (2).pdf" [-o blog.html] [--evening-output blog_abend.html]
"""
from __future__ import annotations

import argparse
from pathlib import Path

from blog_writer import build_posts, render_blog
from srgssr_client import SrgssrClient


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdfs", nargs="+", help="One or more dossier PDF paths")
    parser.add_argument("-o", "--output", default="blog.html")
    parser.add_argument(
        "--evening-output",
        help="Also write a second file with only the Abend editions, showing plain date+time instead of the edition chip",
    )
    args = parser.parse_args()

    client = SrgssrClient()
    posts = build_posts(args.pdfs, client)
    Path(args.output).write_text(render_blog(posts), encoding="utf-8")
    print(f"Wrote {args.output} ({len(posts)} post(s))")

    if args.evening_output:
        evening_posts = [p for p in posts if p.edition == "Abend"]
        Path(args.evening_output).write_text(render_blog(evening_posts, show_time=True), encoding="utf-8")
        print(f"Wrote {args.evening_output} ({len(evening_posts)} post(s))")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
