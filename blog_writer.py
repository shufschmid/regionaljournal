"""Groups parsed dossier segments into one blog post per broadcast EDITION
(Morgen/Mittag/Abend), each with a native <audio> player and per-paragraph
jump links, and renders the result as a standalone HTML page.
"""
from __future__ import annotations

import html
import re
from dataclasses import dataclass
from datetime import date, datetime

from pdf_parser import Paragraph, Segment, parse_dossier
from srgssr_client import SrgssrClient

BULLET_RE = re.compile(r"·\s*\t?\s*")


@dataclass
class ExtraTopic:
    headline: str
    paragraph: Paragraph | None = None  # where this topic actually starts, if found
    summary: str | None = None


@dataclass
class Post:
    segment: Segment
    edition: str | None  # "Morgen" / "Mittag" / "Abend", or None if unresolved
    broadcast_dt: datetime | None  # exact broadcast time, or None if unresolved
    audio_url: str | None  # direct, playable MP3 URL
    lead: str | None
    extra_topics: list[ExtraTopic]

    @property
    def sort_key(self):
        # unresolved posts (no exact time) sort using the PDF's own date at
        # midnight, so they still land in roughly the right place
        return self.broadcast_dt or datetime.combine(self.segment.broadcast_date, datetime.min.time())


def _edition_label(dt: datetime) -> str:
    if dt.hour < 11:
        return "Morgen"
    if dt.hour < 16:
        return "Mittag"
    return "Abend"


def _parse_extra_topic_headlines(description: str | None) -> list[str]:
    if not description:
        return []
    # format: "Ausserdem[ in der Sendung]:\n·\tTopic one\n·\tTopic two"
    _, _, bullets = description.partition(":")
    items = [BULLET_RE.sub("", item).strip() for item in bullets.split("·")]
    return [item for item in items if item]


# -- Hochdeutsch corrections for the auto-transcribed source text -----------
#
# The dossier transcribes spoken Swiss German, and the machine transcription
# sometimes carries dialect grammar straight into the written text - dropped
# verbs ("...die Silvia Lerch von der FDP." with no "heisst"), "am + Infinitiv"
# progressive forms ("am versorgen gewesen seien"), "die/der + Name" (colloquial
# article before a proper name). This is real language understanding, not a
# pattern a regex can safely generalize, so for now these are hand-corrected;
# a production pipeline processing new dossiers unattended would need a
# genuine rewriting step (e.g. an LLM call) here instead of this fixed table.
_SUMMARY_CORRECTIONS: dict[str, str] = {
    "Ambulanz bei Einsatz im Kleinbasel angegriffen": (
        "An der Uferstrasse im Kleinbasel wurden in der Nacht auf Samstag mehrere "
        "Personen verletzt. Sanitäter versorgten gerade einen Mann mit Stichwunden, "
        "als ein weiterer Verletzter eintraf und mehrere Personen den Rettungswagen "
        "angriffen. Die Sanitäter mussten sich im Fahrzeug verbarrikadieren."
    ),
    "Silvia Lerch ist neue Gemeindepräsidentin von Pratteln": (
        "Pratteln hat mit Silvia Lerch (FDP) eine neue Gemeindepräsidentin. Sie setzte "
        "sich im zweiten Wahlgang gegen Rahel Graf (SP) durch und zeigte sich sehr "
        "erfreut über ihre Wahl."
    ),
    "Pokerface gefragt: Zwei Baselbieterinnen möchten Frauen zum Pokerspielen motivieren": (
        "Bei diesem Turnier spielen auch zwei Baselbieterinnen mit: Yvonne Savary Giger "
        "und Claudia Lüscher. Sie sind Teil der Wicket Alliance, einem Zusammenschluss "
        "von acht teils professionellen Pokerspielerinnen aus Deutschland, Österreich "
        "und der Schweiz."
    ),
    "Wochengast: Susanne Fischer ist zuständig für die Klimaanpassung des Kantons "
    "Basel-Stadt. Über Möglichkeiten und Grenzen spricht sie im Interview.": (
        "Besonders anstrengend ist die Hitze für viele Menschen in der Stadt, wo es "
        "kaum kühle Orte gibt. Damit sich das Stadtklima künftig verbessert, "
        "beschäftigt sich Susanne Fischer mit Klimaanpassung - sie ist diese Woche "
        "unser Wochengast."
    ),
}


