import { supabase } from './supabase'

export type CampaignSystemSettings = {
  welcome_title: string
  welcome_message: string
  welcome_enabled: boolean
  allow_player_email_replies: boolean
  show_ship_clock: boolean
  show_energy: boolean
  show_oxygen: boolean
  show_integrity: boolean
}

export type ActiveCampaignInvite = {
  code: string
  valid_until: string | null
  max_uses: number | null
  uses: number
  created_at: string
}

export type CampaignSettingsWorkspace = {
  settings: CampaignSystemSettings
  invite: ActiveCampaignInvite | null
}

function client() {
  if (!supabase) throw new Error('Supabase não está configurado neste ambiente.')
  return supabase
}

export async function getCampaignSettings(campaignId: string): Promise<CampaignSettingsWorkspace> {
  const db = client()
  const [settingsResult, inviteResult] = await Promise.all([
    db.from('campaign_settings')
      .select('welcome_title,welcome_message,welcome_enabled,allow_player_email_replies,show_ship_clock,show_energy,show_oxygen,show_integrity')
      .eq('campaign_id', campaignId)
      .single(),
    db.from('campaign_invites')
      .select('code,valid_until,max_uses,uses,created_at')
      .eq('campaign_id', campaignId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (settingsResult.error) throw settingsResult.error
  if (inviteResult.error) throw inviteResult.error
  return { settings: settingsResult.data, invite: inviteResult.data }
}

export async function saveCampaignSystemSettings(
  campaignId: string,
  patch: Partial<CampaignSystemSettings>,
): Promise<void> {
  const { error } = await client().from('campaign_settings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('campaign_id', campaignId)
    .select('campaign_id')
    .single()
  if (error) throw error
}

export async function saveCampaignGeneral(input: {
  campaignId: string
  name: string
  description: string
  coverUrl: string | null
}): Promise<void> {
  const { error } = await client().from('campaigns')
    .update({
      name: input.name.trim(),
      description: input.description.trim(),
      cover_url: input.coverUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.campaignId)
    .select('id')
    .single()
  if (error) throw error
}

export async function rotateCampaignInviteSettings(input: {
  campaignId: string
  validUntil: string | null
  maxUses: number | null
}): Promise<string> {
  if (input.maxUses !== null && (!Number.isInteger(input.maxUses) || input.maxUses < 1)) {
    throw new Error('O limite de usos deve ser um inteiro positivo.')
  }
  const { data, error } = await client().rpc('rotate_campaign_invite', {
    p_campaign_id: input.campaignId,
    p_valid_until: input.validUntil,
    p_max_uses: input.maxUses,
  })
  if (error) throw error
  return data as string
}

export async function invalidateCampaignInvites(campaignId: string): Promise<void> {
  const { error } = await client().rpc('invalidate_campaign_invites', { p_campaign_id: campaignId })
  if (error) throw error
}
