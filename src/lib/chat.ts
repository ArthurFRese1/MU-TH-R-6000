import { supabase } from './supabase'

export type ChatType = 'global' | 'local'

export type ChatMessage = {
  id: string
  campaign_id: string
  session_id: string | null
  author_user_id: string
  author_member_id: string | null
  author_name: string
  author_alias: string
  reply_to_id: string | null
  body: string
  created_at: string
  edited_at: string | null
}

export type ChatMessagePage = {
  messages: ChatMessage[]
  hasMore: boolean
}

export type ChatTypingUser = {
  member_id: string | null
  chat_type: ChatType
  updated_at: string
}

function client() {
  if (!supabase) throw new Error('Supabase não está configurado neste ambiente.')
  return supabase
}

export async function getChatMessages(
  campaignId: string,
  chatType: ChatType,
  before?: Pick<ChatMessage, 'created_at' | 'id'>,
): Promise<ChatMessagePage> {
  const db = client()
  const table = chatType === 'global' ? 'global_messages' : 'local_messages'
  const columns = chatType === 'global'
    ? 'id,campaign_id,session_id,author_user_id,author_member_id,author_name,reply_to_id,body,created_at,edited_at'
    : 'id,campaign_id,session_id,author_user_id,author_member_id,author_alias,reply_to_id,body,created_at,edited_at'
  let query = db.from(table).select(columns).eq('campaign_id', campaignId)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(101)
  if (before) query = query.or(`created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`)
  const { data, error } = await query
  if (error) throw error
  const hasMore = (data?.length ?? 0) > 100
  const page = (data ?? []).slice(0, 100).reverse()
  if (chatType === 'global') {
    return {
      messages: page.map((row) => ({ ...row, author_alias: '' })) as ChatMessage[],
      hasMore,
    }
  }
  return {
    messages: page.map((row) => ({ ...row, author_name: 'Tripulante' })) as ChatMessage[],
    hasMore,
  }
}

export async function getCurrentCampaignSession(campaignId: string): Promise<{ id: string; label: string } | null> {
  const { data, error } = await client().from('campaign_sessions').select('id,label')
    .eq('campaign_id', campaignId).is('ended_at', null).maybeSingle()
  if (error) throw error
  return data
}

export async function getCampaignSessionLabels(campaignId: string): Promise<Map<string, string>> {
  const { data, error } = await client().from('campaign_sessions').select('id,label').eq('campaign_id', campaignId)
  if (error) throw error
  return new Map((data ?? []).map((session) => [session.id, session.label]))
}

export async function getLocalChatAlias(memberId: string): Promise<string> {
  const { data, error } = await client().from('local_chat_aliases').select('alias').eq('member_id', memberId).maybeSingle()
  if (error) throw error
  return data?.alias ?? ''
}

export async function saveLocalChatAlias(memberId: string, alias: string): Promise<void> {
  const { error } = await client().from('local_chat_aliases')
    .upsert({ member_id: memberId, alias: alias.trim() }, { onConflict: 'member_id' })
    .select('member_id').single()
  if (error) throw error
}

export async function sendChatMessage(input: {
  campaignId: string
  sessionId: string | null
  chatType: ChatType
  memberId: string | null
  body: string
  replyToId: string | null
}): Promise<void> {
  const db = client()
  const { data: authData, error: authError } = await db.auth.getUser()
  if (authError) throw authError
  if (!authData.user) throw new Error('Sessão encerrada; autentique-se novamente.')
  if (input.chatType === 'local' && !input.memberId) {
    throw new Error('O chat local exige uma participação de jogador ativa nesta campanha.')
  }
  if (input.chatType === 'global') {
    const { error } = await db.from('global_messages').insert({
      campaign_id: input.campaignId,
      session_id: input.sessionId,
      author_user_id: authData.user.id,
      author_member_id: input.memberId,
      body: input.body,
      reply_to_id: input.replyToId,
    }).select('id').single()
    if (error) throw error
  } else {
    const { error } = await db.from('local_messages').insert({
      campaign_id: input.campaignId,
      session_id: input.sessionId,
      author_user_id: authData.user.id,
      author_member_id: input.memberId,
      body: input.body,
      reply_to_id: input.replyToId,
    }).select('id').single()
    if (error) throw error
  }
}

export async function editChatMessage(chatType: ChatType, messageId: string, body: string): Promise<void> {
  const db = client()
  const table = chatType === 'global' ? 'global_messages' : 'local_messages'
  const { error } = await db.from(table).update({ body, edited_at: new Date().toISOString() })
    .eq('id', messageId).select('id').single()
  if (error) throw error
}

export async function deleteChatMessage(chatType: ChatType, messageId: string): Promise<void> {
  const db = client()
  const table = chatType === 'global' ? 'global_messages' : 'local_messages'
  const { error } = await db.from(table).delete().eq('id', messageId).select('id').single()
  if (error) throw error
}

export async function getTypingUsers(
  campaignId: string,
  chatType: ChatType,
  currentMemberId: string | null,
  isMaster: boolean,
): Promise<ChatTypingUser[]> {
  const cutoff = new Date(Date.now() - 10_000).toISOString()
  let query = client().from('chat_typing_indicators')
    .select('member_id,chat_type,updated_at')
    .eq('campaign_id', campaignId)
    .eq('chat_type', chatType)
    .gte('updated_at', cutoff)
  if (isMaster) query = query.not('member_id', 'is', null)
  else if (currentMemberId) query = query.or(`member_id.is.null,member_id.neq.${currentMemberId}`)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as ChatTypingUser[]
}

export async function setTypingState(input: {
  campaignId: string
  userId: string
  memberId: string | null
  chatType: ChatType
}): Promise<void> {
  const { error } = await client().from('chat_typing_indicators').upsert({
    campaign_id: input.campaignId,
    user_id: input.userId,
    member_id: input.memberId,
    chat_type: input.chatType,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'campaign_id,user_id,chat_type' }).select('id').single()
  if (error) throw error
}

export async function clearTypingState(input: {
  campaignId: string
  userId: string
  chatType: ChatType
}): Promise<void> {
  const { error } = await client().from('chat_typing_indicators').delete()
    .eq('campaign_id', input.campaignId).eq('user_id', input.userId).eq('chat_type', input.chatType)
  if (error) throw error
}
