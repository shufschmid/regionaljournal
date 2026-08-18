# Regionaljournal-Pipeline — Übergabe an produktive Umgebung

Dieses Dokument fasst zusammen, was im Proof-of-Concept-Repo
[`regionaljournal`](.) gebaut und validiert wurde, damit es als Kontext für
einen Auftrag an eine Claude-Code-Instanz im produktiven Umfeld dienen kann.
Es beschreibt bewusst **nur die fachliche/technische Logik**, nicht die
Infrastruktur (Sprache, Datenbank, Hosting, Tools) — diese wird durch die
Regeln der neuen Umgebung vorgegeben und ist unten explizit als offen markiert.

## Kontext

Bajour erhält täglich (mehrmals) ein PDF-"Dossier" von der SMD (Schweizer
Mediendatenbank) mit automatisch transkribierten SRF-Regionaljournal-Beiträgen
(Basel/Baselland). Ziel: daraus automatisiert einen Blog-Post pro
Sendung (Morgen/Mittag/Abend) erzeugen — mit abspielbarem Audio, Sprung zu
einzelnen Timecodes, und einer Kurzzusammenfassung inkl. sekundärer
("Ausserdem"-)Themen.

Das PoC-Repo enthält eine funktionierende Referenzimplementierung in Python
(`pdf_parser.py`, `srgssr_client.py`, `blog_writer.py`, `blog.py`), inkl.
Tests, die live gegen die echte SRGSSR-API verifiziert wurde. Sie sollte als
fachliche Spezifikation dienen, nicht zwingend als 1:1 zu übernehmender Code.

## Was bereits validiert ist (fachliche Logik, wiederverwendbar unabhängig vom Tech-Stack)

**1. PDF-Struktur der Dossiers**
- Ein Dossier-PDF enthält mehrere "Segmente" (= Beiträge), erkennbar am
  Marker-Block `[Automatische Transkription]`. Alles davor (Datum-Header,
  Untertitel "Regionaljournal Basel Baselland", Schlagzeile, Teaser,
  ggf. "Ausserdem: ..."-Block) ist Präambel; danach folgen Absätze im Format
  `HH:MM:SS <Text>`.
- Das PDF ist zweispaltig aufgebaut. Naive Text-Extraktion (z.B. reine
  Lesereihenfolge nach Y-Koordinate über beide Spalten) mischt die Spalten
  durcheinander. Block-basierte Extraktion (PyMuPDF `get_text("dict")`,
  gruppiert nach Spalten-x-Position) funktioniert zuverlässig.
- Bekannte Textartefakte, die korrigiert werden müssen: Ligatur-Zeichen
  (ﬀ/ﬁ/ﬂ → ff/fi/fl, via Unicode-NFKC-Normalisierung), Bindestrich-Zeilenumbrüche
  bei zusammengesetzten Wörtern (z.B. "FCB-" / "Fans" → "FCB-Fans", nicht
  "FCB- Fans"), Seiten-Fusszeile/Datums-Kopfzeile, die pro Seite wiederholt wird
  und aus dem Fliesstext herausgefiltert werden muss. Ein Absatz kann über
  einen Seitenumbruch hinweg fortgesetzt werden (kein neuer Timecode = gleicher
  Absatz).
- Ein einzelnes Zeichen ("CO₂" wird als "CO#" extrahiert) ist ein defekter
  Font/ToUnicode-Mapping-Fehler im Quell-PDF selbst — auch mit alternativen
  PDF-Readern nicht behebbar, seltener Sonderfall.

**2. Audio-Auflösung via SRGSSR Audio Metadata API**
- Jeder Beitrag (nicht jede Sendung) ist eine eigene "Episode" der Show
  "Regionaljournal Basel Baselland" im API-Sinn — die SMD-Schlagzeile ist
  wortwörtlich identisch mit dem API-eigenen `title`-Feld. Auflösung ist daher
  simpel: Titel + Datum matchen gegen `episodeComposition/shows/{showId}`,
  **keine** Zeitfenster-/Editions-Heuristik nötig.
- Direkter, öffentlich abrufbarer MP3-Link liegt bereits im API-Response
  (`podcastHdUrl`) — kein Embedding des SRF-eigenen `/play/embed`-iFrames
  nötig. Das ermöglicht einen nativen `<audio>`-Player mit echtem
  Autoplay-per-Klick (iFrame-Autoplay via `target`-Navigation funktioniert
  nicht zuverlässig, da der Browser das nicht als direkte Nutzerinteraktion
  wertet).
- Sendungs-Edition (Morgen/Mittag/Abend) lässt sich zuverlässig aus der
  Stunde des API-eigenen `date`-Zeitstempels ableiten (< 11 Uhr = Morgen,
  11–16 = Mittag, ≥ 16 = Abend) — robuster als Text-Pattern-Matching im
  Transkript.
- Bekannte API-Fallstricke (Details siehe README dieses Repos):
  - OpenAPI-Spec-Feldnamen (PascalCase) stimmen nicht mit der Live-API
    (lowerCamelCase) überein.
  - `/radio/channels` listet nur die 6 nationalen Sender, nicht regionale
    Sendungen — dafür `/radioshows/search` + `/episodeComposition/shows/{id}`.
  - Die `next`-Pagination von `episodeComposition` zeigt auf einen internen
    Host, der vom öffentlichen API-Produkt nicht abgedeckt ist (liefert HTML
    statt JSON) — in der Praxis reicht eine Seite (≈1 Monat Sendungen).
  - Das Apigee-App muss explizit ein API-Produkt abonniert haben, das den
    `audiometadata`-Proxy abdeckt, sonst 401 trotz gültigem Token.

