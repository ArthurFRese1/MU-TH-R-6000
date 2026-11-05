import { describe, expect, it } from 'vitest'
import { getEventAlertMigrationHint, getPendingEventAlerts, type EventAlertRecord } from './event-alerts'

function alert(id: string, createdAt: string, eventType: string, dismissedAt: string | null = null): EventAlertRecord {
  return {
    id,
    title: `Título ${id}`,
    body: `Conteúdo ${id}`,
    event_type: eventType,
    created_at: createdAt,
    dismissed_at: dismissedAt,
  }
}

describe('getPendingEventAlerts', () => {
  it('orders all supported event types in an individual oldest-first queue', () => {
    const events = [
      alert('third', '2026-11-05T12:00:02.000Z', 'custom'),
      alert('first', '2026-11-05T12:00:00.000Z', 'alert'),
      alert('second', '2026-11-05T12:00:01.000Z', 'urgent'),
      alert('terminal', '2026-11-05T12:00:03.000Z', 'terminal'),
      alert('failure', '2026-11-05T12:00:04.000Z', 'failure'),
      alert('incident', '2026-11-05T12:00:05.000Z', 'incident'),
    ]

    expect(getPendingEventAlerts(events).map((event) => event.id)).toEqual([
      'first', 'second', 'third', 'terminal', 'failure', 'incident',
    ])
    expect(events[0].id).toBe('third')
  })

  it('omits alerts dismissed by this recipient and leaves other alerts queued', () => {
    const events = [
      alert('closed', '2026-11-05T12:00:00.000Z', 'alert', '2026-11-05T12:00:01.000Z'),
      alert('open', '2026-11-05T12:00:02.000Z', 'urgent'),
    ]

    expect(getPendingEventAlerts(events).map((event) => event.id)).toEqual(['open'])
  })
})

describe('getEventAlertMigrationHint', () => {
  it('explains how to apply migration 013 when dismissed_at is missing', () => {
    expect(getEventAlertMigrationHint({
      code: 'PGRST204',
      message: "Could not find the 'dismissed_at' column of 'campaign_event_recipients' in the schema cache",
      details: '',
      hint: '',
    })).toContain('202611050013_individual_event_alert_dismissal.sql')
  })

  it('does not replace unrelated synchronization errors with a migration hint', () => {
    expect(getEventAlertMigrationHint(new Error('Network request failed'))).toBeNull()
  })
})
