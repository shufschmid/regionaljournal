import { fireEvent, render, screen } from '@testing-library/react'
import type { EditionFields } from '@/graphql/editions'
import { EditionCard } from './EditionCard'

function edition(overrides: Partial<EditionFields> = {}): EditionFields {
  return {
    id: 'e1',
    status: 'draft',
    broadcast_date: '2026-08-17',
    edition_label: 'Mittag',
    broadcast_at: '2026-08-17T12:03:00+02:00',
    headline: 'Ziefen wehrt sich gegen Bachem-Parkplatz',
    lead: 'Der Pharmazulieferer Bachem wollte in Ziefen einen Parkplatz bauen.',
    teaser_blocks: null,
    audio_url: 'https://example.com/a.mp3',
    transcript: [
      { timestamp: '00:00:00', seconds: 0, text: 'Erster Absatz.' },
      { timestamp: '00:00:39', seconds: 39, text: 'Zweiter Absatz.' }
    ],
    extra_topics: [
      { headline: 'Matched Topic', paragraphTimestamp: '00:05:23', paragraphSeconds: 323, summary: 'Kurze Zusammenfassung.' },
      { headline: 'Unmatched Topic', paragraphTimestamp: null, paragraphSeconds: null, summary: null }
    ],
    ...overrides
  }
}

beforeAll(() => {
  window.HTMLMediaElement.prototype.play = jest.fn().mockResolvedValue(undefined)
})

describe('EditionCard', () => {
  it('renders headline, date and edition chip', () => {
    render(<EditionCard edition={edition()} busy={false} onStatusChange={jest.fn()} />)

    expect(screen.getByText('Ziefen wehrt sich gegen Bachem-Parkplatz')).toBeInTheDocument()
    expect(screen.getByText('17.08.2026')).toBeInTheDocument()
    expect(screen.getByText('Mittag')).toBeInTheDocument()
  })

  it('seeks and plays the audio element when the lead listen-link is clicked', () => {
    render(<EditionCard edition={edition()} busy={false} onStatusChange={jest.fn()} />)

    const audio = document.querySelector('audio') as HTMLAudioElement
    fireEvent.click(screen.getAllByRole('button', { name: /beitrag anhören/i })[0]!)

    expect(audio.currentTime).toBe(0)
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled()
  })

  it('renders a listen link only for a matched extra topic', () => {
    render(<EditionCard edition={edition()} busy={false} onStatusChange={jest.fn()} />)

    expect(screen.getByText('Matched Topic')).toBeInTheDocument()
    expect(screen.getByText('Unmatched Topic')).toBeInTheDocument()
    // exactly two listen-links total: the lead's, plus the one matched topic's
    expect(screen.getAllByRole('button', { name: /beitrag anhören/i })).toHaveLength(2)
  })

  it('expands the transcript and seeks on a timestamp click', () => {
    render(<EditionCard edition={edition()} busy={false} onStatusChange={jest.fn()} />)

    fireEvent.click(screen.getByText('Transkript der ganzen Sendung'))
    fireEvent.click(screen.getByText('00:00:39'))

    const audio = document.querySelector('audio') as HTMLAudioElement
    expect(audio.currentTime).toBe(39)
  })

  it('shows the unresolved message and disables publishing when there is no audio', () => {
    render(<EditionCard edition={edition({ audio_url: null, transcript: null })} busy={false} onStatusChange={jest.fn()} />)

    expect(screen.getByText('Audio konnte nicht aufgelöst werden.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Veröffentlichen' })).toBeDisabled()
  })

  it('calls onStatusChange with the toggled status', () => {
    const onStatusChange = jest.fn()
    render(<EditionCard edition={edition({ status: 'draft' })} busy={false} onStatusChange={onStatusChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Veröffentlichen' }))
    expect(onStatusChange).toHaveBeenCalledWith('e1', 'published')
  })

  it('offers to withdraw a published edition instead of publishing it again', () => {
    render(<EditionCard edition={edition({ status: 'published' })} busy={false} onStatusChange={jest.fn()} />)
    expect(screen.getByRole('button', { name: 'Zurückziehen' })).toBeInTheDocument()
  })
})