**3. Zuordnung sekundärer ("Ausserdem"-)Themen zu Timecodes**
- Die API liefert pro Beitrag `lead` (sauberer Hochdeutsch-Teaser) und
  `description` (enthält die "Ausserdem: · ..."-Liste) — bereits redaktionell
  geschrieben, nicht aus dem rohen Transkript extrahiert.
- Für den Timecode/die Zusammenfassung eines "Ausserdem"-Themas muss im
  Transkript gesucht werden, WO es wirklich behandelt wird — naive
  Keyword-Suche scheitert oft, weil Sendungen zu Beginn (oder in
  Sport-Sammelabsätzen) alle Themen kurz anreissen, bevor die eigentliche
  Berichterstattung folgt. Validierte Heuristik:
  1. Suche erst ab dem Absatz nach der Selbstidentifikation der Sendung
     ("...heute Mittag mit..." / "Mikrofon heute Abend ist...").
  2. Bestes (nicht erstes) Keyword-Match wählen, spätere Absätze gewinnen
     bei Gleichstand.
  3. Liegt der früheste Keyword-Treffer sehr spät im Absatz (>65% der
     Absatzlänge), ist der Absatz vermutlich nur eine Überleitung — dann
     stattdessen den nächsten Absatz nehmen (ausser der nächste Absatz
     gehört klar zu einem anderen bereits bekannten Thema).
  - **Wichtige Einschränkung:** Das ist eine positionsbasierte Heuristik,
    kein semantisches Verständnis. Sie wurde an genau 4 realen Fällen
    kalibriert und kann bei unbekannten Mustern falsch treffen. Für den
    produktiven Betrieb sollte das entweder redaktionell gegengelesen
    werden, oder durch einen echten Sprachverständnis-Schritt (LLM-Aufruf)
    ersetzt/ergänzt werden.
- Manche "Ausserdem"-Themen haben keine eigene Berichterstattung im
  Dossier-PDF (nur Erwähnung) — dann gibt es bewusst keinen Link/keine
  Zusammenfassung, statt einen falschen zu erzwingen.

**4. Sprachqualität der Zusammenfassungen**
- Das Dossier transkribiert gesprochenes Schweizerdeutsch; die
  Auto-Transkription übernimmt teilweise Dialekt-Grammatik direkt ins
  Schriftdeutsche (fehlende Verben, "am + Infinitiv"-Verlaufsform,
  "die/der + Name"). Das `lead`-Feld der API ist sauber (redaktionell
  geschrieben), aber aus dem rohen Transkript extrahierte Zusatz-Zusammenfassungen
  sind es nicht.
- Im PoC wurden 4 bekannte Fälle von Hand korrigiert (nicht generalisierbar).
  **Für den produktiven Betrieb ist zu entscheiden**, ob/wie eine echte
  Hochdeutsch-Korrektur automatisiert wird (vermutlich ein LLM-Rewriting-Schritt
  in der Pipeline) oder ob eine redaktionelle Prüfung vor Publikation
  vorgesehen ist.

## Offene Punkte — durch Regeln/Vorgaben der neuen Umgebung zu klären

Diese wurden im PoC bewusst nicht entschieden, da sie ausserhalb des
fachlichen Scopes liegen:

- **Tech-Stack**: PoC ist in Python; produktiv evtl. andere Vorgabe.
- **Auslösung/Zustellung**: Dossiers sollen automatisch per E-Mail eintreffen
  und den Lauf auslösen (auf einem Server) — Postfach-Anbindung
  (IMAP/Graph-API/Webhook?), PDF-Extraktion aus der Mail, Trigger-Mechanismus
  sind noch offen.
- **Persistenz**: Datenbank/Archiv für bereits verarbeitete Sendungen
  (Duplikatserkennung, Historie, generierte Blog-Posts) — im PoC nicht
  vorhanden (jeder Lauf ist zustandslos).
- **Publishing**: Wo landet der generierte Blog (CMS-Anbindung? Statisch
  gehostet? Direkt auf bajour.ch)?
- **Secrets-Management**: PoC nutzt eine lokale `.env`-Datei; produktiv
  braucht es einen richtigen Secret-Store.
- **Fehlerbehandlung/Monitoring**: Was passiert bei nicht auflösbaren URNs,
  geändertem PDF-Format, API-Ausfällen? Wer wird benachrichtigt?
- **Redaktionelle Freigabe**: Läuft die Publikation vollautomatisch, oder
  gibt es einen Review-Schritt vor Veröffentlichung (relevant wegen der oben
  genannten Einschränkungen bei Themen-Matching und Sprachqualität)?

## Hinweis für den Auftrag an die neue Claude-Instanz

Dieses Dokument beschreibt die fachliche Logik und bekannte Fallstricke —
nicht, wie sie technisch umzusetzen sind. Bitte zusammen mit den
Tool-/Datenbank-/Deployment-Vorgaben des Teams als Kontext geben, nicht
anstelle davon.
