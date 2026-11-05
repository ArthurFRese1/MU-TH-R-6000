import { supabase } from './supabase'

export type PlayerCampaign = {
  id: string
  name: string
  description: string
  cover_url: string | null
  memberId: string
  playerName: string
  fakeEmail: string
  welcomeTitle: string
  welcomeMessage: string
  welcomeEnabled: boolean
  welcomeAcknowledged: boolean
}

export type PlayerEmail = {
  id: string
  sender_name: string
  sender_email: string
  subject: string
  body: string
  sent_at: string
  read_at: string | null
  reply_to_id?: string | null
  imageUrls: string[]
}

export type PlayerNote = {
  id: string
  title: string
  body: string
  created_at: string
  read_at: string | null
  archived_at: string | null
}

export type PlayerEvent = {
  id: string
  title: string
  body: string
  event_type: string
  presentation: string
  created_at: string
  read_at: string | null
  dismissed_at: string | null
}

export type PlayerNotification = {
  id: string
  content_type: string
  content_id: string | null
  title: string
  created_at: string
  read_at: string | null
}

export type PlayerTelemetry = {
  label: string
  ship_clock: string
  timer_started_at: string | null
  timer_elapsed_seconds: number
  energy: number | null
  oxygen: number | null
  integrity: number | null
  show_ship_clock: boolean
  show_energy: boolean
  show_oxygen: boolean
  show_integrity: boolean
}

export type PlayerCharacterSheet = {
  character_name: string
  role: string
  function_name: string
  description: string
}

export type PlayerInterfacePreferences = {
  sidebar_position: 'left' | 'right'
  sidebar_collapsed: boolean
  information_panel_order: ('identity' | 'campaign' | 'telemetry')[]
}

export const DEFAULT_PLAYER_INTERFACE_PREFERENCES: PlayerInterfacePreferences = {
  sidebar_position: 'left',
  sidebar_collapsed: false,
  information_panel_order: ['identity', 'campaign', 'telemetry'],
}

export type PlayerWorkspace = {
  emails: PlayerEmail[]
  notes: PlayerNote[]
  events: PlayerEvent[]
  notifications: PlayerNotification[]
  telemetry: PlayerTelemetry | null
  allowPlayerEmailReplies: boolean
}

function client() {
  if (!supabase) throw new Error('Supabase não está configurado neste ambiente.')
  return supabase
}

type PlayerEventRecipientState = {
  event_id: string
  read_at: string | null
  dismissed_at: string | null
}

async function getPlayerEventRecipients(memberId: string): Promise<PlayerEventRecipientState[]> {
  const pageSize = 500
  const recipients: PlayerEventRecipientState[] = []
  let offset = 0
  while (true) {
    const { data, error } = await client().from('campaign_event_recipients')
      .select('event_id,read_at,dismissed_at')
      .eq('member_id', memberId)
      .order('delivered_at', { ascending: false })
      .order('event_id', { ascending: false })
      .range(offset, offset + pageSize - 1)
    if (error) throw error
    const page = data ?? []
    if (!page.length) return recipients
    recipients.push(...page)
    offset += page.length
  }
}

async function getCampaignEvents(campaignId: string, eventIds: string[]) {
  const batches: string[][] = []
  for (let index = 0; index < eventIds.length; index += 100) {
    batches.push(eventIds.slice(index, index + 100))
  }
  const results = await Promise.all(batches.map(async (ids) => {
    const { data, error } = await client().from('campaign_events')
      .select('id,title,body,event_type,presentation,created_at')
      .eq('campaign_id', campaignId)
      .in('id', ids)
    if (error) throw error
    return data ?? []
  }))
  return results.flat()
}