# -- locating where an "Ausserdem" topic actually starts in the transcript --
#
# The dossier's headline story gets full paragraph-by-paragraph coverage, but
# the other topics mentioned in "Ausserdem" are only that: a one-line mention.
# Editions with several topics (mostly Abend) open with a rundown paragraph
# that name-checks EVERY topic of the show ("...Wahlen in Pratteln, die neue
# Gemeindepräsidentin heisst Silvia Lerch...") before the self-identifying
# "Mikrofon heute Abend ist..." marker. Naively matching on first keyword hit
# would just point back at that rundown line for every topic. So: locate the
# marker paragraph first, then only search *after* it for where a topic is
# actually covered in its own right.
_INTRO_MARKER_PATTERNS = [
    re.compile(r"heute\s+(?:am\s+)?(?:Morgen|Mittag|Abend)\s+mit", re.I),
    re.compile(r"Mikrofon\s+heute\s+(?:Morgen|Mittag|Abend)\s+ist", re.I),
]

_STOPWORDS = {
    "eine", "einen", "einer", "eines", "einem", "sind", "auch", "wird", "neue", "neuer",
    "neues", "neuen", "noch", "dass", "nach", "über", "unter", "haben", "wurde", "werden",
    "diese", "dieser", "dieses", "diesen", "viele", "mehr", "sein", "ihre", "ihrer", "ihren",
    "sowie", "sich", "worden", "seien", "seine", "basel", "baselland", "basler", "heute",
    "kanton", "sagt", "schreibt", "mehrere",
    "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn",
}

_WORD_RE = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿ]+")
_SENTENCE_SPLIT_RE = re.compile(r"(?<!\d)([.!?])\s+(?=[A-ZÄÖÜ])")


def _keywords(text: str) -> set[str]:
    return {w.lower() for w in _WORD_RE.findall(text) if len(w) >= 4 and w.lower() not in _STOPWORDS}


def _split_sentences(text: str) -> list[str]:
    parts, last = [], 0
    for m in _SENTENCE_SPLIT_RE.finditer(text):
        end = m.end(1)
        parts.append(text[last:end].strip())
        last = end
    tail = text[last:].strip()
    if tail:
        parts.append(tail)
    return parts


DEFAULT_SUMMARY_LEN = 320


def _short_summary(paragraph_text: str, keywords: set[str], max_len: int = DEFAULT_SUMMARY_LEN) -> str:
    sentences = _split_sentences(paragraph_text)
    start_idx = next((i for i, s in enumerate(sentences) if any(kw in s.lower() for kw in keywords)), 0)

    chosen: list[str] = []
    total = 0
    for s in sentences[start_idx:]:
        if chosen and total + 1 + len(s) > max_len:
            break
        chosen.append(s)
        total += 1 + len(s)
    summary = " ".join(chosen)

    if len(summary) > max_len:
        summary = summary[:max_len].rsplit(" ", 1)[0] + "…"
    return summary


def _find_intro_end_index(paragraphs: list[Paragraph]) -> int:
    for i, p in enumerate(paragraphs):
        if any(pat.search(p.text) for pat in _INTRO_MARKER_PATTERNS):
            return i
    return 0


