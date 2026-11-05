export type EventAlertRecord = {
  id: string
  title: string
  body: string
  event_type: string
  created_at: string
  dismissed_at: string | null
}

export function getPendingEventAlerts(events: EventAlertRecord[]): EventAlertRecord[] {
  return events
    .filter((event) => event.dismissed_at === null)
    .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id))
}

export function getEventAlertMigrationHint(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const record = error as Record<string, unknown>
  const code = typeof record.code === 'string' ? record.code : ''
  const message = error instanceof Error ? error.message : ''
  const details = typeof record.details === 'string' ? record.details : ''
  const hint = typeof record.hint === 'string' ? record.hint : ''
  if (code === '42703' || code === 'PGRST204' || /dismissed_at/i.test(`${message} ${details} ${hint}`)) {
    return 'O banco ainda não tem a migration 013 de fechamento individual de alertas. No Supabase, abra SQL Editor e execute uma vez o arquivo supabase/migrations/202611050013_individual_event_alert_dismissal.sql; depois tente sincronizar novamente.'
  }
  return null
}
