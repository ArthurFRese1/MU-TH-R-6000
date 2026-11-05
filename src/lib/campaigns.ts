import { supabase } from './supabase'

export type Campaign = {
  id: string
  name: string
  description: string
  cover_url: string | null
  created_at: string
}

export type InvitePreview = Pick<Campaign, 'id' | 'name' | 'description' | 'cover_url'>

export type CampaignMember = {
  id: string
  player_name: string
  fake_email: string
  is_blocked: boolean
  joined_at: string
}

function client() {
  if (!supabase) throw new Error('Supabase não está configurado neste ambiente.')
  return supabase
}

export async function getCampaigns(ownerId: string): Promise<Campaign[]> {
  const { data, error } = await client()
    .from('campaigns')
    .select('id, name, description, cover_url, created_at')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function createCampaign(input: { name: string; description: string }): Promise<Campaign> {
  const { data, error } = await client().rpc('create_campaign', {
    p_name: input.name,
    p_description: input.description,
  })
  if (error) throw error
  const campaignId = (data as { campaign_id: string }).campaign_id
  const { data: campaign, error: fetchError } = await client()
    .from('campaigns')
    .select('id, name, description, cover_url, created_at')
    .eq('id', campaignId)
    .single()
  if (fetchError) throw fetchError
  return campaign
}

export async function rotateInvite(campaignId: string): Promise<string> {
  const { data, error } = await client().rpc('rotate_campaign_invite', { p_campaign_id: campaignId })
  if (error) throw error
  return data as string
}

export async function deleteCampaign(campaignId: string): Promise<void> {
  const supabase = client()
  const { data: files, error: listError } = await supabase
    .from('campaign_files')
    .select('storage_path')
    .eq('campaign_id', campaignId)
  if (listError) throw listError

  const paths = (files ?? []).map((file) => file.storage_path)
  for (let offset = 0; offset < paths.length; offset += 100) {
    const { error: storageError } = await supabase.storage
      .from('campaign-files')
      .remove(paths.slice(offset, offset + 100))
    if (storageError) throw new Error(`Não foi possível remover arquivos do Storage; a campanha foi mantida. ${storageError.message}`)
  }

  const { error: metadataError } = await supabase
    .from('campaign_files')
    .delete()
    .eq('campaign_id', campaignId)
  if (metadataError) throw metadataError

  const { error } = await supabase.from('campaigns').delete().eq('id', campaignId)
  if (error) throw error
}

export async function getInvitePreview(code: string): Promise<InvitePreview> {
  const { data, error } = await client().rpc('preview_campaign_invite', { p_code: code })
  if (error) throw error
  if (!data) throw new Error('Convite inválido, expirado ou sem utilizações disponíveis.')
  return data as InvitePreview
}

export async function joinCampaign(code: string, playerName: string, fakeEmail: string): Promise<void> {
  const { error } = await client().rpc('join_campaign_by_invite', {
    p_code: code,
    p_player_name: playerName,
    p_fake_email: fakeEmail,
  })
  if (error) throw error
}

export async function getCampaignMembers(campaignId: string): Promise<CampaignMember[]> {
  const { data, error } = await client()
    .from('campaign_members')
    .select('id, player_name, fake_email, is_blocked, joined_at')
    .eq('campaign_id', campaignId)
    .order('joined_at', { ascending: true })
  if (error) throw error
  return data
}

export async function setCampaignMemberBlocked(memberId: string, isBlocked: boolean): Promise<void> {
  const { error } = await client()
    .from('campaign_members')
    .update({ is_blocked: isBlocked })
    .eq('id', memberId)
  if (error) throw error
}

export async function removeCampaignMember(memberId: string): Promise<void> {
  const { error } = await client()
    .from('campaign_members')
    .delete()
    .eq('id', memberId)
  if (error) throw error
}