# If a paragraph's earliest keyword hit falls this far into its text, the
# paragraph is probably a grab-bag (e.g. a sports roundup) that only tacks the
# real topic on at the very end as a segue into the next item - the dedicated
# coverage is actually the paragraph *after* this one. Calibrated against the
# 4 known real cases: the Pratteln mismatch this catches sits at .79; the two
# correct matches that must NOT be caught sit at .55 and .29, so .65 leaves
# comfortable margin on both sides.
LATE_MATCH_RATIO = 0.65


def _earliest_match_ratio(text: str, keywords: set[str]) -> float:
    text_lower = text.lower()
    positions = [text_lower.find(kw) for kw in keywords if kw in text_lower]
    if not positions or not text:
        return 0.0
    return min(positions) / len(text)


def _locate_extra_topic(
    headline: str,
    paragraphs: list[Paragraph],
    search_from: int,
    max_summary_len: int,
    other_keyword_sets: list[set[str]],
) -> ExtraTopic:
    kws = _keywords(headline)
    if not kws:
        return ExtraTopic(headline)

    threshold = min(2, len(kws))
    best_p, best_idx, best_score = None, None, 0
    for i, p in enumerate(paragraphs):
        if i < search_from:
            continue
        hits = sum(1 for kw in kws if kw in p.text.lower())
        # best (not first) match past the threshold - a topic is often
        # name-checked in a one-line segue before its real coverage starts, so
        # picking the first hit tends to land on the segue rather than the
        # story; ">=" also means later paragraphs win ties, since a segue
        # chronologically precedes the coverage it's introducing
        if hits >= threshold and hits >= best_score:
            best_p, best_idx, best_score = p, i, hits

    if not best_p:
        return ExtraTopic(headline)

    if _earliest_match_ratio(best_p.text, kws) > LATE_MATCH_RATIO and best_idx + 1 < len(paragraphs):
        next_p = paragraphs[best_idx + 1]
        next_lower = next_p.text.lower()
        # only hand off to the next paragraph if it isn't clearly a *different*
        # already-known topic taking its own turn next
        steals_another_topic = any(
            other_kws and sum(1 for kw in other_kws if kw in next_lower) >= min(2, len(other_kws))
            for other_kws in other_keyword_sets
        )
        if not steals_another_topic:
            best_p = next_p

    summary = _SUMMARY_CORRECTIONS.get(headline) or _short_summary(best_p.text, kws, max_summary_len)
    return ExtraTopic(headline, paragraph=best_p, summary=summary)


def _build_extra_topics(description: str | None, paragraphs: list[Paragraph], lead: str | None) -> list[ExtraTopic]:
    headlines = _parse_extra_topic_headlines(description)
    if not headlines:
        return []
    search_from = _find_intro_end_index(paragraphs) + 1
    # an "Ausserdem" summary should never outweigh the main story's own summary
    max_summary_len = min(DEFAULT_SUMMARY_LEN, len(lead)) if lead else DEFAULT_SUMMARY_LEN
    all_keywords = [_keywords(h) for h in headlines]
    return [
        _locate_extra_topic(
            h, paragraphs, search_from, max_summary_len,
            other_keyword_sets=[kw for j, kw in enumerate(all_keywords) if j != i],
        )
        for i, h in enumerate(headlines)
    ]


def build_posts(pdf_paths: list[str], client: SrgssrClient) -> list[Post]:
    posts: list[Post] = []
    for pdf_path in pdf_paths:
        for segment in parse_dossier(pdf_path):
            try:
                episode = client.resolve_episode(segment.headline, segment.broadcast_date)
            except LookupError as e:
                print(f"WARNING: could not resolve {segment.broadcast_date} {segment.headline!r}: {e}")
                posts.append(Post(segment, None, None, None, None, []))
                continue

            dt = datetime.fromisoformat(episode["date"])
            posts.append(
                Post(
                    segment=segment,
                    edition=_edition_label(dt),
                    broadcast_dt=dt,
                    audio_url=episode.get("podcastHdUrl") or episode.get("podcastSdUrl"),
                    lead=episode.get("lead"),
                    extra_topics=_build_extra_topics(
                        episode.get("description"), segment.paragraphs, episode.get("lead")
                    ),
                )
            )

    posts.sort(key=lambda p: p.sort_key, reverse=True)
    return posts


