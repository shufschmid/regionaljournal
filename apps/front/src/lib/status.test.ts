import { statusLabel } from './status'

describe('statusLabel', () => {
  it('translates known statuses to German', () => {
    expect(statusLabel('draft')).toBe('Entwurf')
    expect(statusLabel('published')).toBe('Veröffentlicht')
    expect(statusLabel('archived')).toBe('Archiviert')
    expect(statusLabel('pending')).toBe('Ausstehend')
    expect(statusLabel('processing')).toBe('In Verarbeitung')
    expect(statusLabel('processed')).toBe('Verarbeitet')
    expect(statusLabel('failed')).toBe('Fehlgeschlagen')
  })

  it('returns the raw value for an unknown status', () => {
    expect(statusLabel('mystery')).toBe('mystery')
  })
})