export async function getPlayerCharacterSheet(memberId: string): Promise<PlayerCharacterSheet | null> {
  const { data, error } = await client().from('character_sheets')
    .select('character_name,role,function_name,description')
    .eq('member_id', memberId)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function savePlayerCharacterSheet(memberId: string, sheet: PlayerCharacterSheet): Promise<void> {
  const { error } = await client().from('character_sheets').upsert({
    member_id: memberId,
    character_name: sheet.character_name.trim(),
    role: sheet.role.trim(),
    function_name: sheet.function_name.trim(),
    description: sheet.description.trim(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'member_id' }).select('member_id').single()
  if (error) throw error
}

export async function getPlayerInterfacePreferences(memberId: string): Promise<PlayerInterfacePreferences> {
  const { data, error } = await client().from('player_interface_preferences')
    .select('sidebar_position,sidebar_collapsed,information_panel_order')
    .eq('member_id', memberId)
    .maybeSingle()
  if (error) throw error
  if (!data) return DEFAULT_PLAYER_INTERFACE_PREFERENCES
  const allowed = new Set<PlayerInterfacePreferences['information_panel_order'][number]>(['identity', 'campaign', 'telemetry'])
  const storedOrder: unknown = data.information_panel_order
  const order = Array.isArray(storedOrder)
    ? storedOrder.filter((item: unknown): item is PlayerInterfacePreferences['information_panel_order'][number] =>
      typeof item === 'string' && allowed.has(item as PlayerInterfacePreferences['information_panel_order'][number]))
    : []
  for (const item of DEFAULT_PLAYER_INTERFACE_PREFERENCES.information_panel_order) {
    if (!order.includes(item)) order.push(item)
  }
  return {
    sidebar_position: data.sidebar_position === 'right' ? 'right' : 'left',
    sidebar_collapsed: data.sidebar_collapsed,
    information_panel_order: order,
  }
}

export async function savePlayerInterfacePreferences(
  memberId: string,
  preferences: PlayerInterfacePreferences,
): Promise<void> {
  const allowed = new Set(DEFAULT_PLAYER_INTERFACE_PREFERENCES.information_panel_order)
  if (preferences.information_panel_order.length !== allowed.size
    || new Set(preferences.information_panel_order).size !== allowed.size
    || preferences.information_panel_order.some((item) => !allowed.has(item))) {
    throw new Error('A ordem dos painéis de informações é inválida.')
  }
  const { error } = await client().from('player_interface_preferences').upsert({
    member_id: memberId,
    sidebar_position: preferences.sidebar_position,
    sidebar_collapsed: preferences.sidebar_collapsed,
    information_panel_order: preferences.information_panel_order,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'member_id' }).select('member_id').single()
  if (error) throw error
}

export async function getPlayerCampaigns(userId: string): Promise<PlayerCampaign[]> {
  const { data: memberships, error: memberError } = await client()
    .from('campaign_members')
    .select('id,campaign_id,player_name,fake_email')
    .eq('user_id', userId)
    .eq('is_blocked', false)
  if (memberError) throw memberError
  if (!memberships?.length) return []

  const campaignIds = memberships.map((membership) => membership.campaign_id)
  const { data: campaigns, error: campaignError } = await client()
    .from('campaigns')
    .select('id,name,description,cover_url')
    .in('id', campaignIds)
  if (campaignError) throw campaignError

  return Promise.all((campaigns ?? []).map(async (campaign) => {
    const membership = memberships.find((item) => item.campaign_id === campaign.id)
    if (!membership) throw new Error('Não foi possível localizar a participação da campanha.')
    const [{ data: settings, error: settingsError }, { data: state, error: stateError }] = await Promise.all([
      client().from('campaign_settings')
        .select('welcome_title,welcome_message,welcome_enabled')
        .eq('campaign_id', campaign.id)
        .maybeSingle(),
      client().from('player_campaign_states')
        .select('welcome_acknowledged_at')
        .eq('member_id', membership.id)
        .maybeSingle(),
    ])
    if (settingsError) throw settingsError
    if (stateError) throw stateError
    return {
      ...campaign,
      memberId: membership.id,
      playerName: membership.player_name,
      fakeEmail: membership.fake_email,
      welcomeTitle: settings?.welcome_title ?? 'Bem-vindo a bordo',
      welcomeMessage: settings?.welcome_message ?? '',
      welcomeEnabled: settings?.welcome_enabled ?? true,
      welcomeAcknowledged: Boolean(state?.welcome_acknowledged_at),
    }
  }))
}

export async function acknowledgeWelcome(memberId: string): Promise<void> {
  const { error } = await client().from('player_campaign_states').upsert({
    member_id: memberId,
    welcome_acknowledged_at: new Date().toISOString(),
  }, { onConflict: 'member_id' })
  if (error) throw error
}

export async function getPlayerWorkspace(campaignId: string, memberId: string): Promise<PlayerWorkspace> {
  const supabase = client()
  const [
    { data: emailRecipients, error: emailRecipientError },
    { data: noteRecipients, error: noteRecipientError },
    eventRecipients,
    { data: notifications, error: notificationError },
    { data: session, error: sessionError },
    { data: settings, error: settingsError },
  ] = await Promise.all([
    supabase.from('campaign_email_recipients').select('email_id,read_at').eq('member_id', memberId).order('delivered_at', { ascending: false }),
    supabase.from('campaign_note_recipients').select('note_id,published_at').eq('member_id', memberId).order('published_at', { ascending: false }),
    getPlayerEventRecipients(memberId),
    supabase.from('campaign_notifications').select('id,content_type,content_id,title,created_at,read_at').eq('member_id', memberId).order('created_at', { ascending: false }).limit(50),
    supabase.from('campaign_sessions')
      .select('label,ship_clock,timer_started_at,timer_elapsed_seconds,energy,oxygen,integrity')
      .eq('campaign_id', campaignId)
      .is('ended_at', null)
      .maybeSingle(),
    supabase.from('campaign_settings')
      .select('show_ship_clock,show_energy,show_oxygen,show_integrity,allow_player_email_replies')
      .eq('campaign_id', campaignId)
      .maybeSingle(),
  ])
  if (emailRecipientError) throw emailRecipientError
  if (noteRecipientError) throw noteRecipientError
  if (notificationError) throw notificationError
  if (sessionError) throw sessionError
  if (settingsError) throw settingsError

  const emailIds = (emailRecipients ?? []).map((row) => row.email_id)
  const noteIds = (noteRecipients ?? []).map((row) => row.note_id)
  const eventIds = (eventRecipients ?? []).map((row) => row.event_id)
  const [emailResult, noteResult, eventRows, stateResult] = await Promise.all([
    emailIds.length
      ? supabase.from('campaign_emails').select('id,sender_name,sender_email,subject,body,sent_at,reply_to_id').eq('campaign_id', campaignId).in('id', emailIds)
      : Promise.resolve({ data: [], error: null }),
    noteIds.length
      ? supabase.from('campaign_notes').select('id,title,body,created_at').eq('campaign_id', campaignId).eq('visibility', 'published').in('id', noteIds)
      : Promise.resolve({ data: [], error: null }),
    getCampaignEvents(campaignId, eventIds),
    noteIds.length
      ? supabase.from('player_note_states').select('note_id,read_at,archived_at').eq('member_id', memberId).in('note_id', noteIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (emailResult.error) throw emailResult.error
  if (noteResult.error) throw noteResult.error
  if (stateResult.error) throw stateResult.error

  const { data: emailImageLinks, error: emailImageLinksError } = emailIds.length
    ? await supabase.from('campaign_email_images').select('email_id,file_id').in('email_id', emailIds)
    : { data: [], error: null }
  if (emailImageLinksError) throw emailImageLinksError
  const imageFileIds = [...new Set((emailImageLinks ?? []).map((link) => link.file_id))]
  const { data: imageFiles, error: imageFileError } = imageFileIds.length
    ? await supabase.from('campaign_files').select('id,storage_path').in('id', imageFileIds)
    : { data: [], error: null }
  if (imageFileError) throw imageFileError
  const imageUrls = new Map<string, string[]>()
  await Promise.all((emailImageLinks ?? []).map(async (link) => {
    const file = (imageFiles ?? []).find((item) => item.id === link.file_id)
    if (!file) return
    const url = await getPrivateFileUrl(file.storage_path)
    imageUrls.set(link.email_id, [...(imageUrls.get(link.email_id) ?? []), url])
  }))

  const emailReadAt = new Map((emailRecipients ?? []).map((row) => [row.email_id, row.read_at]))
  const noteStates = new Map((stateResult.data ?? []).map((row) => [row.note_id, row]))
  const eventReadAt = new Map((eventRecipients ?? []).map((row) => [row.event_id, row.read_at]))
  const eventDismissedAt = new Map((eventRecipients ?? []).map((row) => [row.event_id, row.dismissed_at]))
  const emails = (emailResult.data ?? []).map((row) => ({ ...row, read_at: emailReadAt.get(row.id) ?? null, imageUrls: imageUrls.get(row.id) ?? [] }))
  const notes = (noteResult.data ?? []).map((row) => ({
    ...row,
    read_at: noteStates.get(row.id)?.read_at ?? null,
    archived_at: noteStates.get(row.id)?.archived_at ?? null,
  }))
  const events = eventRows.map((row) => ({
    ...row,
    read_at: eventReadAt.get(row.id) ?? null,
    dismissed_at: eventDismissedAt.get(row.id) ?? null,
  }))
  return {
    emails,
    notes,
    events,
    notifications: (notifications ?? []) as PlayerNotification[],
    telemetry: session && settings ? { ...session, ...settings } : null,
    allowPlayerEmailReplies: settings?.allow_player_email_replies ?? false,
  }
}

export async function markEmailRead(emailId: string, memberId: string): Promise<void> {
  const { error } = await client().from('campaign_email_recipients')
    .update({ read_at: new Date().toISOString() })
    .eq('email_id', emailId)
    .eq('member_id', memberId)
  if (error) throw error
}

export async function updateNoteState(input: {
  noteId: string
  memberId: string
  readAt?: string | null
  archivedAt?: string | null
}): Promise<void> {
  const { data: current, error: readError } = await client().from('player_note_states')
    .select('read_at,archived_at')
    .eq('note_id', input.noteId)
    .eq('member_id', input.memberId)
    .maybeSingle()
  if (readError) throw readError
  const { error } = await client().from('player_note_states').upsert({
    note_id: input.noteId,
    member_id: input.memberId,
    read_at: input.readAt === undefined ? current?.read_at ?? null : input.readAt,
    archived_at: input.archivedAt === undefined ? current?.archived_at ?? null : input.archivedAt,
  }, { onConflict: 'note_id,member_id' })
  if (error) throw error
}

export async function savePrivateAnnotation(noteId: string, memberId: string, body: string): Promise<void> {
  const { error } = await client().from('player_note_annotations').upsert({
    note_id: noteId,
    member_id: memberId,
    body,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'note_id,member_id' })
  if (error) throw error
}

export async function getPrivateAnnotation(noteId: string, memberId: string): Promise<string> {
  const { data, error } = await client().from('player_note_annotations')
    .select('body')
    .eq('note_id', noteId)
    .eq('member_id', memberId)
    .maybeSingle()
  if (error) throw error
  return data?.body ?? ''
}

export async function markEventRead(eventId: string, memberId: string): Promise<void> {
  const { error } = await client().from('campaign_event_recipients')
    .update({ read_at: new Date().toISOString() })
    .eq('event_id', eventId)
    .eq('member_id', memberId)
  if (error) throw error
}

export async function dismissCampaignEvent(eventId: string): Promise<void> {
  const { error } = await client().rpc('dismiss_campaign_event', { p_event_id: eventId })
  if (error) throw error
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  const { error } = await client().from('campaign_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
  if (error) throw error
}

export async function getPrivateFileUrl(storagePath: string): Promise<string> {
  const { data, error } = await client().storage.from('campaign-files').createSignedUrl(storagePath, 3600)
  if (error) throw error
  return data.signedUrl
}

export async function replyToCampaignEmail(emailId: string, body: string): Promise<void> {
  const { error } = await client().rpc('reply_to_campaign_email', {
    p_email_id: emailId,
    p_body: body,
  })
  if (error) throw error
}
