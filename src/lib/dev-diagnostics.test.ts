import { describe, expect, it } from 'vitest'
import { toDevelopmentDiagnostic } from './dev-diagnostics'

describe('toDevelopmentDiagnostic', () => {
  it('keeps only safe PostgREST diagnostic fields', () => {
    const diagnostic = toDevelopmentDiagnostic('Join invite', {
      code: 'PGRST202',
      message: 'RPC function not found',
      details: null,
      hint: 'Check the migration',
      status: 404,
      token: 'must not be included',
      headers: { authorization: 'Bearer secret' },
    })

    expect(diagnostic).toEqual({
      operation: 'Join invite',
      code: 'PGRST202',
      message: 'RPC function not found',
      details: null,
      hint: 'Check the migration',
      status: 404,
    })
  })

  it('redacts credentials, JWTs, and terminal control characters', () => {
    const diagnostic = toDevelopmentDiagnostic('Join\u001b[31m', {
      code: '400',
      message: 'Bearer abc sb_secret_sensitive eyJabc.eyJdef.signature',
      details: null,
      hint: null,
      status: 400,
    })

    expect(diagnostic.operation).not.toContain('\u001b')
    expect(diagnostic.message).not.toContain('abc')
    expect(diagnostic.message).not.toContain('sb_secret_sensitive')
    expect(diagnostic.message).not.toContain('eyJabc')
    expect(diagnostic.message).toContain('[redacted')
  })

  it('limits field lengths and ignores unsupported values', () => {
    const diagnostic = toDevelopmentDiagnostic('Join', {
      code: { invalid: true },
      message: 'x'.repeat(1200),
      details: undefined,
      hint: null,
      status: Number.NaN,
    })

    expect(diagnostic.code).toBeNull()
    expect(diagnostic.message).toHaveLength(1000)
    expect(diagnostic.details).toBeNull()
    expect(diagnostic.status).toBeNull()
  })
})