# -- HTML rendering ----------------------------------------------------------

_PAGE_TEMPLATE = """<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Regionaljournal Basel Baselland</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {{
    --bg: #f7f5f2; --card-bg: #ffffff; --text: #1c1c1c; --text-muted: #6b6b6b;
    --accent: #c02f2f; --border: #e5e2dd; --chip-bg: #f0ece5;
  }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; padding: 2rem 1rem 4rem; background: var(--bg); color: var(--text);
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.5;
  }}
  .page {{ max-width: 720px; margin: 0 auto; }}
  header.site {{ margin-bottom: 2.5rem; text-align: center; }}
  header.site h1 {{ font-size: 1.6rem; margin: 0 0 .25rem; }}
  header.site p {{ color: var(--text-muted); margin: 0; font-size: .95rem; }}
  article {{
    background: var(--card-bg); border: 1px solid var(--border); border-radius: 12px;
    padding: 1.5rem 1.5rem 1.75rem; margin-bottom: 1.75rem;
  }}
  .meta {{ display: flex; align-items: center; gap: .4rem; margin: 0 0 .2rem; font-size: .8rem; }}
  .meta time {{ color: var(--text-muted); }}
  .chip.edition {{
    background: var(--accent); color: #fff; font-size: inherit; font-weight: 600;
    padding: .05rem .55rem; border-radius: 999px; line-height: 1.5;
  }}
  h2.headline {{ font-size: 1.3rem; margin: 0 0 .8rem; }}
  p.lead {{ margin: 0 0 1rem; }}
  a.listen-link {{
    color: var(--accent); text-decoration: none; font: inherit; font-weight: 700; white-space: nowrap;
  }}
  a.listen-link:hover {{ text-decoration: underline; }}
  p.lead a.listen-link {{ font-weight: 400; }}
  ul.extra-topics {{ list-style: none; margin: 0 0 1.1rem; padding: 0; }}
  ul.extra-topics li {{ margin-bottom: .9rem; padding-left: .9rem; border-left: 2px solid var(--border); }}
  .extra-topic-headline {{ font-weight: 600; font-size: .92rem; margin: 0 0 .25rem; }}
  .extra-topic-summary {{ margin: 0; color: var(--text-muted); font-size: .87rem; }}
  .player-wrap {{ margin-bottom: 1rem; }}
  audio.player {{ width: 100%; }}
  details.transcript summary {{
    cursor: pointer; font-size: .88rem; color: var(--accent); font-weight: 600; margin-bottom: .5rem;
  }}
  ul.paragraphs {{ list-style: none; margin: .5rem 0 0; padding: 0; }}
  ul.paragraphs li {{ margin-bottom: .55rem; font-size: .92rem; }}
  ul.paragraphs a.ts {{
    display: inline-block; min-width: 3.6rem; color: var(--accent); font-weight: 700;
    text-decoration: none; font-variant-numeric: tabular-nums;
  }}
  ul.paragraphs a.ts:hover {{ text-decoration: underline; }}
  .unresolved {{ color: var(--text-muted); font-style: italic; font-size: .9rem; }}
</style>
</head>
<body>
<div class="page">
  <header class="site">
    <h1>Regionaljournal Basel Baselland</h1>
    <p>Service Public in 30 Sekunden statt 30 Minuten</p>
  </header>
  {posts}
</div>
<script>
  document.addEventListener("click", function (e) {{
    var link = e.target.closest("a[data-audio]");
    if (!link) return;
    var audio = document.getElementById(link.dataset.audio);
    if (!audio) return;
    e.preventDefault();
    audio.currentTime = parseFloat(link.dataset.seconds);
    audio.play();
    audio.scrollIntoView({{ behavior: "smooth", block: "center" }});
  }});
</script>
</body>
</html>
"""

