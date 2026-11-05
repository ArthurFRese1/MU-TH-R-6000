import { supabase } from './supabase'

export type ActivityScope = 'all' | 'permanent' | 'temporary'

export type CampaignActivity = {
  id: string
  campaign_id: string
  actor_user_id: string | null
  actor_member_id: string | null
  activity_type: string
  description: string
  is_temporary: boolean
  session_id: string | null
  created_at: string
}

export type ActivityPage = {
  activities: CampaignActivity[]
  total: number
  hasMore: boolean
}

export type ActivityCursor = Pick<CampaignActivity, 'created_at' | 'id'>

function client() {
  if (!supabase) throw new Error('Supabase não está configurado neste ambiente.')
  return supabase
}

export async function getCampaignActivity(input: {
  campaignId: string
  scope: ActivityScope
  search: string
  before?: ActivityCursor
}): Promise<ActivityPage> {
  let query = client().from('campaign_activity_log')
    .select('id,campaign_id,actor_user_id,actor_member_id,activity_type,description,is_temporary,session_id,created_at', { count: 'exact' })
    .eq('campaign_id', input.campaignId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(51)

  if (input.scope === 'permanent') query = query.eq('is_temporary', false)
  if (input.scope === 'temporary') query = query.eq('is_temporary', true)
  const search = input.search.trim()
  if (search) query = query.ilike('description', `%${search.replace(/[%_,]/g, '\\$&')}%`)
  if (input.before) {
    query = query.or(`created_at.lt.${input.before.created_at},and(created_at.eq.${input.before.created_at},id.lt.${input.before.id})`)
  }

  const { data, error, count } = await query
  if (error) throw error
  const hasMore = (data?.length ?? 0) > 50
  return {
    activities: (data ?? []).slice(0, 50) as CampaignActivity[],
    total: count ?? 0,
    hasMore,
  }
}

export async function getCampaignActivityMembers(campaignId: string): Promise<Map<string, string>> {
  const { data, error } = await client().from('campaign_members')
    .select('id,player_name')
    .eq('campaign_id', campaignId)
  if (error) throw error
  return new Map((data ?? []).map((member) => [member.id, member.player_name]))
}
