import { defineHook } from '@directus/extensions-sdk'
import { assertPublishable, type Punkt6EditionPublishPayload } from './guard'

// `filter` runs before the write and must return the (possibly modified) payload
// - the only place that can still change what gets stored. Same shape as
// dossiers/editions-guard-publish - fires on every write path.
export default defineHook(({ filter }, { services, getSchema }) => {
  filter('punkt6_editions.items.update', async (payload, meta) => {
    const p = payload as Punkt6EditionPublishPayload
    if (p.status !== 'published') return payload

    const keys = Array.isArray(meta['keys']) ? (meta['keys'] as unknown[]) : []
    const key = keys[0]
    if (typeof key !== 'string') return payload

    // System-level read, not the caller's accountability: this only checks an
    // internal invariant (does this row have video?) and never exposes the
    // value back to the client.
    const editions = new services.ItemsService('punkt6_editions', {
      schema: await getSchema()
    })
    const current = (await editions.readOne(key, {
      fields: ['video_url']
    })) as { video_url: string | null }

    assertPublishable(p, current)
    return payload
  })
})
