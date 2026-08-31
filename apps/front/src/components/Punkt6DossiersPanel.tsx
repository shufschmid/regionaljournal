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
import { PUNKT6_DOSSIERS_QUERY, type Punkt6DossiersQueryResult } from '@/graphql/punkt6-dossiers'
import { PUNKT6_EDITIONS_QUERY } from '@/graphql/punkt6-editions'
import { LIVE_FETCH_POLICY } from '@/lib/apollo'
import { statusLabel } from '@/lib/status'

// The concrete UI for "manually trigger the Punkt6 mailbox check / dossier
// processing without waiting for the scheduled Flows" - mirrors DossiersPanel.
export function Punkt6DossiersPanel() {
  const client = useApolloClient()
  const { data, loading, error, refetch } = useQuery<Punkt6DossiersQueryResult>(PUNKT6_DOSSIERS_QUERY, {
    fetchPolicy: LIVE_FETCH_POLICY
  })
  const [busyId, setBusyId] = useState<string | null>(null)
  const [checkingMailbox, setCheckingMailbox] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [checkResult, setCheckResult] = useState<string | null>(null)

  async function handleCheckMailbox() {
    setProblem(null)
    setCheckResult(null)
    setCheckingMailbox(true)
    try {
      const response = await fetch('/api/punkt6-dossiers/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 5 })
      })

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          errors?: { message?: string }[]
        } | null
        throw new Error(payload?.errors?.[0]?.message ?? `Fehler ${response.status}`)
      }

      const payload = (await response.json()) as { data: { created: number } }
      setCheckResult(
        payload.data.created === 0
          ? 'Keine neuen Dossiers im Postfach gefunden.'
          : `${payload.data.created} neue${payload.data.created === 1 ? 's' : ''} Dossier${payload.data.created === 1 ? '' : 's'} gefunden.`
      )
      await refetch()
    } catch (cause) {
      setProblem(messageOf(cause, 'Das Postfach konnte nicht geprueft werden.'))
    } finally {
      setCheckingMailbox(false)
    }
  }

  async function handleProcess(id: string) {
    setProblem(null)
    setBusyId(id)
    try {
      const response = await fetch(`/api/punkt6-dossiers/${id}/process`, { method: 'POST' })

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          errors?: { message?: string }[]
        } | null
        throw new Error(payload?.errors?.[0]?.message ?? `Fehler ${response.status}`)
      }

      await refetch()
      // Processing may have created/updated editions - Punkt6EditionsPanel has
      // its own query, so refresh it too rather than leaving stale data on screen.
      await client.refetchQueries({ include: [PUNKT6_EDITIONS_QUERY] })
    } catch (cause) {
      setProblem(messageOf(cause, 'Die Verarbeitung konnte nicht gestartet werden.'))
    } finally {
      setBusyId(null)
    }
  }

  const dossiers = data?.punkt6_dossiers ?? []

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        <Typography variant="h2" sx={{ flexGrow: 1 }}>
          Punkt6-Dossiers
        </Typography>
        <Button size="small" variant="outlined" disabled={checkingMailbox} onClick={handleCheckMailbox}>
          {checkingMailbox ? 'Prüfe Postfach…' : 'Postfach jetzt prüfen'}
        </Button>
      </Stack>

      {checkResult !== null && (
        <Alert severity="info" onClose={() => setCheckResult(null)}>
          {checkResult}
        </Alert>
      )}
      {problem !== null && (
        <Alert severity="error" onClose={() => setProblem(null)}>
          {problem}
        </Alert>
      )}
      {error !== undefined && (
        <Alert severity="error">Dossiers konnten nicht geladen werden: {error.message}</Alert>
      )}
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
          <Chip
            label={statusLabel(dossier.status)}
            size="small"
            color={dossier.status === 'failed' ? 'error' : 'default'}
          />
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
