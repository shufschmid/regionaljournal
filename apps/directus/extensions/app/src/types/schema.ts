// Typed view of the collections this application owns.
//
// Keep it in sync with the data model by hand, or regenerate it: the bundled
// `directus-extension-ts-typegen` module (Settings → TypeScript Types in the
// admin UI) writes these types from the live schema. Paste the result here and
// keep the hand-written notes.
//
// The frontend does NOT import this file — it is a separate npm package. It
// generates its own types from the GraphQL schema (`npm run codegen` in
// apps/front). One data model, two generated views of it.

export type DossierStatus = 'pending' | 'processing' | 'processed' | 'failed'

export interface Dossier {
  id: string
  status: DossierStatus
  /** FK -> directus_files.id. The uploaded/fetched dossier PDF. */
  source_file: string
  /** IMAP Message-ID, when the dossier arrived by mail. Null for a manual upload. */
  source_message_id: string | null
  source_subject: string | null
  /** Set by dossiers-process-pending / dossier-process when status becomes 'failed'. */
  error_message: string | null
  processed_at: string | null
  date_created: string | null
  date_updated: string | null
}

export type EditionStatus = 'draft' | 'published' | 'archived'
export type EditionLabel = 'Morgen' | 'Mittag' | 'Abend'

export interface TranscriptParagraph {
  timestamp: string
  seconds: number
  text: string
}

/**
 * Written only by the Claude topic-extraction call in process-dossier.ts.
 * `paragraphTimestamp`/`paragraphSeconds` are null when the topic could not be
 * matched to a real paragraph — the frontend shows the headline without a listen
 * link in that case, matching the old PoC's behaviour rather than forcing a guess.
 */
export interface ExtraTopic {
  headline: string
  paragraphTimestamp: string | null
  paragraphSeconds: number | null
  summary: string | null
}

export interface Edition {
  id: string
  status: EditionStatus
  /** FK -> dossiers.id. One dossier can produce several editions. */
  dossier: string
  broadcast_date: string
  /** Derived from the SRGSSR episode's own `date` hour; null while unresolved. */
  edition_label: EditionLabel | null
  broadcast_at: string | null
  headline: string
  lead: string | null
  /** `cast-json` column: free prose, so not `cast-csv` (which would corrupt on commas). */
  teaser_blocks: string[] | null
  /** SRGSSR `podcastHdUrl` — a direct, public MP3, no iframe embed needed. */
  audio_url: string | null
  srgssr_urn: string | null
  /** `cast-json` column. */
  transcript: TranscriptParagraph[] | null
  /** `cast-json` column. */
  extra_topics: ExtraTopic[] | null
  /** Set per-segment when SRGSSR resolution fails; the edition still gets created, just without audio. */
  resolution_error: string | null
  date_created: string | null
  date_updated: string | null
}

export type Punkt6DossierStatus =
  | 'pending'
  | 'processing'
  | 'processed'
  | 'failed'

export interface Punkt6Dossier {
  id: string
  status: Punkt6DossierStatus
  /** FK -> directus_files.id. The uploaded/fetched Punkt6 dossier PDF. */
  source_file: string
  /** IMAP Message-ID, when the dossier arrived by mail. Null for a manual upload. */
  source_message_id: string | null
  source_subject: string | null
  /** Set by punkt6-dossiers-process-pending / punkt6-dossier-process when status becomes 'failed'. */
  error_message: string | null
  processed_at: string | null
  date_created: string | null
  date_updated: string | null
}

export type Punkt6EditionStatus = 'draft' | 'published' | 'archived'

/**
 * Written only by process-punkt6-dossier.ts. One entry per Beitrag other than the
 * Hauptbeitrag (the edition's own `headline`/`lead`) - same role as `ExtraTopic`
 * for the Regionaljournal `editions` collection, but always fully resolved
 * (telebasel.ch gives exact segment boundaries, so there is no "unmatched" case
 * the way an `ExtraTopic`'s Claude-guessed timestamp can be null).
 */
export interface Punkt6ExtraTopic {
  headline: string
  summary: string | null
  startSeconds: number
  endSeconds: number
}

export interface Punkt6Edition {
  id: string
  status: Punkt6EditionStatus
  /** FK -> punkt6_dossiers.id. One dossier (one episode) produces exactly one edition. */
  dossier: string
  broadcast_date: string
  /** The Hauptbeitrag's title, from telebasel.ch's first Clip. Editable. */
  headline: string
  /** The Hauptbeitrag's optional, Claude-written summary. */
  lead: string | null
  /** `cast-json` column: the WHOLE episode's transcript, not just the Hauptbeitrag's slice. */
  transcript: TranscriptParagraph[] | null
  /** Where the Hauptbeitrag sits within the shared episode video, in seconds. */
  main_start_seconds: number | null
  main_end_seconds: number | null
  /** `cast-json` column: every other Beitrag of this Sendung. */
  extra_topics: Punkt6ExtraTopic[] | null
  /** Resolved video of the WHOLE episode (telebasel.ch `contentUrl`/`data-video-url`), shared by every Beitrag. */
  video_url: string | null
  /** The telebasel.ch episode page, for an editorial "view original" link. */
  episode_url: string | null
  /** Set when no telebasel.ch episode was found for broadcast_date; the edition still gets created, just without video/timing. */
  resolution_error: string | null
  date_created: string | null
  date_updated: string | null
}

export interface Schema {
  dossiers: Dossier[]
  editions: Edition[]
  punkt6_dossiers: Punkt6Dossier[]
  punkt6_editions: Punkt6Edition[]
}
