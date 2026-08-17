"""Standalone smoke test: fetch an OAuth token and resolve the show id.

Run first after filling in .env, before running the full pipeline:
    .venv/Scripts/python.exe scripts/check_auth.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from srgssr_client import SrgssrClient


def main():
    client = SrgssrClient()
    print("Fetching OAuth token...")
    token = client._get_token()
    print(f"  OK - got token ({token[:12]}...)")
    print("Resolving show id for", "Regionaljournal Basel Baselland", "...")
    show_id = client.get_show_id()
    print(f"  OK - showId = {show_id}")
    print("\nAuth + show lookup both work. You can add SRGSSR_SHOW_ID="
          f"{show_id} to .env to skip this lookup on future runs.")


if __name__ == "__main__":
    main()
