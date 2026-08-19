import { describe, expect, it } from 'vitest'
import { assertPublishable, UnresolvedEditionError } from './guard'

describe('assertPublishable', () => {
  it('throws when publishing an edition without resolved audio', () => {
    expect(() => assertPublishable({ status: 'published' }, { audio_url: null })).toThrow(UnresolvedEditionError)
  })

  it('allows publishing once audio is resolved', () => {
    expect(() => assertPublishable({ status: 'published' }, { audio_url: 'https://example.com/a.mp3' })).not.toThrow()
  })

  it('does not check anything for a write that is not publishing', () => {
    expect(() => assertPublishable({ status: 'draft' }, { audio_url: null })).not.toThrow()
    expect(() => assertPublishable({}, { audio_url: null })).not.toThrow()
  })
})
