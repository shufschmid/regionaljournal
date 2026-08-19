import { ImapFlow, type MessageStructureObject } from 'imapflow'
import { simpleParser } from 'mailparser'
import type { Readable } from 'node:stream'
import { envFlag, optionalEnv, requireEnv } from '../../shared/env'
import { selectDossierMessages, type MessageSummary } from './select-messages'

// Fetches unseen dossier-PDF emails from a mailbox via IMAP and turns each into
// an in-memory attachment buffer, ready to be uploaded to Directus Files.
//
// NOT verifiable end-to-end in this build - there is no real mailbox or
// credentials available yet (see HANDOFF.md / the plan this was built from).
// select-messages.ts (what counts as a dossier message) is fully unit-tested
// without any IMAP connection; createMailboxFetcher's own orchestration is
// tested with a stubbed ImapClientLike (mailbox.test.ts), same seam pattern as
// shared/claude.ts's MessageSender. Only the real ImapFlow wiring itself (the
// default client factory below) needs a live smoke test once real IMAP_*
// credentials exist.
//
// Marking a successfully-ingested message \Seen IS the dedupe mechanism - no
// separate "already processed" tracking table is needed, matching "no
// persistent file storage outside Directus" (the mailbox itself is the only
// place this state lives, and it lived there already).

export interface DossierMessage {
  messageId: string
  subject: string
  attachmentFilename: string
  attachmentBuffer: Buffer
  markSeen: () => Promise<void>
}

export interface MailboxConfig {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  mailbox: string
  subjectFilter: string | null
}

export type MailboxFetcher = (config: MailboxConfig, limit: number) => Promise<DossierMessage[]>

export function imapConfigFromEnv(): MailboxConfig {
  const subjectFilter = optionalEnv('IMAP_SUBJECT_FILTER', '')
  return {
    host: requireEnv('IMAP_HOST'),
    port: Number(optionalEnv('IMAP_PORT', '993')),
    secure: envFlag('IMAP_SECURE', true),
    user: requireEnv('IMAP_USER'),
    password: requireEnv('IMAP_PASSWORD'),
    mailbox: optionalEnv('IMAP_MAILBOX', 'INBOX'),
    subjectFilter: subjectFilter === '' ? null : subjectFilter
  }
}

/** The minimal slice of imapflow's ImapFlow this module needs - satisfied
 * structurally by the real client, and trivially fakeable in tests. */
export interface ImapClientLike {
  connect(): Promise<void>
  mailboxOpen(path: string): Promise<unknown>
  search(query: { seen: boolean }, options: { uid: boolean }): Promise<number[] | false>
  fetch(
    range: number[],
    query: { envelope: boolean; bodyStructure: boolean },
    options: { uid: boolean }
  ): AsyncIterableIterator<{
    uid: number
    envelope?: { subject?: string }
    bodyStructure?: MessageStructureObject
    flags?: Set<string>
  }>
  download(range: string, part: string | undefined, options: { uid: boolean }): Promise<{ content: Readable }>
  messageFlagsAdd(range: string, flags: string[], options: { uid: boolean }): Promise<boolean>
  logout(): Promise<void>
  close(): void
}

export type ImapClientFactory = (config: MailboxConfig) => ImapClientLike

const defaultClientFactory: ImapClientFactory = (config) =>
  new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false
  }) as unknown as ImapClientLike

function isPdfNode(node: MessageStructureObject): boolean {
  const type = node.type.toLowerCase()
  const filename = (node.dispositionParameters?.['filename'] ?? node.parameters?.['name'] ?? '').toLowerCase()
  return type === 'application/pdf' || filename.endsWith('.pdf')
}

function hasPdfAttachment(node: MessageStructureObject | undefined): boolean {
  if (!node) return false
  if (isPdfNode(node)) return true
  return (node.childNodes ?? []).some(hasPdfAttachment)
}

export function createMailboxFetcher(clientFactory: ImapClientFactory = defaultClientFactory): MailboxFetcher {
  return async (config, limit) => {
    const client = clientFactory(config)

    await client.connect()
    try {
      await client.mailboxOpen(config.mailbox)

      const uids = await client.search({ seen: false }, { uid: true })
      if (!uids || uids.length === 0) return []

      const summaries: MessageSummary[] = []
      const subjectByUid = new Map<number, string>()
      for await (const message of client.fetch(uids, { envelope: true, bodyStructure: true }, { uid: true })) {
        const subject = message.envelope?.subject ?? '(kein Betreff)'
        subjectByUid.set(message.uid, subject)
        summaries.push({
          uid: message.uid,
          subject,
          hasPdfAttachment: hasPdfAttachment(message.bodyStructure),
          seen: message.flags?.has('\\Seen') ?? false
        })
      }

      const selected = selectDossierMessages(summaries, { limit, subjectFilter: config.subjectFilter })

      const results: DossierMessage[] = []
      for (const summary of selected) {
        const { content } = await client.download(String(summary.uid), undefined, { uid: true })
        const parsed = await simpleParser(content)
        const pdfAttachment = parsed.attachments.find(
          (a) => a.contentType === 'application/pdf' || a.filename?.toLowerCase().endsWith('.pdf')
        )
        if (!pdfAttachment) continue // bodyStructure said PDF, the parsed message disagrees - skip defensively

        results.push({
          messageId: parsed.messageId ?? `uid-${summary.uid}`,
          subject: subjectByUid.get(summary.uid) ?? summary.subject,
          attachmentFilename: pdfAttachment.filename ?? `dossier-${summary.uid}.pdf`,
          attachmentBuffer: pdfAttachment.content,
          markSeen: async () => {
            await client.messageFlagsAdd(String(summary.uid), ['\\Seen'], { uid: true })
          }
        })
      }

      return results
    } finally {
      await client.logout().catch(() => client.close())
    }
  }
}

export const fetchUnseenDossierMessages: MailboxFetcher = createMailboxFetcher()
