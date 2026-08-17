"""Constants and paths for the dossier-links pipeline. Loads secrets from .env."""
from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv
import os

load_dotenv()

SRGSSR_CLIENT_ID = os.environ.get("SRGSSR_CLIENT_ID")
SRGSSR_CLIENT_SECRET = os.environ.get("SRGSSR_CLIENT_SECRET")
# optional manual override; set once resolved via /radioshows/search and no
# longer needed to look it up on every run
SRGSSR_SHOW_ID = os.environ.get("SRGSSR_SHOW_ID")

TOKEN_URL = "https://srgssr-prod.apigee.net/oauth/v1/accesstoken?grant_type=client_credentials"
API_BASE = "https://api.srgssr.ch/audiometadata/v2"
BUSINESS_UNIT = "srf"
SHOW_TITLE = "Regionaljournal Basel Baselland"

CACHE_DIR = Path(__file__).parent / ".cache"
TOKEN_CACHE_PATH = CACHE_DIR / "token.json"
SHOW_CACHE_PATH = CACHE_DIR / "show_id.json"
