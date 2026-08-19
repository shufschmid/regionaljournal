export interface MessageSummary {
  uid: number
  subject: string
  hasPdfAttachment: boolean
  seen: boolean
}

export interface SelectMessagesOptions {
  limit: number
  subjectFilter: string | null
}

/**
 * Picks which mailbox messages this run should download and turn into dossiers:
 * unread, with a PDF attachment, optionally matching a subject filter, capped at
 * `limit`. Kept pure and separate from the actual IMAP connection (mailbox.ts) so
 * "what counts as a dossier message" is testable without a mailbox.
 */
export function selectDossierMessages(summaries: MessageSummary[], options: SelectMessagesOptions): MessageSummary[] {
  const safeLimit = Number.isFinite(options.limit) && options.limit > 0 ? Math.floor(options.limit) : 5
  const filter = options.subjectFilter?.trim().toLowerCase() || null

  return summaries
    .filter((m) => !m.seen && m.hasPdfAttachment)
    .filter((m) => filter === null || m.subject.toLowerCase().includes(filter))
    .slice(0, safeLimit)
}
