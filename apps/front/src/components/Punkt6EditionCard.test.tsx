import { fireEvent, render, screen } from '@testing-library/react'
import type { Punkt6EditionFields } from '@/graphql/punkt6-editions'
import { Punkt6EditionCard } from './Punkt6EditionCard'

function edition(overrides: Partial<Punkt6EditionFields> = {}): Punkt6EditionFields {
  return {
    id: 'e1',
    status: 'draft',
    broadcast_date: '2026-08-25',
    headline: 'Polizei geht gegen «Death to Zionism»-Demo vor',
    lead: 'Die Basler Kantonspolizei beurteilt die angekuendigte Demo als nicht bewilligungsfaehig.',
    transcript: [
      { timestamp: '00:00:49', seconds: 49, text: 'Erster Absatz.' },
      { timestamp: '00:01:11', seconds: 71, text: 'Zweiter Absatz.' }
    ],
    main_start_seconds: 49,
    main_end_seconds: 126,
    extra_topics: [
      {
        headline: 'Metrobasel diskutiert Wettbewerbsfähigkeit',
        summary: 'Kurze Zusammenfassung.',
        startSeconds: 126,
        endSeconds: 313
      }
    ],
    video_url: 'https://simplex-cdn-media.akamaized.net/content/4062/4063/239377/index.m3u8',
    episode_url: 'https://telebasel.ch/sendungen/punkt6/239377',
    ...overrides
  }
}

beforeAll(() => {
  window.HTMLMediaElement.prototype.play = jest.fn().mockResolvedValue(undefined)
})

describe('Punkt6EditionCard', () => {
  it('renders headline and formatted broadcast date', () => {
    render(<Punkt6EditionCard edition={edition()} busy={false} onStatusChange={jest.fn()} />)

    expect(screen.getByText('Polizei geht gegen «Death to Zionism»-Demo vor')).toBeInTheDocument()
    expect(screen.getByText('25.08.2026')).toBeInTheDocument()
  })

  it('seeks and plays the video element at the Hauptbeitrag start when the lead listen-link is clicked', () => {
    render(<Punkt6EditionCard edition={edition()} busy={false} onStatusChange={jest.fn()} />)

    const video = document.querySelector('video') as HTMLVideoElement
    fireEvent.click(screen.getAllByRole('button', { name: /beitrag ansehen/i })[0]!)

    expect(video.currentTime).toBe(49)
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled()
  })

  it('renders every extra topic with its own seek link', () => {
    render(<Punkt6EditionCard edition={edition()} busy={false} onStatusChange={jest.fn()} />)

    expect(screen.getByText('Metrobasel diskutiert Wettbewerbsfähigkeit')).toBeInTheDocument()
    expect(screen.getByText('Kurze Zusammenfassung.')).toBeInTheDocument()
    // one listen-link for the lead, one for the single extra topic
    expect(screen.getAllByRole('button', { name: /beitrag ansehen/i })).toHaveLength(2)

    const video = document.querySelector('video') as HTMLVideoElement
    fireEvent.click(screen.getAllByRole('button', { name: /beitrag ansehen/i })[1]!)
    expect(video.currentTime).toBe(126)
  })

  it('expands the transcript and seeks on a timestamp click', () => {
    render(<Punkt6EditionCard edition={edition()} busy={false} onStatusChange={jest.fn()} />)

    fireEvent.click(screen.getByText('Transkript der ganzen Sendung'))
    fireEvent.click(screen.getByText('00:01:11'))

    const video = document.querySelector('video') as HTMLVideoElement
    expect(video.currentTime).toBe(71)
  })

  it('shows the unresolved message and disables publishing when there is no video', () => {
    render(
      <Punkt6EditionCard
        edition={edition({ video_url: null, transcript: null })}
        busy={false}
        onStatusChange={jest.fn()}
      />
    )

    expect(screen.getByText('Video konnte nicht aufgelöst werden.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Veröffentlichen' })).toBeDisabled()
  })

  it('links to the original episode on telebasel.ch', () => {
    render(<Punkt6EditionCard edition={edition()} busy={false} onStatusChange={jest.fn()} />)

    const link = screen.getByRole('link', { name: 'Ganze Sendung auf telebasel.ch' })
    expect(link).toHaveAttribute('href', 'https://telebasel.ch/sendungen/punkt6/239377')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('calls onStatusChange with the toggled status', () => {
    const onStatusChange = jest.fn()
    render(
      <Punkt6EditionCard
        edition={edition({ status: 'draft' })}
        busy={false}
        onStatusChange={onStatusChange}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Veröffentlichen' }))
    expect(onStatusChange).toHaveBeenCalledWith('e1', 'published')
  })

  it('offers to withdraw a published edition instead of publishing it again', () => {
    render(
      <Punkt6EditionCard edition={edition({ status: 'published' })} busy={false} onStatusChange={jest.fn()} />
    )
    expect(screen.getByRole('button', { name: 'Zurückziehen' })).toBeInTheDocument()
  })
})
