import { supabase } from './supabase'

export type CampaignSession = {
  id: string
  campaign_id: string
  label: string
  started_at: string
  ended_at: string | null
  timer_started_at: string | null
  timer_elapsed_seconds: number
  ship_clock: string
  energy: number | null
  oxygen: number | null
  integrity: number | null
}

export type SessionSettings = {
  show_ship_clock: boolean
  show_energy: boolean
  show_oxygen: boolean
  show_integrity: boolean
}

export type SessionWorkspace = {
  current: CampaignSession | null
  history: CampaignSession[]
  settings: SessionSettings
}

function client() {
  if (!supabase) throw new Error('Supabase não está configurado neste ambiente.')
  return supabase
}

export async function getSessionWorkspace(campaignId: string): Promise<SessionWorkspace> {
  const db = client()
  const [sessionResult, historyResult, settingsResult] = await Promise.all([
    db.from('campaign_sessions')
      .select('id,campaign_id,label,started_at,ended_at,timer_started_at,timer_elapsed_seconds,ship_clock,energy,oxygen,integrity')
      .eq('campaign_id', campaignId)
      .is('ended_at', null)
      .maybeSingle(),
    db.from('campaign_sessions')
      .select('id,campaign_id,label,started_at,ended_at,timer_started_at,timer_elapsed_seconds,ship_clock,energy,oxygen,integrity')
      .eq('campaign_id', campaignId)
      .not('ended_at', 'is', null)
      .order('ended_at', { ascending: false })
      .limit(25),
    db.from('campaign_settings')
      .select('show_ship_clock,show_energy,show_oxygen,show_integrity')
      .eq('campaign_id', campaignId)
      .single(),
  ])
  if (sessionResult.error) throw sessionResult.error
  if (historyResult.error) throw historyResult.error
  if (settingsResult.error) throw settingsResult.error
  return { current: sessionResult.data, history: historyResult.data ?? [], settings: settingsResult.data }
}

export async function startCampaignSession(campaignId: string, label: string): Promise<void> {
  const db = client()
  const { data: userResult, error: userError } = await db.auth.getUser()
  if (userError) throw userError
  if (!userResult.user || userResult.user.is_anonymous) throw new Error('Apenas uma conta de mestre pode iniciar uma sessão.')
  const { error } = await db.from('campaign_sessions').insert({
    campaign_id: campaignId,
    label,
    created_by: userResult.user.id,
  }).select('id').single()
  if (error) throw error
}

export async function updateCampaignSession(sessionId: string, patch: Partial<Pick<
  CampaignSession,
  'label' | 'timer_started_at' | 'timer_elapsed_seconds' | 'ship_clock' | 'energy' | 'oxygen' | 'integrity'
>>): Promise<void> {
  const { error } = await client().from('campaign_sessions').update(patch).eq('id', sessionId).select('id').single()
  if (error) throw error
}

export async function updateSessionSettings(campaignId: string, patch: Partial<SessionSettings>): Promise<void> {
  const { error } = await client().from('campaign_settings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('campaign_id', campaignId).select('campaign_id').single()
  if (error) throw error
}

export async function endCampaignSession(
  sessionId: string,
  cleanup: { globalChat: boolean; localChat: boolean; temporaryActivity: boolean },
): Promise<void> {
  const { error } = await client().rpc('end_campaign_session', {
    p_session_id: sessionId,
    p_clear_global_chat: cleanup.globalChat,
    p_clear_local_chat: cleanup.localChat,
    p_clear_temporary_activity: cleanup.temporaryActivity,
  })
  if (error) throw error
}
