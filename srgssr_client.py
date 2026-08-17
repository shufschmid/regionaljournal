"""Client for the SRGSSR Audio Metadata API - resolves an SRF Regionaljournal
Basel Baselland dossier story (headline + broadcast date) to its audio `urn`.

Note: this show publishes one API "episode" per STORY (not per Morgen/Mittag/
Abend broadcast edition), and its `title` is exactly the SMD dossier headline -
confirmed live by looking up "Ziefen wehrt sich gegen Bachem-Parkplatz" and
getting back urn:srf:audio:5b66d4e0-dafd-354e-9ed7-a4f79403a5ec, the same urn
already hand-verified in srf mit links.md. So resolution is a straightforward
title+date lookup, not date+edition-window disambiguation.

Also note: the OpenAPI spec's documented response field names (e.g. `ChannelList`,
`SearchResultListShow`) don't match the live API, which uses lowerCamelCase
(`channelList`, `searchResultShowList`, `episodeList`, `mediaList`) - verified
against real responses.
"""
from __future__ import annotations

import json
import time
from datetime import date, datetime

import requests

import config

_session = requests.Session()
_MAX_RETRIES = 3
_MAX_PAGES = 10  # safety bound while paging through episodeComposition


def _request_with_retry(method: str, url: str, **kwargs) -> requests.Response:
    resp = None
    for attempt in range(_MAX_RETRIES):
        resp = _session.request(method, url, **kwargs)
        if resp.status_code == 429 or resp.status_code >= 500:
            if attempt < _MAX_RETRIES - 1:
                time.sleep(2**attempt)
                continue
        return resp
    return resp


class SrgssrClient:
    def __init__(self):
        if not config.SRGSSR_CLIENT_ID or not config.SRGSSR_CLIENT_SECRET:
            raise RuntimeError(
                "SRGSSR_CLIENT_ID / SRGSSR_CLIENT_SECRET not set. Copy .env.example to "
                ".env and fill in your API credentials."
            )
        self._token: str | None = None
        self._show_id: str | None = config.SRGSSR_SHOW_ID

    # -- auth -----------------------------------------------------------

    def _load_cached_token(self) -> str | None:
        if not config.TOKEN_CACHE_PATH.exists():
            return None
        data = json.loads(config.TOKEN_CACHE_PATH.read_text())
        if data.get("expires_at", 0) > time.time() + 30:
            return data["access_token"]
        return None

    def _fetch_token(self) -> str:
        resp = _request_with_retry(
            "POST",
            config.TOKEN_URL,
            auth=(config.SRGSSR_CLIENT_ID, config.SRGSSR_CLIENT_SECRET),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            data={"grant_type": "client_credentials"},
        )
        resp.raise_for_status()
        data = resp.json()
        access_token = data["access_token"]
        expires_in = int(data.get("expires_in", 1800))
        config.CACHE_DIR.mkdir(exist_ok=True)
        config.TOKEN_CACHE_PATH.write_text(
            json.dumps({"access_token": access_token, "expires_at": time.time() + expires_in})
        )
        return access_token

    def _get_token(self, force_refresh: bool = False) -> str:
        if self._token and not force_refresh:
            return self._token
        token = None if force_refresh else self._load_cached_token()
        if token is None:
            token = self._fetch_token()
        self._token = token
        return token

    def _authed_get(self, url: str, params: dict | None = None) -> dict:
        headers = {"Accept": "application/json; charset=utf-8"}
        resp = _request_with_retry(
            "GET", url, params=params, headers={**headers, "Authorization": f"Bearer {self._get_token()}"}
        )
        if resp.status_code == 401:
            resp = _request_with_retry(
                "GET", url, params=params, headers={**headers, "Authorization": f"Bearer {self._get_token(force_refresh=True)}"}
            )
        resp.raise_for_status()
        return resp.json()

    # -- show -----------------------------------------------------------

    def _load_cached_show_id(self) -> str | None:
        if not config.SHOW_CACHE_PATH.exists():
            return None
        return json.loads(config.SHOW_CACHE_PATH.read_text())["id"]

    def get_show_id(self) -> str:
        if self._show_id:
            return self._show_id
        cached = self._load_cached_show_id()
        if cached:
            self._show_id = cached
            return cached

        data = self._authed_get(
            f"{config.API_BASE}/radioshows/search", {"bu": config.BUSINESS_UNIT, "q": config.SHOW_TITLE}
        )
        shows = data.get("searchResultShowList", [])
        exact = [s for s in shows if s.get("title", "").strip().lower() == config.SHOW_TITLE.lower()]
        if not exact:
            titles = [s.get("title") for s in shows]
            raise LookupError(
                f"No show titled {config.SHOW_TITLE!r} found. Candidates: {titles}. "
                "You can set SRGSSR_SHOW_ID manually in .env instead."
            )
        show_id = exact[0]["id"]
        config.CACHE_DIR.mkdir(exist_ok=True)
        config.SHOW_CACHE_PATH.write_text(json.dumps({"id": show_id}))
        self._show_id = show_id
        return show_id

    # -- episodes -----------------------------------------------------------

    def resolve_episode(self, headline: str, broadcast_date: date) -> dict:
        """Resolve the full episode metadata (urn, title, lead, description,
        exact broadcast date/time, ...) for a dossier story, by matching its
        headline (exact, case-insensitive) and broadcast date against the
        show's episode list.
        """
        target_title = headline.strip().lower()
        url = f"{config.API_BASE}/episodeComposition/shows/{self.get_show_id()}"
        params = {"bu": config.BUSINESS_UNIT, "maxPublishedDate": broadcast_date.strftime("%Y-%m"), "pageSize": 100}

        matches = []
        for _ in range(_MAX_PAGES):
            try:
                data = self._authed_get(url, params)
            except (requests.exceptions.JSONDecodeError, requests.exceptions.HTTPError):
                # `next` (used for page 2+) points at an internal integrationlayer
                # host that isn't covered by the public API product/gateway and
                # serves an HTML error page instead of JSON. Best-effort: stop
                # paging rather than crash - a single page covers ~a month of
                # episodes, more than enough margin for same-day dossiers.
                break

            for ep in data.get("episodeList", []):
                for m in ep.get("mediaList", []):
                    if m.get("title", "").strip().lower() != target_title:
                        continue
                    m_date = datetime.fromisoformat(m["date"]).date()
                    if m_date == broadcast_date:
                        matches.append(m)
            if matches:
                break  # found it - no need to page further

            next_url = data.get("next")
            if not next_url:
                break
            url, params = next_url, None  # `next` is already a fully-formed URL

        if len(matches) == 1:
            return matches[0]
        if not matches:
            raise LookupError(f"No episode titled {headline!r} found on {broadcast_date}.")
        raise LookupError(f"{len(matches)} episodes titled {headline!r} found on {broadcast_date} - ambiguous.")
