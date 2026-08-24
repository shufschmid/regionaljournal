import { proxyToDirectus, problem } from '@/lib/proxy.server'

// POST /api/dossiers/:id/process
//
// Calls the `dossier-process` endpoint of the Directus extension bundle. The PDF
// parsing, SRGSSR resolution and Claude topic extraction all happen there - this
// route only carries the request across, with the signed-in user's token. Same
// shape as api/notes/[id]/summary/route.ts.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  if (!/^[0-9a-f-]{36}$/i.test(id)) return problem(400, 'Ungueltige Dossier-ID.')

  return proxyToDirectus(`/dossier-process/${id}`, { method: 'POST' })
}
