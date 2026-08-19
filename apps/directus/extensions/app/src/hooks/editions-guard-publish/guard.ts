// Pure invariant: an edition can only be published once it has resolved audio.
//
// This is a data-integrity rule, not something derived by an LLM, so it doesn't
// fit the "invalidate a stale AI cache" pattern the notes-normalize hook
// demonstrates - there's nothing here to invalidate, transcript/extra_topics/
// audio_url are written once by processDossier and never incrementally edited
// the way notes.body is. What IS a genuine fit for a filter hook: this rule must
// hold on every write path (admin UI, the frontend's plain GraphQL status
// mutation, a future script) - exactly what a hook is for.

export interface EditionPublishPayload {
  status?: string | null
}

export interface EditionPublishContext {
  audio_url: string | null
}

export class UnresolvedEditionError extends Error {
  constructor() {
    super('Eine Sendung ohne aufgeloestes Audio kann nicht veroeffentlicht werden.')
    this.name = 'UnresolvedEditionError'
  }
}

export function assertPublishable(payload: EditionPublishPayload, current: EditionPublishContext): void {
  if (payload.status === 'published' && current.audio_url === null) {
    throw new UnresolvedEditionError()
  }
}
