import { describe, expect, it } from 'vitest'
import {
  identityRecoveryErrorMessage,
  isRecoveryIdentityAlreadyMemberError,
  isValidRecoveryEmail,
} from './recovery'

describe('isValidRecoveryEmail', () => {
  it('accepts a Gmail-style participation identifier without treating it as authentication', () => {
    expect(isValidRecoveryEmail('arthur@gmail.com')).toBe(true)
    expect(isValidRecoveryEmail(' Arthur@GMAIL.COM ')).toBe(true)
  })

  it('rejects malformed or unsupported addresses', () => {
    expect(isValidRecoveryEmail('arthurgmail.com')).toBe(false)
    expect(isValidRecoveryEmail('arthur@other.com')).toBe(false)
    expect(isValidRecoveryEmail('arthur @gmail.com')).toBe(false)
  })
})

describe('identityRecoveryErrorMessage', () => {
  it('explains that the incremental database migration is missing', () => {
    expect(identityRecoveryErrorMessage({
      code: 'PGRST202',
      message: 'Could not find the function public.request_identity_recovery',
    })).toContain('202611050014_recovery_campaign_scope.sql')
  })

  describe('isRecoveryIdentityAlreadyMemberError', () => {
    it('recognizes the database response that means the persisted session is the old participant', () => {
      expect(isRecoveryIdentityAlreadyMemberError({
        code: 'P0001',
        message: 'Esta identidade já participa da campanha.',
      })).toBe(true)
    })

    it('does not classify unrelated validation failures as an identity collision', () => {
      expect(isRecoveryIdentityAlreadyMemberError({
        code: 'P0001',
        message: 'Não há uma participação ativa correspondente nesta campanha.',
      })).toBe(false)
    })
  })

  it('distinguishes a missing participation from a connection failure', () => {
    expect(identityRecoveryErrorMessage({
      code: 'P0001',
      message: 'Não há uma participação ativa correspondente nesta campanha.',
    })).toContain('Não encontramos uma participação ativa')
    expect(identityRecoveryErrorMessage(new TypeError('Failed to fetch')))
      .toContain('conectar ao Supabase')
  })

  it('distinguishes authorization failures and disabled anonymous sign-in', () => {
    expect(identityRecoveryErrorMessage({ status: 403, message: 'Forbidden' }))
      .toContain('sessão anônima')
    expect(identityRecoveryErrorMessage({
      code: 'anonymous_provider_disabled',
      message: 'Anonymous sign-ins are disabled',
    })).toContain('provedor Anonymous')
  })

  it('does not expose unknown database details to the player', () => {
    expect(identityRecoveryErrorMessage({
      code: 'XX000',
      message: 'internal database detail',
    })).not.toContain('internal database detail')
  })
})
