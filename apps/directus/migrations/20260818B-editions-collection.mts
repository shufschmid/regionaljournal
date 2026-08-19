import type { Knex } from 'knex'

/**
 * Bootstraps the `editions` collection. Depends on `dossiers` already existing
 * (FK `editions.dossier -> dossiers.id`), hence the B suffix running after A.
 *
 * One dossier PDF can contain segments from more than one broadcast (the real
 * sample dossiers do: a single PDF held a Mittag story from one day and a Morgen
 * story from another) — so this is a plain one-to-many, not one edition per dossier.
 *
 * `teaser_blocks` / `transcript` / `extra_topics` are `cast-json` text columns
 * (Directus/GraphQL then expose them as structured data, not a string to
 * re-parse) — mirrors the notes example's `cast-csv` on `ai_summary_tags`, just
 * for nested data rather than a flat list. `teaser_blocks` specifically is NOT
 * cast-csv: teaser sentences are free prose that can contain commas, and cast-csv
 * would corrupt on the first one.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('editions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    table.string('status', 32).notNullable().defaultTo('draft')
    table.uuid('dossier').notNullable().references('id').inTable('dossiers')
    table.date('broadcast_date').notNullable()
    table.string('edition_label', 16)
    table.timestamp('broadcast_at', { useTz: true })
    table.string('headline', 512).notNullable()
    table.text('lead')
    table.text('teaser_blocks')
    table.string('audio_url', 2048)
    table.string('srgssr_urn', 255)
    table.text('transcript')
    table.text('extra_topics')
    table.text('resolution_error')
    table.timestamp('date_created', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('date_updated', { useTz: true })
  })

  await knex('directus_collections').insert({
    collection: 'editions',
    icon: 'radio',
    note: 'Aus einem Dossier aufgelöste Sendungen (Morgen/Mittag/Abend) mit Audio, Transkript und Themen-Zusammenfassungen.',
    display_template: '{{ headline }}',
    sort_field: null,
    archive_field: 'status',
    archive_value: 'archived',
    unarchive_value: 'draft',
    archive_app_filter: true,
    accountability: 'all',
    singleton: false,
    hidden: false,
    collapse: 'open',
    versioning: false
  })

  await knex('directus_fields').insert([
    {
      collection: 'editions',
      field: 'id',
      special: 'uuid',
      interface: 'input',
      readonly: true,
      hidden: true,
      sort: 1,
      width: 'full'
    },
    {
      collection: 'editions',
      field: 'status',
      interface: 'select-dropdown',
      options: JSON.stringify({
        choices: [
          { text: 'Entwurf', value: 'draft' },
          { text: 'Veroeffentlicht', value: 'published' },
          { text: 'Archiviert', value: 'archived' }
        ]
      }),
      display: 'labels',
      display_options: JSON.stringify({
        showAsDot: true,
        choices: [
          { text: 'Entwurf', value: 'draft', foreground: '#FFFFFF', background: '#A2B5CD' },
          { text: 'Veroeffentlicht', value: 'published', foreground: '#FFFFFF', background: '#2ECDA7' },
          { text: 'Archiviert', value: 'archived', foreground: '#FFFFFF', background: '#A2B5CD' }
        ]
      }),
      sort: 2,
      width: 'full'
    },
    {
      collection: 'editions',
      field: 'dossier',
      interface: 'select-dropdown-m2o',
      display: 'related-values',
      display_options: JSON.stringify({ template: '{{ source_subject }}' }),
      required: true,
      sort: 3,
      width: 'full'
    },
    {
      collection: 'editions',
      field: 'broadcast_date',
      interface: 'datetime',
      display: 'datetime',
      required: true,
      sort: 4,
      width: 'half'
    },
    {
      collection: 'editions',
      field: 'edition_label',
      interface: 'select-dropdown',
      options: JSON.stringify({
        choices: [
          { text: 'Morgen', value: 'Morgen' },
          { text: 'Mittag', value: 'Mittag' },
          { text: 'Abend', value: 'Abend' }
        ]
      }),
      readonly: true,
      sort: 5,
      width: 'half'
    },
    {
      collection: 'editions',
      field: 'broadcast_at',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      readonly: true,
      sort: 6,
      width: 'half'
    },
    {
      collection: 'editions',
      field: 'headline',
      interface: 'input',
      note: 'Aus dem PDF uebernommen. Leichte redaktionelle Korrektur vor Veroeffentlichung moeglich.',
      required: true,
      sort: 7,
      width: 'full'
    },
    {
      collection: 'editions',
      field: 'lead',
      interface: 'input-multiline',
      sort: 8,
      width: 'full'
    },
    {
      collection: 'editions',
      field: 'teaser_blocks',
      special: 'cast-json',
      interface: 'list',
      readonly: true,
      sort: 9,
      width: 'full'
    },
    {
      collection: 'editions',
      field: 'audio_url',
      interface: 'input',
      readonly: true,
      sort: 10,
      width: 'full'
    },
    {
      collection: 'editions',
      field: 'srgssr_urn',
      interface: 'input',
      readonly: true,
      hidden: true,
      sort: 11,
      width: 'half'
    },
    {
      collection: 'editions',
      field: 'transcript',
      special: 'cast-json',
      interface: 'input-code',
      options: JSON.stringify({ language: 'json' }),
      note: 'Absatzweise Transkription mit Timecodes. Von der Verarbeitung geschrieben.',
      readonly: true,
      sort: 12,
      width: 'full'
    },
    {
      collection: 'editions',
      field: 'extra_topics',
      special: 'cast-json',
      interface: 'input-code',
      options: JSON.stringify({ language: 'json' }),
      note: 'Von Claude zugeordnete "Ausserdem"-Themen mit Timecode und Zusammenfassung.',
      readonly: true,
      sort: 13,
      width: 'full'
    },
    {
      collection: 'editions',
      field: 'resolution_error',
      interface: 'input-multiline',
      note: 'Gesetzt, wenn die Audio-Aufloesung fuer dieses Segment fehlgeschlagen ist.',
      readonly: true,
      sort: 14,
      width: 'full'
    },
    {
      collection: 'editions',
      field: 'date_created',
      special: 'date-created',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      readonly: true,
      hidden: true,
      sort: 15,
      width: 'half'
    },
    {
      collection: 'editions',
      field: 'date_updated',
      special: 'date-updated',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      readonly: true,
      hidden: true,
      sort: 16,
      width: 'half'
    }
  ])

  await knex('directus_relations').insert({
    many_collection: 'editions',
    many_field: 'dossier',
    one_collection: 'dossiers',
    one_deselect_action: 'nullify'
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex('directus_relations')
    .where({ many_collection: 'editions', many_field: 'dossier' })
    .delete()
  await knex('directus_fields').where({ collection: 'editions' }).delete()
  await knex('directus_collections').where({ collection: 'editions' }).delete()
  await knex.schema.dropTableIfExists('editions')
}
