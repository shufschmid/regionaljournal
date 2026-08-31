// Pure invariant: a Punkt6 edition can only be published once it has a resolved
// video. Same reasoning as dossiers/editions-guard-publish/guard.ts - this must
// hold on every write path (admin UI, the frontend's plain GraphQL status
// mutation, a future script), which is exactly what a filter hook is for.

export interface Punkt6EditionPublishPayload {
  status?: string | null
}

export interface Punkt6EditionPublishContext {
  video_url: string | null
}

export class UnresolvedPunkt6EditionError extends Error {
  constructor() {
    super(
      'Ein Beitrag ohne aufgeloestes Video kann nicht veroeffentlicht werden.'
    )
    this.name = 'UnresolvedPunkt6EditionError'
  }
}

export function assertPublishable(
  payload: Punkt6EditionPublishPayload,
  current: Punkt6EditionPublishContext
): void {
  if (payload.status === 'published' && current.video_url === null) {
    throw new UnresolvedPunkt6EditionError()
  }
}
