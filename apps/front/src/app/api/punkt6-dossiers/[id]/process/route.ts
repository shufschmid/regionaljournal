import { proxyToDirectus, problem } from '@/lib/proxy.server'

// POST /api/punkt6-dossiers/:id/process
//
// Calls the `punkt6-dossier-process` endpoint of the Directus extension bundle.
// The PDF parsing, telebasel.ch resolution and Claude lead generation all happen
// there - this route only carries the request across, with the signed-in user's
// token. Same shape as api/dossiers/[id]/process/route.ts.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  if (!/^[0-9a-f-]{36}$/i.test(id)) return problem(400, 'Ungueltige Dossier-ID.')

  return proxyToDirectus(`/punkt6-dossier-process/${id}`, { method: 'POST' })
}
