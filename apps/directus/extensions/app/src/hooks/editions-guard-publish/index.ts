import { defineHook } from '@directus/extensions-sdk'
import { assertPublishable, type EditionPublishPayload } from './guard'

// `filter` runs before the write and must return the (possibly modified) payload
// - the only place that can still change what gets stored. It fires on every
// write path (admin UI, the frontend's plain GraphQL status mutation, a future
// script), which is exactly why the "can't publish without audio" invariant
// belongs here rather than in one specific caller.
export default defineHook(({ filter }, { services, getSchema }) => {
  filter('editions.items.update', async (payload, meta) => {
    const p = payload as EditionPublishPayload
    if (p.status !== 'published') return payload

    const keys = Array.isArray(meta['keys']) ? (meta['keys'] as unknown[]) : []
    const key = keys[0]
    if (typeof key !== 'string') return payload

    // System-level read, not the caller's accountability: this only checks an
    // internal invariant (does this row have audio?) and never exposes the
    // value back to the client, so the caller's own read permissions don't need
    // to cover `audio_url` for the guard itself to work.
    const editions = new services.ItemsService('editions', { schema: await getSchema() })
    const current = (await editions.readOne(key, { fields: ['audio_url'] })) as { audio_url: string | null }

    assertPublishable(p, current)
    return payload
  })
})
