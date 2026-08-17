from datetime import date
from pathlib import Path

from pdf_parser import parse_dossier

REPO_ROOT = Path(__file__).parent.parent

# Hand-verified against SRF's own play-embed links (see srgssr_client.py docstring:
# the Ziefen segment's urn was independently confirmed via the SRGSSR API to be
# urn:srf:audio:5b66d4e0-dafd-354e-9ed7-a4f79403a5ec, matching a manually
# link-annotated copy of this same segment).
EXPECTED_ZIEFEN_PARAGRAPHS = [
    ("00:00:00", "SRF-Audio Das ist das Regionaljournal aus Basel heute Mittag mit dem Marcello Capitelli. Die Firma Bachem ist in den letzten Jahren stark gewachsen. Das Unternehmen, das hat mittlerweile einen Standort in den USA, in England und natürlich am Hauptsitz in Bubendorf. Und auch im Baselbiet will der Pharmazulieferer noch weiter ausbauen. 800’000’000 Franken steckt die Bachem in den Standort. Für den Ausbau will Bachem auch die Hilfe von der kleineren Nachbargemeinde in Siffen. Die wehrt sich aber erfolgreich gegen den Weltkonzern. Claudia Kenan"),
    ("00:00:39", "Bachrem hat nämlich einen temporären Parkplatz in Sefen bauen wollen, einen für Handwerkerinnen und Bauarbeiter, wo Bachrem für den grossen Ausbau in Bubendorf braucht. Gegen den Parkplatz hat sich in Sefen aber so stark gewehrt, dass Bachrem einen Rückzug gemacht hat, wie die Zeitung Volksstimme als Erste berichtet hat. Bachrem hat das Baugesuch für den Parkplatz nach dem Protest aus Sefen nämlich zurückgezogen. Die Gemeindepräsidentin Cornelia Rudin freut das. Der Gemeinderat habe nicht gewollt, dass das Land sozusagen brachliegt."),
    ("00:01:11", "Wir wollen den Platz wirklich für Gewerbe oder für einen Betrieb, wo aktiv genutzt wird, wo es dann eben auch Arbeitsplätze hätte und so weiter. Und nicht einfach ein Parkplatz, wo brachliegt, so in dem Sinn."),
    ("00:01:24", "In Seewen hat man ausserdem auch Angst gehabt vor dem Verkehr, wo der Parkplatz gebracht hat. Dass der temporäre Parkplatz bald wieder wegkommen würde, hat die Cornelia Ruedi nicht geglaubt."),
    ("00:01:36", "Man sieht ja, wie die Bachem baut und baut. Und wie viele Jahre, dass das ist, das können wir noch nicht sagen."),
    ("00:01:40", "Bachrem hat am Standort Bubendorf viel vor 800’000’000 will der Konzern investieren. Allein in Bubendorf hat er mit 2000 Angestellten mehr Leute als in der 1800 Seelengemeinde Zeven wohnen. Steht da also ein kleines Dorf gegen einen Weltkonzern auf?"),
    ("00:02:00", "Das sehen wir nicht so, dass wir da jetzt gegen den Konzern antreiben, sondern Wir möchten einfach für das, wo wir haben, eben für das Grundstück, einfach den richtigen Betrieb haben."),
    ("00:02:08", "Der grosse Ausbau kann Bachrem auch ohne den Parkplatz in Seewen machen, teilt das Unternehmen mit. Man müsse jetzt halt einfach nach anderen Möglichkeiten suchen."),
    ("00:02:20", "Die Claudia Kenan hat berichtet. In unserer Sendung Heute Abend reden wir über Filme aus Basel. Seit 10 Jahren wird das Filmschaffen vom Kanton nämlich deutlich mehr gefördert. In den letzten Jahren habe sich viel getan, sagt der Philipp Kuhn, wo im Vorstand von Balimage ist."),
    ("00:02:38", "In erster Linie hat es ganz viele tolle Filme gegeben in dieser Zeit. Die Szene ist massiv gewachsen, es hat neue Firmen gegeben, wo sich in Basel angesiedelt haben. Es hat eine Dynamik ausgelöst. Und ich glaube, der Filmstandort Basel hat heute in der Schweiz ein ziemlich tolles Image."),
    ("00:02:56", "Wir reden mit dem Philipp Kuhni und einem Basler Regisseur über die Entwicklungen in der Basler Filmszene. Sie hören es heute Abend bei uns im Regionaljournal ab der 5 Uhr 30 Uhr hier auf SRF1."),
]


def test_ziefen_segment_matches_known_correct_reference():
    segments = parse_dossier(str(REPO_ROOT / "Dossier (1).pdf"))
    ziefen = segments[0]

    assert ziefen.broadcast_date == date(2026, 8, 17)
    assert ziefen.headline == "Ziefen wehrt sich gegen Bachem-Parkplatz"
    assert len(ziefen.paragraphs) == len(EXPECTED_ZIEFEN_PARAGRAPHS)
    for p, (ets, etext) in zip(ziefen.paragraphs, EXPECTED_ZIEFEN_PARAGRAPHS):
        assert p.timestamp == ets
        assert p.text == etext


def test_dossier_one_has_three_segments_in_toc_order():
    segments = parse_dossier(str(REPO_ROOT / "Dossier (1).pdf"))
    assert [s.headline for s in segments] == [
        "Ziefen wehrt sich gegen Bachem-Parkplatz",
        "FCB gegen FCB im Joggeli",
        "UPK Basel: Praktikanten haben ADHS-Abklärungen gemacht",
    ]
    assert [s.broadcast_date for s in segments] == [date(2026, 8, 17), date(2026, 8, 17), date(2026, 8, 16)]


def test_multi_page_segment_paragraph_split_across_page_break_is_stitched_together():
    segments = parse_dossier(str(REPO_ROOT / "Dossier (2).pdf"))
    pilz = segments[0]
    # paragraph 00:04:36 starts on page 1 ("...B wären") and continues on page 2
    # ("die Kosten viel höher gewesen...") - it must end up as ONE paragraph.
    para = next(p for p in pilz.paragraphs if p.timestamp == "00:04:36")
    assert "B wären" in para.text
    assert "die Kosten viel höher gewesen" in para.text
    assert para.text.index("B wären") < para.text.index("die Kosten viel höher gewesen")


def test_teaser_blocks_include_ausserdem_paragraph():
    segments = parse_dossier(str(REPO_ROOT / "Dossier (1).pdf"))
    fcb = next(s for s in segments if "FCB gegen FCB" in s.headline)
    assert len(fcb.teaser_blocks) == 2
    assert "Ausserdem" in fcb.teaser_blocks[1]


def test_hyphenated_word_split_across_a_line_wrap_joins_without_extra_space():
    # the FCB teaser wraps "FCB-Fans" across two PDF lines ("FCB-" / "Fans");
    # it must come back as "FCB-Fans", not "FCB- Fans"
    segments = parse_dossier(str(REPO_ROOT / "Dossier (1).pdf"))
    fcb = next(s for s in segments if "FCB gegen FCB" in s.headline)
    assert "FCB-Fans" in fcb.teaser_blocks[0]
    assert "FCB- Fans" not in fcb.teaser_blocks[0]
