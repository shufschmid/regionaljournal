# regionaljournal

Turns a daily SMD "Dossier" PDF (auto-transcribed SRF Regionaljournal Basel
Baselland segments) into either:

- **`dossier_links.py`** — a Markdown file where every `mm:ss` timestamp
  becomes a clickable deep link into the SRF audio player, resolved via the
  SRGSSR Audio Metadata API.
- **`blog.py`** — a standalone HTML blog, grouped by broadcast edition
  (Morgen/Mittag/Abend) instead of by story, with a native `<audio>` player
  per edition, per-paragraph jump links, and short summaries (including
  "Ausserdem"-mentioned secondary topics, matched to where they actually
  start in the transcript - see `blog_writer.py` for the matching logic).

Each segment in the dossier is a separate story published by SRF as its own
"episode" of the show (not one shared audio file per Morgen/Mittag/Abend
broadcast) - its dossier headline is a verbatim copy of the SRGSSR API's own
episode title, so resolution (`SrgssrClient.resolve_episode`) is a plain
title + date match against `episodeComposition/shows/{showId}`, not a
time-of-day guess.

## Setup

```
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt
copy .env.example .env
```

Then edit `.env` and fill in `SRGSSR_CLIENT_ID` / `SRGSSR_CLIENT_SECRET` (from
your developer.srgssr.ch API access).

Verify auth works:

```
.venv/Scripts/python.exe scripts/check_auth.py
```

## Usage

```
.venv/Scripts/python.exe dossier_links.py "Dossier (1).pdf"
```

Writes `Dossier (1) mit links.md` next to the input by default (`-o` to override).

```
.venv/Scripts/python.exe blog.py "Dossier (1).pdf" "Dossier (2).pdf" -o blog.html --evening-output blog_abend.html
```

Takes one or more dossier PDFs and writes one combined, edition-grouped blog
(newest first). `--evening-output` additionally writes a second file
containing only the Abend editions, with plain date+time instead of the
edition chip - see `example_blog.html` / `example_blog_abend.html` for a
generated example.

## Tests

```
.venv/Scripts/python.exe -m pytest tests/ -v
```

`test_pdf_parser.py` and `test_blog_writer.py` run fully offline against the
real sample PDFs in this repo. `test_srgssr_client.py` mocks all HTTP calls.
`scripts/check_auth.py` and the full `dossier_links.py`/`blog.py` runs are the
only pieces that need live credentials - both have been run successfully
against both sample PDFs.

## Notes on the live API vs. its OpenAPI spec

Discovered while implementing, in case the API changes again:

- Response field names are lowerCamelCase (`channelList`, `searchResultShowList`,
  `episodeList`, `mediaList`) even though `openapi_srgssr_audio_v2_0_5.yaml`
  documents PascalCase (`ChannelList`, `SearchResultListShow`, ...).
- `/radio/channels` only lists the 6 national channels (Radio SRF 1, 2 Kultur, ...) -
  regional shows like "Regionaljournal Basel Baselland" aren't channels, they're
  shows within a channel. Use `/radioshows/search` + `/episodeComposition/shows/{id}`.
- The `next` pagination link returned by `episodeComposition` points at an internal
  `integrationlayer` host that our API product doesn't cover and returns an HTML
  error page instead of JSON. `resolve_episode()` treats a failed `next` fetch as
  "no more pages" rather than crashing; in practice one page (100 episodes, ≈1
  month of this show's output) is enough for same-day dossiers anyway.
- Your Apigee app must be subscribed to an API product that actually includes the
  `audiometadata` proxy, or every call 401s with
  `keymanagement.service.InvalidAPICallAsNoApiProductMatchFound` even though
  token issuance itself succeeds.
- Each episode's `podcastHdUrl` is a direct, publicly-fetchable MP3 - no need to
  embed SRF's own `/play/embed` iframe player at all.
