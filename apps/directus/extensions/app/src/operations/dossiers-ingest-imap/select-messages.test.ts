import { describe, expect, it } from 'vitest'
import { selectDossierMessages, type MessageSummary } from './select-messages'

function msg(overrides: Partial<MessageSummary> = {}): MessageSummary {
  return { uid: 1, subject: 'Dossier vom 17.08.2026', hasPdfAttachment: true, seen: false, ...overrides }
}

describe('selectDossierMessages', () => {
  it('only selects unseen messages with a PDF attachment', () => {
    const summaries = [msg({ uid: 1 }), msg({ uid: 2, seen: true }), msg({ uid: 3, hasPdfAttachment: false })]
    expect(selectDossierMessages(summaries, { limit: 5, subjectFilter: null })).toEqual([msg({ uid: 1 })])
  })

  it('applies a case-insensitive subject filter when configured', () => {
    const summaries = [msg({ uid: 1, subject: 'Dossier SRF' }), msg({ uid: 2, subject: 'Newsletter' })]
    expect(selectDossierMessages(summaries, { limit: 5, subjectFilter: 'dossier' })).toEqual([msg({ uid: 1, subject: 'Dossier SRF' })])
  })

  it('caps the batch at the limit, falling back to 5 for an invalid one', () => {
    const summaries = [msg({ uid: 1 }), msg({ uid: 2 }), msg({ uid: 3 })]
    expect(selectDossierMessages(summaries, { limit: 2, subjectFilter: null })).toHaveLength(2)
    expect(selectDossierMessages(summaries, { limit: 0, subjectFilter: null })).toHaveLength(3)
    expect(selectDossierMessages(summaries, { limit: NaN, subjectFilter: null })).toHaveLength(3)
  })

  it('treats an empty/whitespace subject filter as no filter', () => {
    const summaries = [msg({ uid: 1, subject: 'Anything' })]
    expect(selectDossierMessages(summaries, { limit: 5, subjectFilter: '  ' })).toEqual(summaries)
  })
})
