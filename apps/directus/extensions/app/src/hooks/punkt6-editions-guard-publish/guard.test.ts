import { describe, expect, it } from 'vitest'
import { assertPublishable, UnresolvedPunkt6EditionError } from './guard'

describe('assertPublishable', () => {
  it('throws when publishing an edition without a resolved video', () => {
    expect(() =>
      assertPublishable({ status: 'published' }, { video_url: null })
    ).toThrow(UnresolvedPunkt6EditionError)
  })

  it('allows publishing once a video is resolved', () => {
    expect(() =>
      assertPublishable(
        { status: 'published' },
        { video_url: 'https://simplex-cdn-media.akamaized.net/x.mp4' }
      )
    ).not.toThrow()
  })

  it('does not check anything for a write that is not publishing', () => {
    expect(() =>
      assertPublishable({ status: 'draft' }, { video_url: null })
    ).not.toThrow()
    expect(() => assertPublishable({}, { video_url: null })).not.toThrow()
  })
})
