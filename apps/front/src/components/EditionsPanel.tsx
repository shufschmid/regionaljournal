'use client'

import { useState } from 'react'
import { useMutation, useQuery } from '@apollo/client/react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import {
  EDITIONS_QUERY,
  UPDATE_EDITION_STATUS_MUTATION,
  type EditionsQueryResult,
  type UpdateEditionStatusResult
} from '@/graphql/editions'
import { LIVE_FETCH_POLICY } from '@/lib/apollo'
import { EditionCard } from './EditionCard'

// The one component that fetches editions. Publishing/withdrawing is a plain
// GraphQL mutation on `status` - no custom endpoint needed, same as the
// notes example's status field.
export function EditionsPanel() {
  const { data, loading, error, refetch } = useQuery<EditionsQueryResult>(EDITIONS_QUERY, {
    fetchPolicy: LIVE_FETCH_POLICY
  })
  const [updateStatus] = useMutation<UpdateEditionStatusResult>(UPDATE_EDITION_STATUS_MUTATION)
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

  const editions = data?.editions ?? []

  return (
    <Stack spacing={2}>
      {problem !== null && (
        <Alert severity="error" onClose={() => setProblem(null)}>
          {problem}
        </Alert>
      )}

      {error !== undefined && <Alert severity="error">Sendungen konnten nicht geladen werden: {error.message}</Alert>}

      {loading && editions.length === 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {!loading && editions.length === 0 && error === undefined && (
        <Typography color="text.secondary">Noch keine Sendungen.</Typography>
      )}

      {editions.map((edition) => (
        <EditionCard key={edition.id} edition={edition} busy={busyId === edition.id} onStatusChange={handleStatusChange} />
      ))}
    </Stack>
  )
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message !== '' ? cause.message : fallback
}
