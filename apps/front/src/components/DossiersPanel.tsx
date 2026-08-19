'use client'

import { useState } from 'react'
import { useApolloClient, useQuery } from '@apollo/client/react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { DOSSIERS_QUERY, type DossiersQueryResult } from '@/graphql/dossiers'
import { EDITIONS_QUERY } from '@/graphql/editions'
import { LIVE_FETCH_POLICY } from '@/lib/apollo'
import { statusLabel } from '@/lib/status'

// The concrete UI for "manually trigger dossier-process without waiting for the
// scheduled Flow". Not a GraphQL mutation - processing is server-side logic
// (PDF parsing, SRGSSR, Claude), so it goes through a route handler that proxies
// to the dossier-process extension endpoint, per the security model.
//
// Only shows dossiers that aren't fully processed yet, and hides itself
// entirely once there's nothing left to review.
export function DossiersPanel() {
  const client = useApolloClient()
  const { data, loading, error, refetch } = useQuery<DossiersQueryResult>(DOSSIERS_QUERY, {
    fetchPolicy: LIVE_FETCH_POLICY
  })
  const [busyId, setBusyId] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  async function handleProcess(id: string) {
    setProblem(null)
    setBusyId(id)
    try {
      const response = await fetch(`/api/dossiers/${id}/process`, { method: 'POST' })

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { errors?: { message?: string }[] } | null
        throw new Error(payload?.errors?.[0]?.message ?? `Fehler ${response.status}`)
      }

      await refetch()
      // Processing may have created/updated editions - EditionsPanel has its
      // own query, so refresh it too rather than leaving stale data on screen.
      await client.refetchQueries({ include: [EDITIONS_QUERY] })
    } catch (cause) {
      setProblem(messageOf(cause, 'Die Verarbeitung konnte nicht gestartet werden.'))
    } finally {
      setBusyId(null)
    }
  }

  const dossiers = data?.dossiers ?? []

  if (!loading && dossiers.length === 0 && error === undefined) return null // nothing to review - keep the UI quiet

  return (
    <Stack spacing={1.5}>
      <Typography variant="h2">Dossiers</Typography>

      {problem !== null && (
        <Alert severity="error" onClose={() => setProblem(null)}>
          {problem}
        </Alert>
      )}
      {error !== undefined && <Alert severity="error">Dossiers konnten nicht geladen werden: {error.message}</Alert>}
      {loading && dossiers.length === 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {dossiers.map((dossier) => (
        <Stack
          key={dossier.id}
          direction="row"
          spacing={1.5}
          sx={{ alignItems: 'center', border: 1, borderColor: 'divider', borderRadius: 2, p: 1.5 }}
        >
          <Chip label={statusLabel(dossier.status)} size="small" color={dossier.status === 'failed' ? 'error' : 'default'} />
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="body2">{dossier.source_subject ?? '(ohne Betreff)'}</Typography>
            {dossier.error_message !== null && (
              <Typography variant="body2" color="error">
                {dossier.error_message}
              </Typography>
            )}
          </Box>
          <Button size="small" disabled={busyId === dossier.id} onClick={() => handleProcess(dossier.id)}>
            Jetzt verarbeiten
          </Button>
        </Stack>
      ))}
    </Stack>
  )
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message !== '' ? cause.message : fallback
}
