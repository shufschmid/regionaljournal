import type { Knex } from 'knex'

/**
 * Bootstraps the `dossiers` collection on a fresh install.
 *
 * A `dossiers` row is created either by a human uploading a PDF through the admin
 * UI (status stays 'pending' until set) or by the dossiers-ingest-imap operation
 * fetching one from a mailbox. Either way it decouples "how did the PDF get here"
 * from "processing it into editions" (dossiers-process-pending / dossier-process
 * turn a pending dossier into one or more `editions` rows).
 *
 * See apps/directus/CLAUDE.md for why a migration (not admin-UI + schema:dump)
 * owns this collection, and why creating the table alone is not enough — the
 * directus_collections/directus_fields rows are what make it visible/editable in
 * the admin UI.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('dossiers', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    table.string('status', 32).notNullable().defaultTo('pending')
    table
      .uuid('source_file')
      .notNullable()
      .references('id')
      .inTable('directus_files')
    table.string('source_message_id', 512)
    table.string('source_subject', 512)
    table.text('error_message')
    table.timestamp('processed_at', { useTz: true })
    table.timestamp('date_created', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('date_updated', { useTz: true })
  })

  await knex('directus_collections').insert({
    collection: 'dossiers',
    icon: 'mail',
    note: 'Eingegangene Dossier-PDFs (manuell hochgeladen oder per Mailbox abgeholt) und ihr Verarbeitungsstatus.',
    display_template: '{{ source_subject }}',
    sort_field: null,
    archive_field: null,
    accountability: 'all',
    singleton: false,
    hidden: false,
    collapse: 'open',
    versioning: false
  })

  await knex('directus_fields').insert([
    {
      collection: 'dossiers',
      field: 'id',
      special: 'uuid',
      interface: 'input',
      readonly: true,
      hidden: true,
      sort: 1,
      width: 'full'
    },
    {
      collection: 'dossiers',
      field: 'status',
      interface: 'select-dropdown',
      options: JSON.stringify({
        choices: [
          { text: 'Ausstehend', value: 'pending' },
          { text: 'In Verarbeitung', value: 'processing' },
          { text: 'Verarbeitet', value: 'processed' },
          { text: 'Fehlgeschlagen', value: 'failed' }
        ]
      }),
      display: 'labels',
      display_options: JSON.stringify({
        showAsDot: true,
        choices: [
          { text: 'Ausstehend', value: 'pending', foreground: '#FFFFFF', background: '#A2B5CD' },
          { text: 'In Verarbeitung', value: 'processing', foreground: '#FFFFFF', background: '#3399FF' },
          { text: 'Verarbeitet', value: 'processed', foreground: '#FFFFFF', background: '#2ECDA7' },
          { text: 'Fehlgeschlagen', value: 'failed', foreground: '#FFFFFF', background: '#E35169' }
        ]
      }),
      sort: 2,
      width: 'full'
    },
    {
      collection: 'dossiers',
      field: 'source_file',
      special: 'file',
      interface: 'file',
      required: true,
      sort: 3,
      width: 'full'
    },
    {
      collection: 'dossiers',
      field: 'source_message_id',
      interface: 'input',
      readonly: true,
      hidden: true,
      sort: 4,
      width: 'half'
    },
    {
      collection: 'dossiers',
      field: 'source_subject',
      interface: 'input',
      readonly: true,
      sort: 5,
      width: 'half'
    },
    {
      collection: 'dossiers',
      field: 'error_message',
      interface: 'input-multiline',
      note: 'Vom letzten fehlgeschlagenen Verarbeitungslauf.',
      readonly: true,
      sort: 6,
      width: 'full'
    },
    {
      collection: 'dossiers',
      field: 'processed_at',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      readonly: true,
      sort: 7,
      width: 'half'
    },
    {
      collection: 'dossiers',
      field: 'date_created',
      special: 'date-created',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      readonly: true,
      hidden: true,
      sort: 8,
      width: 'half'
    },
    {
      collection: 'dossiers',
      field: 'date_updated',
      special: 'date-updated',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      readonly: true,
      hidden: true,
      sort: 9,
      width: 'half'
    }
  ])

  // Standard Directus M2O relation metadata for the file field — without this row
  // the field still works as a plain uuid at the DB level, but the admin UI won't
  // render the file-picker interface correctly or know which collection it points to.
  await knex('directus_relations').insert({
    many_collection: 'dossiers',
    many_field: 'source_file',
    one_collection: 'directus_files',
    one_deselect_action: 'nullify'
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex('directus_relations')
    .where({ many_collection: 'dossiers', many_field: 'source_file' })
    .delete()
  await knex('directus_fields').where({ collection: 'dossiers' }).delete()
  await knex('directus_collections').where({ collection: 'dossiers' }).delete()
  await knex.schema.dropTableIfExists('dossiers')
}
