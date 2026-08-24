import { defineOperationApi } from '@directus/extensions-sdk'
import { buffer } from 'node:stream/consumers'
import { processDossier, type ItemsServiceLike } from '../../dossiers/process-dossier'
import { createSrgssrClient } from '../../dossiers/srgssr-client'
import { optionalEnv } from '../../shared/env'
import type { Dossier, Edition } from '../../types/schema'
import { selectPendingDossiers } from './pending'

// Scheduled work: attach to a Directus Flow with a Schedule (cron) trigger
// (Settings -> Flows -> Create Flow -> Trigger "Schedule (cron)" -> add this
// operation -> Save, then `npm run schema:dump`). This is the "process" half of
// the ingestion/processing split - it only looks at dossiers that already exist
// with status='pending', regardless of how they got there (admin-UI upload today,
// dossiers-ingest-imap tomorrow).
//
// One SRGSSR client is created once per run and reused across every dossier in
// the batch, so its in-memory token/show-id cache actually pays off within a run.
//
// Bounded (`limit`) and one bad dossier is logged and skipped rather than
// aborting the run - processDossier itself already turns a bad dossier into a
// 'failed' status rather than throwing, so "skipped" here only covers a genuinely
// unexpected failure (e.g. the dossier row itself became unreadable mid-run).

export interface Options {
  limit: number
}

export default defineOperationApi<Options>({
  id: 'dossiers-process-pending',
  handler: async ({ limit }, { services, getSchema, logger }) => {
    const schema = await getSchema()
    const { ItemsService, AssetsService } = services

    // No accountability: a scheduled Flow has no user, so this runs with full
    // access - read/write only what processDossier actually needs.
    const dossiers = new ItemsService('dossiers', { schema }) as unknown as ItemsServiceLike<Dossier>
    const editions = new ItemsService('editions', { schema }) as unknown as ItemsServiceLike<Edition>
    const assets = new AssetsService({ schema })

    // Deliberately optionalEnv, not requireEnv - see the matching comment in
    // endpoints/dossier-process/index.ts.
    const showId = optionalEnv('SRGSSR_SHOW_ID', '')
    const srgssrClient = createSrgssrClient({
      clientId: optionalEnv('SRGSSR_CLIENT_ID', ''),
      clientSecret: optionalEnv('SRGSSR_CLIENT_SECRET', ''),
      showId: showId === '' ? null : showId
    })

    const candidates = (await dossiers.readByQuery({
      filter: { status: { _eq: 'pending' } },
      sort: ['date_created'],
      limit: 100,
      fields: ['id']
    })) as { id: string }[]

    const pending = selectPendingDossiers(candidates, limit)

    let processed = 0
    let failed = 0

    for (const { id } of pending) {
      try {
        const result = await processDossier(id, {
          dossiers,
          editions,
          readSourceFile: async (fileId) => {
            const { stream } = await assets.getAsset(fileId)
            return buffer(stream)
          },
          srgssrClient,
          logger
        })
        if (result.status === 'processed') processed++
        else failed++
      } catch (error) {
        logger.warn(error, `dossiers-process-pending: skipped dossier ${id}`)
        failed++
      }
    }

    // Shows up in the Flow log - make it worth reading.
    return { candidates: candidates.length, pending: pending.length, processed, failed }
  }
})
