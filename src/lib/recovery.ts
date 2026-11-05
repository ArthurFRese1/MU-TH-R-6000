import { supabase } from './supabase'

export type IdentityRecoveryRequest = {
  id: string
  campaign_id: string
  member_id: string
  requested_user_id: string
  status: 'pending' | 'approved' | 'rejected'
  requested_at: string
}

type RecoveryErrorShape = {
  code?: unknown
  details?: unknown
  hint?: unknown
  message?: unknown
  name?: unknown
  status?: unknown
}

function client() {
  if (!supabase) throw new Error('Supabase não está configurado neste ambiente.')
  return supabase
}

export function isValidRecoveryEmail(email: string): boolean {
  return /^[^@\s]+@gmail\.com$/i.test(email.trim())
}

function errorShape(error: unknown): RecoveryErrorShape {
  return error && typeof error === 'object' ? error as RecoveryErrorShape : {}
}

function errorText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function isRecoveryIdentityAlreadyMemberError(error: unknown): boolean {
  const shape = errorShape(error)
  return errorText(shape.message || error)
    .toLowerCase()
    .includes('esta identidade já participa da campanha')
}

function safeDiagnosticText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return value
    .replace(/Bearer\s+\S+/gi, 'Bearer [redigido]')
    .replace(/sb_(?:publishable|secret)_[A-Za-z0-9_-]+/g, '[chave Supabase redigida]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[token redigido]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[e-mail redigido]')
    .slice(0, 1000)
}

export function identityRecoveryErrorMessage(error: unknown): string {
  const shape = errorShape(error)
  const code = errorText(shape.code)
  const message = errorText(shape.message || error)
  const normalized = message.toLowerCase()

  if (code === 'PGRST202') {
    return 'O banco ainda não recebeu a atualização da recuperação. Peça ao administrador para aplicar a migration 202611050014_recovery_campaign_scope.sql.'
  }
  if (code === '23505' || normalized.includes('já existe uma solicitação pendente')) {
    return 'Já existe um pedido de recuperação pendente para esta identidade e participação.'
  }
  if (code === '42501' || shape.status === 401 || shape.status === 403 ||
    normalized.includes('requer uma nova sessão anônima') ||
    normalized.includes('deve ser solicitada por uma identidade anônima')) {
    return 'A solicitação precisa ser feita por uma sessão anônima de jogador. Saia da conta atual e abra novamente o convite.'
  }
  if (normalized.includes('não há uma participação ativa correspondente')) {
    return 'Não encontramos uma participação ativa com esse e-mail nesta campanha. Confira o identificador usado originalmente.'
  }
  if (normalized.includes('esta identidade já participa da campanha')) {
    return 'Esta identidade já possui uma participação nesta campanha.'
  }
  if (normalized.includes('informe o e-mail fictício') || normalized.includes('e-mail inválido')) {
    return 'Informe o e-mail de identificação usado na participação original, no formato nome@gmail.com.'
  }
  if (normalized.includes('convite inválido')) {
    return 'O convite não pôde ser validado. Atualize a página e use o convite ativo da campanha.'
  }
  if (code === 'anonymous_provider_disabled' || normalized.includes('anonymous_provider_disabled') ||
    normalized.includes('anonymous sign-ins are disabled')) {
    return 'O acesso anônimo de jogadores está desativado no Supabase. Habilite o provedor Anonymous em Authentication → Sign In / Providers.'
  }
  if (error instanceof TypeError || shape.name === 'AbortError' ||
    /failed to fetch|network request failed|networkerror|timed? ?out|fetch failed/i.test(normalized)) {
    return 'Não foi possível conectar ao Supabase. Verifique sua conexão e tente novamente.'
  }
  if (typeof shape.status === 'number' && shape.status >= 500) {
    return 'O Supabase encontrou um erro temporário ao processar o pedido. Tente novamente em instantes.'
  }
  return 'Não foi possível enviar o pedido de recuperação. Tente novamente; se persistir, verifique o diagnóstico no console.'
}

export function logIdentityRecoveryError(stage: string, error: unknown): void {
  const shape = errorShape(error)
  console.error('[MU/TH/R 6000] Falha na recuperação de participação', {
    stage,
    code: typeof shape.code === 'string' ? shape.code : null,
    status: typeof shape.status === 'number' ? shape.status : null,
    name: typeof shape.name === 'string' ? shape.name : null,
    message: safeDiagnosticText(shape.message ?? error),
    details: safeDiagnosticText(shape.details),
    hint: safeDiagnosticText(shape.hint),
  })
}

export async function requestIdentityRecovery(campaignId: string, fakeEmail: string): Promise<void> {
  if (!isValidRecoveryEmail(fakeEmail)) {
    throw new Error('Informe o e-mail de identificação usado na participação original, no formato nome@gmail.com.')
  }
  const { error } = await client().rpc('request_identity_recovery', {
    p_campaign_id: campaignId,
    p_fake_email: fakeEmail.trim().toLowerCase(),
  })
  if (error) throw error
}

export async function getCampaignRecoveryRequests(campaignId: string): Promise<IdentityRecoveryRequest[]> {
  const { data, error } = await client().from('identity_recovery_requests')
    .select('id,campaign_id,member_id,requested_user_id,status,requested_at')
    .eq('campaign_id', campaignId)
    .order('requested_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as IdentityRecoveryRequest[]
}

export async function getMyIdentityRecoveryRequests(): Promise<IdentityRecoveryRequest[]> {
  const db = client()
  const { data: authData, error: authError } = await db.auth.getUser()
  if (authError) throw authError
  if (!authData.user) throw new Error('Sessão encerrada; autentique-se novamente.')
  const { data, error } = await db.from('identity_recovery_requests')
    .select('id,campaign_id,member_id,requested_user_id,status,requested_at')
    .eq('requested_user_id', authData.user.id)
    .order('requested_at', { ascending: false })
    .limit(10)
  if (error) throw error
  return (data ?? []) as IdentityRecoveryRequest[]
}

export async function resolveIdentityRecovery(requestId: string, decision: 'approve' | 'reject'): Promise<void> {
  const { error } = await client().rpc(
    decision === 'approve' ? 'approve_identity_recovery' : 'reject_identity_recovery',
    { p_request_id: requestId },
  )
  if (error) throw error
}
