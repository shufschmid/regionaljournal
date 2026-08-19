import { defineOperationApi } from '@directus/extensions-sdk'
import { Readable } from 'node:stream'
import { imapConfigFromEnv, fetchUnseenDossierMessages } from './mailbox'

// Scheduled work: attach to a Directus Flow with a Schedule (cron) trigger, same
// as dossiers-process-pending. This is the "ingestion" half of the split - it
// only creates `dossiers` rows (status='pending') from unseen mailbox messages;
// dossiers-process-pending (a separate operation, independently scheduled) turns
// those into editions. Decoupled so the mailbox-specific part can be swapped
// later (e.g. for an inbound-email webhook) without touching processing at all.
//
// Bounded (`limit`) and one bad message is logged and skipped, not marked
// \Seen - it stays unseen and is retried on the next scheduled run.

export interface Options {
  limit: number
}

export default defineOperationApi<Options>({
  id: 'dossiers-ingest-imap',
  handler: async ({ limit }, { services, getSchema, logger }) => {
    const schema = await getSchema()
    const { ItemsService, FilesService } = services

    // No accountability: a scheduled Flow has no user.
    const dossiers = new ItemsService('dossiers', { schema })
    const files = new FilesService({ schema })

    const config = imapConfigFromEnv() // throws via requireEnv, loudly and specifically, if unset
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 5
    const messages = await fetchUnseenDossierMessages(config, safeLimit)

    let created = 0
    for (const message of messages) {
      try {
        const fileId = await files.uploadOne(Readable.from(message.attachmentBuffer), {
          filename_download: message.attachmentFilename,
          type: 'application/pdf'
        })

        await dossiers.createOne({
          status: 'pending',
          source_file: fileId,
          source_message_id: message.messageId,
          source_subject: message.subject
        })

        await message.markSeen()
        created++
      } catch (error) {
        // Deliberately no markSeen() here - a message that failed to ingest
        // stays unseen and is retried on the next scheduled run.
        logger.warn(error, `dossiers-ingest-imap: skipped message ${message.messageId}`)
      }
    }

    return { fetched: messages.length, created }
  }
})
