// Shared status vocabulary (draft/published/archived) - used by editions today,
// and by anything else with the same lifecycle in the future. Factored out
// rather than duplicated, since it's the exact same three-entry map either way.

export function statusLabel(status: string): string {
  switch (status) {
    case 'draft':
      return 'Entwurf'
    case 'published':
      return 'Veröffentlicht'
    case 'archived':
      return 'Archiviert'
    case 'pending':
      return 'Ausstehend'
    case 'processing':
      return 'In Verarbeitung'
    case 'processed':
      return 'Verarbeitet'
    case 'failed':
      return 'Fehlgeschlagen'
    default:
      return status
  }
}
