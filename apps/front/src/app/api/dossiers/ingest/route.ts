import { proxyToDirectus } from '@/lib/proxy.server'

// POST /api/dossiers/ingest
//
// Calls the `dossiers-ingest` endpoint of the Directus extension bundle - checks
// the mailbox for new dossier PDFs and creates `dossiers` rows (status='pending')
// for them, without waiting for the scheduled Flow. Does not process them; the
// frontend triggers dossier-process per dossier afterwards, same as any other
// pending dossier. Same shape as api/dossiers/[id]/process/route.ts.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { limit?: unknown }
  const limit = typeof body.limit === 'number' ? body.limit : 5

  return proxyToDirectus('/dossiers-ingest', { method: 'POST', body: JSON.stringify({ limit }) })
}
