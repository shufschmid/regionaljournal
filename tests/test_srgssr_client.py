import time
from datetime import date
from unittest.mock import MagicMock, patch

import pytest

import config
import srgssr_client
from srgssr_client import SrgssrClient


@pytest.fixture(autouse=True)
def isolated_config(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "SRGSSR_CLIENT_ID", "test-id")
    monkeypatch.setattr(config, "SRGSSR_CLIENT_SECRET", "test-secret")
    monkeypatch.setattr(config, "SRGSSR_SHOW_ID", None)
    monkeypatch.setattr(config, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(config, "TOKEN_CACHE_PATH", tmp_path / "token.json")
    monkeypatch.setattr(config, "SHOW_CACHE_PATH", tmp_path / "show_id.json")


def _resp(status=200, json_body=None):
    m = MagicMock()
    m.status_code = status
    m.json.return_value = json_body or {}
    m.raise_for_status.side_effect = None
    if status >= 400:
        import requests

        m.raise_for_status.side_effect = requests.HTTPError(response=m)
    return m


TOKEN_RESP = lambda: _resp(200, {"access_token": "tok", "expires_in": 1800})


def test_token_request_uses_basic_auth_and_form_body():
    client = SrgssrClient()
    with patch.object(srgssr_client._session, "request", return_value=TOKEN_RESP()) as mock_req:
        token = client._get_token()

    assert token == "tok"
    _, kwargs = mock_req.call_args
    assert kwargs["auth"] == ("test-id", "test-secret")
    assert kwargs["data"] == {"grant_type": "client_credentials"}


def test_token_is_cached_and_not_refetched():
    client = SrgssrClient()
    with patch.object(srgssr_client._session, "request", return_value=TOKEN_RESP()) as mock_req:
        client._get_token()
        client._get_token()
    assert mock_req.call_count == 1

    client2 = SrgssrClient()
    with patch.object(srgssr_client._session, "request") as mock_req2:
        token = client2._get_token()
    mock_req2.assert_not_called()
    assert token == "tok"


def test_expired_cached_token_triggers_refetch():
    config.CACHE_DIR.mkdir(exist_ok=True)
    config.TOKEN_CACHE_PATH.write_text('{"access_token": "old", "expires_at": %f}' % (time.time() - 10))

    client = SrgssrClient()
    with patch.object(srgssr_client._session, "request", return_value=TOKEN_RESP()) as mock_req:
        token = client._get_token()
    assert token == "tok"  # not "old" - proves the expired cache entry was ignored
    mock_req.assert_called_once()


def test_get_show_id_matches_exact_title_case_insensitive():
    client = SrgssrClient()
    shows_resp = _resp(
        200,
        {
            "searchResultShowList": [
                {"id": "wrong-1", "title": "Regionaljournal Basel Baselland Wochengast"},
                {"id": "right-1", "title": "regionaljournal basel baselland"},
            ]
        },
    )

    def fake_request(method, url, **kwargs):
        return TOKEN_RESP() if url == config.TOKEN_URL else shows_resp

    with patch.object(srgssr_client._session, "request", side_effect=fake_request):
        show_id = client.get_show_id()
    assert show_id == "right-1"


def test_get_show_id_is_cached_across_client_instances():
    client = SrgssrClient()
    shows_resp = _resp(200, {"searchResultShowList": [{"id": "right-1", "title": config.SHOW_TITLE}]})

    def fake_request(method, url, **kwargs):
        return TOKEN_RESP() if url == config.TOKEN_URL else shows_resp

    with patch.object(srgssr_client._session, "request", side_effect=fake_request) as mock_req:
        client.get_show_id()

    client2 = SrgssrClient()
    with patch.object(srgssr_client._session, "request") as mock_req2:
        show_id = client2.get_show_id()
    mock_req2.assert_not_called()
    assert show_id == "right-1"


def test_get_show_id_raises_when_no_exact_title_match():
    client = SrgssrClient()
    shows_resp = _resp(200, {"searchResultShowList": [{"id": "x", "title": "Something Else Entirely"}]})

    def fake_request(method, url, **kwargs):
        return TOKEN_RESP() if url == config.TOKEN_URL else shows_resp

    with patch.object(srgssr_client._session, "request", side_effect=fake_request):
        with pytest.raises(LookupError):
            client.get_show_id()


def _media(title, iso_date, urn):
    return {"title": title, "date": iso_date, "urn": urn}


def test_resolve_episode_matches_by_title_and_date():
    client = SrgssrClient()
    client._show_id = "show-1"  # skip the show lookup
    episodes_resp = _resp(
        200,
        {
            "episodeList": [
                {"mediaList": [_media("Ziefen wehrt sich gegen Bachem-Parkplatz", "2026-08-17T12:03:00+02:00", "urn:srf:audio:abc")]},
                {"mediaList": [_media("Some other story", "2026-08-17T06:30:00+02:00", "urn:srf:audio:def")]},
            ],
            "next": None,
        },
    )

    def fake_request(method, url, **kwargs):
        return TOKEN_RESP() if url == config.TOKEN_URL else episodes_resp

    with patch.object(srgssr_client._session, "request", side_effect=fake_request):
        episode = client.resolve_episode("Ziefen wehrt sich gegen Bachem-Parkplatz", date(2026, 8, 17))
    assert episode["urn"] == "urn:srf:audio:abc"


def test_resolve_episode_follows_pagination_next_url():
    client = SrgssrClient()
    client._show_id = "show-1"
    page1 = _resp(
        200,
        {
            "episodeList": [{"mediaList": [_media("Unrelated story", "2026-08-17T06:30:00+02:00", "urn:srf:audio:def")]}],
            "next": "https://api.srgssr.ch/integrationlayer/2.0/srf/episodeComposition/latestByShow/show-1?page=2",
        },
    )
    page2 = _resp(
        200,
        {
            "episodeList": [{"mediaList": [_media("Ziefen wehrt sich gegen Bachem-Parkplatz", "2026-08-17T12:03:00+02:00", "urn:srf:audio:abc")]}],
            "next": None,
        },
    )
    calls = []

    def fake_request(method, url, **kwargs):
        calls.append(url)
        if url == config.TOKEN_URL:
            return TOKEN_RESP()
        if "page=2" in url:
            return page2
        return page1

    with patch.object(srgssr_client._session, "request", side_effect=fake_request):
        episode = client.resolve_episode("Ziefen wehrt sich gegen Bachem-Parkplatz", date(2026, 8, 17))
    assert episode["urn"] == "urn:srf:audio:abc"
    assert any("page=2" in c for c in calls)


def test_resolve_episode_raises_when_no_match():
    client = SrgssrClient()
    client._show_id = "show-1"
    episodes_resp = _resp(200, {"episodeList": [], "next": None})

    def fake_request(method, url, **kwargs):
        return TOKEN_RESP() if url == config.TOKEN_URL else episodes_resp

    with patch.object(srgssr_client._session, "request", side_effect=fake_request):
        with pytest.raises(LookupError):
            client.resolve_episode("Nonexistent story", date(2026, 8, 17))


def test_resolve_episode_raises_when_ambiguous():
    client = SrgssrClient()
    client._show_id = "show-1"
    episodes_resp = _resp(
        200,
        {
            "episodeList": [
                {"mediaList": [_media("Same Title", "2026-08-17T06:30:00+02:00", "urn:srf:audio:one")]},
                {"mediaList": [_media("Same Title", "2026-08-17T12:03:00+02:00", "urn:srf:audio:two")]},
            ],
            "next": None,
        },
    )

    def fake_request(method, url, **kwargs):
        return TOKEN_RESP() if url == config.TOKEN_URL else episodes_resp

    with patch.object(srgssr_client._session, "request", side_effect=fake_request):
        with pytest.raises(LookupError):
            client.resolve_episode("Same Title", date(2026, 8, 17))
