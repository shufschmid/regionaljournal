from pathlib import Path

from blog_writer import LATE_MATCH_RATIO, _build_extra_topics, _earliest_match_ratio, _edition_label, _keywords
from pdf_parser import parse_dossier
from datetime import datetime

REPO_ROOT = Path(__file__).parent.parent


def test_late_match_ratio_calibration_against_the_four_known_cases():
    # the Pratteln mismatch must clear the threshold; the two correct matches
    # that must NOT be reassigned both sit comfortably below it
    upk = next(s for s in parse_dossier(str(REPO_ROOT / "Dossier (1).pdf")) if "UPK" in s.headline)
    pratteln_p = next(p for p in upk.paragraphs if p.timestamp == "00:07:15")
    pratteln_kws = _keywords("Silvia Lerch ist neue Gemeindepräsidentin von Pratteln")
    assert _earliest_match_ratio(pratteln_p.text, pratteln_kws) > LATE_MATCH_RATIO

    pilz = parse_dossier(str(REPO_ROOT / "Dossier (2).pdf"))[0]
    poker_p = next(p for p in pilz.paragraphs if p.timestamp == "00:07:51")
    poker_kws = _keywords("Pokerface gefragt: Zwei Baselbieterinnen möchten Frauen zum Pokerspielen motivieren")
    assert _earliest_match_ratio(poker_p.text, poker_kws) < LATE_MATCH_RATIO


def test_edition_label_thresholds():
    assert _edition_label(datetime(2026, 8, 17, 6, 31)) == "Morgen"
    assert _edition_label(datetime(2026, 8, 17, 10, 59)) == "Morgen"
    assert _edition_label(datetime(2026, 8, 17, 12, 3)) == "Mittag"
    assert _edition_label(datetime(2026, 8, 17, 15, 59)) == "Mittag"
    assert _edition_label(datetime(2026, 8, 16, 17, 30)) == "Abend"


def _segment(pdf, headline_contains):
    segs = parse_dossier(str(REPO_ROOT / pdf))
    return next(s for s in segs if headline_contains in s.headline)


def test_extra_topic_matching_skips_the_rundown_and_finds_the_real_coverage():
    # both "Ambulanz..." and "Silvia Lerch..." are name-checked in the UPK
    # segment's own opening rundown paragraph (00:00:09) before their real,
    # dedicated coverage starts later - matching must not stop at the rundown
    upk = _segment("Dossier (1).pdf", "UPK Basel")
    description = (
        "Ausserdem in der Sendung:\n\n"
        "·\tAmbulanz bei Einsatz im Kleinbasel angegriffen\n"
        "·\tSilvia Lerch ist neue Gemeindepräsidentin von Pratteln"
    )
    topics = _build_extra_topics(description, upk.paragraphs, None)
    # Pratteln lands at 00:08:15, not 00:07:15: the keyword hit at 00:07:15 is
    # only the tail end of a sports-roundup paragraph (ratio .79, past
    # LATE_MATCH_RATIO), so matching hands off to the next paragraph - Silvia
    # Lerch's own quote, which is the real start of dedicated coverage
    assert [t.paragraph.timestamp for t in topics] == ["00:05:23", "00:08:15"]
    assert "Kleinbasel" in topics[0].summary
    assert "Pratteln" in topics[1].summary


def test_extra_topic_matching_prefers_best_match_over_first_coincidental_hit():
    # a two-keyword coincidental hit earlier in the transcript (a segue
    # mentioning football's "zweithöchsten" league and "Pokerface" in passing)
    # must lose to the much stronger, later match that is the story itself
    pilz = _segment("Dossier (2).pdf", "Pilz statt Politik")
    description = (
        "Ausserdem:\n\n"
        "·\tPokerface gefragt: Zwei Baselbieterinnen möchten Frauen zum Pokerspielen motivieren\n"
        "·\tWochengast: Susanne Fischer ist zuständig für die Klimaanpassung des Kantons Basel-Stadt. "
        "Über Möglichkeiten und Grenzen spricht sie im Interview."
    )
    topics = _build_extra_topics(description, pilz.paragraphs, None)
    assert topics[0].paragraph.timestamp == "00:07:51"
    assert topics[1].paragraph.timestamp == "00:11:58"


def test_extra_topic_with_no_dedicated_coverage_is_left_unmatched():
    # FCB's "Ausserdem" item is only ever mentioned once, inside the segment's
    # own intro paragraph - there is no dedicated coverage to link to, and the
    # matcher must not force a bad match rather than admit that
    fcb = _segment("Dossier (1).pdf", "FCB gegen FCB")
    description = "Ausserdem: ·\tMehrere Grosseinsätze fordern Rettungskräfte in Basel"
    topics = _build_extra_topics(description, fcb.paragraphs, None)
    assert topics[0].paragraph is None
    assert topics[0].summary is None
