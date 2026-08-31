'use client'

import { useState } from 'react'
import { useMutation, useQuery } from '@apollo/client/react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import {
  PUNKT6_EDITIONS_QUERY,
  UPDATE_PUNKT6_EDITION_STATUS_MUTATION,
  type Punkt6EditionsQueryResult,
  type UpdatePunkt6EditionStatusResult
} from '@/graphql/punkt6-editions'
import { LIVE_FETCH_POLICY } from '@/lib/apollo'
import { Punkt6EditionCard } from './Punkt6EditionCard'

// The one component that fetches punkt6_editions. Publishing/withdrawing is a
// plain GraphQL mutation on `status` - mirrors EditionsPanel.
export function Punkt6EditionsPanel() {
  const { data, loading, error, refetch } = useQuery<Punkt6EditionsQueryResult>(PUNKT6_EDITIONS_QUERY, {
    fetchPolicy: LIVE_FETCH_POLICY
  })
  const [updateStatus] = useMutation<UpdatePunkt6EditionStatusResult>(UPDATE_PUNKT6_EDITION_STATUS_MUTATION)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  async function handleStatusChange(id: string, status: string) {
    setProblem(null)
    setBusyId(id)
    try {
      await updateStatus({ variables: { id, status } })
      await refetch()
    } catch (cause) {
      setProblem(messageOf(cause, 'Der Status konnte nicht geändert werden.'))
    } finally {
      setBusyId(null)
    }
  }

  const editions = data?.punkt6_editions ?? []

  return (
    <Stack spacing={2}>
      {problem !== null && (
        <Alert severity="error" onClose={() => setProblem(null)}>
          {problem}
        </Alert>
      )}

      {error !== undefined && (
        <Alert severity="error">Beiträge konnten nicht geladen werden: {error.message}</Alert>
      )}

      {loading && editions.length === 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {!loading && editions.length === 0 && error === undefined && (
        <Typography color="text.secondary">Noch keine Beiträge.</Typography>
      )}

      {editions.map((edition) => (
        <Punkt6EditionCard
          key={edition.id}
          edition={edition}
          busy={busyId === edition.id}
          onStatusChange={handleStatusChange}
        />
      ))}
    </Stack>
  )
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message !== '' ? cause.message : fallback
}
