import { MockedProvider } from '@apollo/client/testing/react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DOSSIERS_QUERY } from '@/graphql/dossiers'
import { DossiersPanel } from './DossiersPanel'

const PENDING_DOSSIER = {
  __typename: 'dossiers',
  id: 'd1',
  status: 'pending',
  source_subject: 'Dossier vom 17.08.2026',
  error_message: null,
  date_created: '2026-08-17T06:00:00Z'
}

const FAILED_DOSSIER = {
  __typename: 'dossiers',
  id: 'd2',
  status: 'failed',
  source_subject: 'Dossier vom 16.08.2026',
  error_message: 'SRGSSR-Anfrage fehlgeschlagen.',
  date_created: '2026-08-16T06:00:00Z'
}

function mockDossiersQuery(dossiers: unknown[], times = 1) {
  return Array.from({ length: times }, () => ({
    request: { query: DOSSIERS_QUERY, variables: { limit: 25 } },
    result: { data: { dossiers } }
  }))
}

describe('DossiersPanel', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    Reflect.deleteProperty(global, 'fetch')
  })

  it('renders pending and failed dossiers with their status and error message', async () => {
    render(
      <MockedProvider mocks={mockDossiersQuery([PENDING_DOSSIER, FAILED_DOSSIER])}>
        <DossiersPanel />
      </MockedProvider>
    )

    expect(await screen.findByText('Dossier vom 17.08.2026')).toBeInTheDocument()
    expect(screen.getByText('Dossier vom 16.08.2026')).toBeInTheDocument()
    expect(screen.getByText('SRGSSR-Anfrage fehlgeschlagen.')).toBeInTheDocument()
    expect(screen.getByText('Ausstehend')).toBeInTheDocument()
    expect(screen.getByText('Fehlgeschlagen')).toBeInTheDocument()
  })

  it('renders nothing once loading finishes with no dossiers to review', async () => {
    const { container } = render(
      <MockedProvider mocks={mockDossiersQuery([])}>
        <DossiersPanel />
      </MockedProvider>
    )

    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('triggers processing via the route handler when "Jetzt verarbeiten" is clicked', async () => {
    const fetchSpy = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: {} }) })
    global.fetch = fetchSpy as unknown as typeof fetch
    const user = userEvent.setup()

    render(
      <MockedProvider mocks={mockDossiersQuery([PENDING_DOSSIER], 2)}>
        <DossiersPanel />
      </MockedProvider>
    )

    await user.click(await screen.findByRole('button', { name: 'Jetzt verarbeiten' }))

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/api/dossiers/d1/process', { method: 'POST' }))
  })

  it('shows an error when triggering processing fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ errors: [{ message: 'Serverfehler.' }] })
    }) as unknown as typeof fetch
    const user = userEvent.setup()

    render(
      <MockedProvider mocks={mockDossiersQuery([PENDING_DOSSIER])}>
        <DossiersPanel />
      </MockedProvider>
    )

    await user.click(await screen.findByRole('button', { name: 'Jetzt verarbeiten' }))

    expect(await screen.findByText('Serverfehler.')).toBeInTheDocument()
  })
})
