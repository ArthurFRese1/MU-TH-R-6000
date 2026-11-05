import { getCampaignMembers, type CampaignMember } from './campaigns'
import { supabase } from './supabase'

export type CampaignNotebook = {
  id: string
  name: string
}

export type CampaignNoteRecord = {
  id: string
  notebook_id: string | null
  title: string
  body: string
  visibility: 'private' | 'published'
  created_at: string
  updated_at: string
  recipients: string[]
  recipientIds: string[]
}

export type CampaignEventRecord = {
  id: string
  session_id: string | null
  title: string
  body: string
  event_type: string
  presentation: string
  is_temporary: boolean
  created_at: string
  recipients: string[]
  recipientIds: string[]
}

export type EditorialWorkspace = {
  notebooks: CampaignNotebook[]
  notes: CampaignNoteRecord[]
  events: CampaignEventRecord[]
  members: CampaignMember[]
  activeSessionId: string | null
}

function client() {
  if (!supabase) throw new Error('Supabase não está configurado neste ambiente.')
  return supabase
}

export async function getEditorialWorkspace(campaignId: string): Promise<EditorialWorkspace> {
  const db = client()
  const [notebooksResult, notesResult, eventsResult, sessionResult, members] = await Promise.all([
    db.from('campaign_notebooks').select('id,name').eq('campaign_id', campaignId).order('name'),
    db.from('campaign_notes').select('id,notebook_id,title,body,visibility,created_at,updated_at')
      .eq('campaign_id', campaignId).order('updated_at', { ascending: false }),
    db.from('campaign_events').select('id,session_id,title,body,event_type,presentation,is_temporary,created_at')
      .eq('campaign_id', campaignId).order('created_at', { ascending: false }).limit(100),
    db.from('campaign_sessions').select('id').eq('campaign_id', campaignId).is('ended_at', null).maybeSingle(),
    getCampaignMembers(campaignId),
  ])
  if (notebooksResult.error) throw notebooksResult.error
  if (notesResult.error) throw notesResult.error
  if (eventsResult.error) throw eventsResult.error
  if (sessionResult.error) throw sessionResult.error

  const noteIds = (notesResult.data ?? []).map((note) => note.id)
  const eventIds = (eventsResult.data ?? []).map((event) => event.id)
  const [noteRecipientsResult, eventRecipientsResult] = await Promise.all([
    noteIds.length
      ? db.from('campaign_note_recipients').select('note_id,member_id').in('note_id', noteIds)
      : Promise.resolve({ data: [], error: null }),
    eventIds.length
      ? db.from('campaign_event_recipients').select('event_id,member_id').in('event_id', eventIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (noteRecipientsResult.error) throw noteRecipientsResult.error
  if (eventRecipientsResult.error) throw eventRecipientsResult.error

  const names = new Map(members.map((member) => [member.id, member.player_name]))
  const noteRecipientNames = new Map<string, string[]>()
  const noteRecipientIds = new Map<string, string[]>()
  for (const recipient of noteRecipientsResult.data ?? []) {
    const name = names.get(recipient.member_id)
    if (name) noteRecipientNames.set(recipient.note_id, [...(noteRecipientNames.get(recipient.note_id) ?? []), name])
    noteRecipientIds.set(recipient.note_id, [...(noteRecipientIds.get(recipient.note_id) ?? []), recipient.member_id])
  }
  const eventRecipientNames = new Map<string, string[]>()
  const eventRecipientIds = new Map<string, string[]>()
  for (const recipient of eventRecipientsResult.data ?? []) {
    const name = names.get(recipient.member_id)
    if (name) eventRecipientNames.set(recipient.event_id, [...(eventRecipientNames.get(recipient.event_id) ?? []), name])
    eventRecipientIds.set(recipient.event_id, [...(eventRecipientIds.get(recipient.event_id) ?? []), recipient.member_id])
  }

  return {
    notebooks: notebooksResult.data ?? [],
    notes: (notesResult.data ?? []).map((note) => ({
      ...note,
      visibility: note.visibility as CampaignNoteRecord['visibility'],
      recipients: noteRecipientNames.get(note.id) ?? [],
      recipientIds: noteRecipientIds.get(note.id) ?? [],
    })),
    events: (eventsResult.data ?? []).map((event) => ({
      ...event,
      recipients: eventRecipientNames.get(event.id) ?? [],
      recipientIds: eventRecipientIds.get(event.id) ?? [],
    })),
    members,
    activeSessionId: sessionResult.data?.id ?? null,
  }
}

export async function createCampaignNotebook(campaignId: string, name: string): Promise<void> {
  const { error } = await client().from('campaign_notebooks')
    .insert({ campaign_id: campaignId, name: name.trim() }).select('id').single()
  if (error) throw error
}

export async function deleteCampaignNotebook(notebookId: string): Promise<void> {
  const { error } = await client().from('campaign_notebooks').delete().eq('id', notebookId).select('id').single()
  if (error) throw error
}

export async function saveCampaignNote(input: {
  campaignId: string
  noteId: string | null
  notebookId: string | null
  title: string
  body: string
  visibility: 'private' | 'published'
  memberIds: string[]
}): Promise<void> {
  const { error } = await client().rpc('save_campaign_note', {
    p_campaign_id: input.campaignId,
    p_note_id: input.noteId,
    p_notebook_id: input.notebookId,
    p_title: input.title.trim(),
    p_body: input.body,
    p_visibility: input.visibility,
    p_member_ids: input.memberIds,
  })
  if (error) throw error
}

export async function deleteCampaignNote(noteId: string): Promise<void> {
  const { error } = await client().rpc('delete_campaign_note', { p_note_id: noteId })
  if (error) throw error
}

export async function sendCampaignEvent(input: {
  campaignId: string
  sessionId: string | null
  title: string
  body: string
  eventType: string
  presentation: string
  temporary: boolean
  memberIds: string[]
}): Promise<void> {
  const { error } = await client().rpc('send_campaign_event', {
    p_campaign_id: input.campaignId,
    p_session_id: input.temporary ? input.sessionId : null,
    p_title: input.title.trim(),
    p_body: input.body,
    p_event_type: input.eventType,
    p_presentation: input.presentation,
    p_is_temporary: input.temporary,
    p_member_ids: input.memberIds,
  })
  if (error) throw error
}
