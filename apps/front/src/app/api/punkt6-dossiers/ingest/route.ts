import { proxyToDirectus } from '@/lib/proxy.server'

// POST /api/punkt6-dossiers/ingest
//
// Calls the `punkt6-dossiers-ingest` endpoint of the Directus extension bundle -
// checks the mailbox for new Punkt6 dossier PDFs and creates `punkt6_dossiers`
// rows (status='pending') for them. Same shape as api/dossiers/ingest/route.ts.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { limit?: unknown }
  const limit = typeof body.limit === 'number' ? body.limit : 5

  return proxyToDirectus('/punkt6-dossiers-ingest', { method: 'POST', body: JSON.stringify({ limit }) })
}