_POST_TEMPLATE = """  <article>
    <div class="meta">
      <time>{date_str}</time>
      {edition_chip}
    </div>
    <h2 class="headline">{headline}</h2>
    {lead_html}
    {extra_topics_html}
    {player_html}
  </article>
"""


def _e(text: str) -> str:
    return html.escape(text, quote=True)


def _listen_link(audio_id: str, seconds: int, label: str) -> str:
    return f'<a class="listen-link" href="#" data-audio="{audio_id}" data-seconds="{seconds}">🎧 {_e(label)}</a>'


def _render_extra_topic(topic: ExtraTopic, audio_id: str | None) -> str:
    if audio_id and topic.paragraph and topic.summary:
        listen_html = " " + _listen_link(audio_id, topic.paragraph.seconds, "Beitrag anhören")
        summary_html = f'<p class="extra-topic-summary">{_e(topic.summary)}{listen_html}</p>'
    else:
        summary_html = ""
    return f'<li><p class="extra-topic-headline">{_e(topic.headline)}</p>{summary_html}</li>'


def render_post(post: Post, index: int, show_time: bool = False) -> str:
    seg = post.segment
    audio_id = f"audio-{index}" if post.audio_url else None
    headline = _e(seg.headline)

    if post.broadcast_dt and show_time:
        date_str = post.broadcast_dt.strftime("%d.%m.%Y, %H:%M Uhr")
        edition_chip = ""
    elif post.broadcast_dt:
        date_str = post.broadcast_dt.strftime("%d.%m.%Y")
        edition_chip = f'<span class="chip edition">{_e(post.edition)}</span>'
    else:
        date_str = seg.broadcast_date.strftime("%d.%m.%Y")
        edition_chip = ""

    lead_text = post.lead or (seg.teaser_blocks[0] if seg.teaser_blocks else "")
    if lead_text and audio_id:
        listen_html = " " + _listen_link(audio_id, 0, "Beitrag anhören")
        lead_html = f'<p class="lead">{_e(lead_text)}{listen_html}</p>'
    elif lead_text:
        lead_html = f'<p class="lead">{_e(lead_text)}</p>'
    elif audio_id:
        lead_html = f'<p class="lead">{_listen_link(audio_id, 0, "Beitrag anhören")}</p>'
    else:
        lead_html = ""

    extra_topics_html = ""
    if post.extra_topics:
        items = "".join(_render_extra_topic(t, audio_id) for t in post.extra_topics)
        extra_topics_html = f'<ul class="extra-topics">{items}</ul>'

    if audio_id:
        paragraph_items = "".join(
            f'<li><a class="ts" href="#" data-audio="{audio_id}" data-seconds="{p.seconds}">'
            f"{p.timestamp}</a> {_e(p.text)}</li>"
            for p in seg.paragraphs
        )
        player_html = (
            f'<div class="player-wrap">'
            f'<audio id="{audio_id}" class="player" controls preload="none" src="{_e(post.audio_url)}"></audio>'
            f"</div>"
            f'<details class="transcript"><summary>Transkript der ganzen Sendung</summary>'
            f'<ul class="paragraphs">{paragraph_items}</ul></details>'
        )
    else:
        player_html = '<p class="unresolved">Audio konnte nicht aufgelöst werden.</p>'

    return _POST_TEMPLATE.format(
        date_str=date_str,
        edition_chip=edition_chip,
        headline=headline,
        lead_html=lead_html,
        extra_topics_html=extra_topics_html,
        player_html=player_html,
    )


def render_blog(posts: list[Post], show_time: bool = False) -> str:
    posts_html = "\n".join(render_post(p, i, show_time=show_time) for i, p in enumerate(posts))
    return _PAGE_TEMPLATE.format(posts=posts_html)
