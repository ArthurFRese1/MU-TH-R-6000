type DiagnosticField = string | number | null

export type DevelopmentDiagnostic = {
  operation: string
  code: DiagnosticField
  message: DiagnosticField
  details: DiagnosticField
  hint: DiagnosticField
  status: DiagnosticField
}

function stripControlCharacters(value: string) {
  return Array.from(value).filter((character) => {
    const code = character.charCodeAt(0)
    return code >= 32 && code !== 127
  }).join('')
}

function safeField(value: unknown): DiagnosticField {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  return stripControlCharacters(value)
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/sb_(?:publishable|secret)_[A-Za-z0-9_-]+/g, '[redacted Supabase key]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted token]')
    .slice(0, 1000)
}

export function toDevelopmentDiagnostic(operation: string, error: unknown): DevelopmentDiagnostic {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  return {
    operation: stripControlCharacters(operation).slice(0, 1000),
    code: safeField(record.code),
    message: safeField(record.message ?? error),
    details: safeField(record.details),
    hint: safeField(record.hint),
    status: safeField(record.status),
  }
}

export function reportDevelopmentError(operation: string, error: unknown): void {
  if (!import.meta.env.DEV) return
  const diagnostic = toDevelopmentDiagnostic(operation, error)
  void fetch('/__dev/diagnostics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(diagnostic),
  }).catch(() => {
    console.error(`[MU/TH/R diagnóstico] ${diagnostic.operation}`, diagnostic)
  })
}
