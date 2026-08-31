import { gql } from '@apollo/client'

// GraphQL documents for the punkt6_editions collection - one row per Sendung
// (episode): a Hauptbeitrag (headline/lead) plus every other Beitrag as
// extra_topics, one shared video - mirrors graphql/editions.ts's
// story-plus-extra_topics shape.

export interface Punkt6TranscriptParagraph {
  timestamp: string
  seconds: number
  text: string
}

export interface Punkt6ExtraTopic {
  headline: string
  summary: string | null
  startSeconds: number
  endSeconds: number
}

export interface Punkt6EditionFields {
  id: string
  status: string
  broadcast_date: string
  headline: string
  lead: string | null
  transcript: Punkt6TranscriptParagraph[] | null
  main_start_seconds: number | null
  main_end_seconds: number | null
  extra_topics: Punkt6ExtraTopic[] | null
  video_url: string | null
  episode_url: string | null
}

export interface Punkt6EditionsQueryResult {
  punkt6_editions: Punkt6EditionFields[]
}

export const PUNKT6_EDITIONS_QUERY = gql`
  query Punkt6Editions($limit: Int = 50) {
    punkt6_editions(limit: $limit, sort: ["-broadcast_date"], filter: { status: { _neq: "archived" } }) {
      id
      status
      broadcast_date
      headline
      lead
      transcript
      main_start_seconds
      main_end_seconds
      extra_topics
      video_url
      episode_url
    }
  }
`

export interface UpdatePunkt6EditionStatusResult {
  update_punkt6_editions_item: { id: string } | null
}

export const UPDATE_PUNKT6_EDITION_STATUS_MUTATION = gql`
  mutation UpdatePunkt6EditionStatus($id: ID!, $status: String!) {
    update_punkt6_editions_item(id: $id, data: { status: $status }) {
      id
    }
  }
`
