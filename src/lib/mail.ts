import { getCampaignMembers, type CampaignMember } from './campaigns'
import { supabase } from './supabase'

export type SavedSender = {
  id: string
  email: string
  name: string
}

export type SentEmail = {
  id: string
  sender_email: string
  sender_name: string
  subject: string
  body: string
  sent_at: string
  reply_to_id: string | null
  recipientNames: string[]
  recipientIds: string[]
}

export type MailWorkspace = {
  senders: SavedSender[]
  emails: SentEmail[]
  members: CampaignMember[]
  allowPlayerEmailReplies: boolean
}

type StagedAttachment = {
  id: string
  path: string
  uploaded: boolean
}

function client() {
  if (!supabase) throw new Error('Supabase não está configurado neste ambiente.')
  return supabase
}

export async function getMailWorkspace(campaignId: string): Promise<MailWorkspace> {
  const db = client()
  const [sendersResult, emailsResult, settingsResult, members] = await Promise.all([
    db.from('saved_senders').select('id,email,name').eq('campaign_id', campaignId).order('name'),
    db.from('campaign_emails').select('id,sender_email,sender_name,subject,body,sent_at,reply_to_id')
      .eq('campaign_id', campaignId).order('sent_at', { ascending: false }).limit(100),
    db.from('campaign_settings').select('allow_player_email_replies').eq('campaign_id', campaignId).single(),
    getCampaignMembers(campaignId),
  ])
  if (sendersResult.error) throw sendersResult.error
  if (emailsResult.error) throw emailsResult.error
  if (settingsResult.error) throw settingsResult.error
  const emailIds = (emailsResult.data ?? []).map((email) => email.id)
  const { data: recipients, error: recipientError } = emailIds.length
    ? await db.from('campaign_email_recipients').select('email_id,member_id').in('email_id', emailIds)
    : { data: [], error: null }
  if (recipientError) throw recipientError
  const memberNames = new Map(members.map((member) => [member.id, member.player_name]))
  const recipientNames = new Map<string, string[]>()
  const recipientIds = new Map<string, string[]>()
  for (const recipient of recipients ?? []) {
    recipientIds.set(recipient.email_id, [...(recipientIds.get(recipient.email_id) ?? []), recipient.member_id])
    const name = memberNames.get(recipient.member_id)
    if (name) recipientNames.set(recipient.email_id, [...(recipientNames.get(recipient.email_id) ?? []), name])
  }
  return {
    senders: sendersResult.data ?? [],
    emails: (emailsResult.data ?? []).map((email) => ({
      ...email,
      recipientNames: recipientNames.get(email.id) ?? [],
      recipientIds: recipientIds.get(email.id) ?? [],
    })),
    members,
    allowPlayerEmailReplies: settingsResult.data.allow_player_email_replies,
  }
}

export async function setPlayerEmailRepliesAllowed(campaignId: string, allowed: boolean): Promise<void> {
  const { error } = await client().from('campaign_settings')
    .update({ allow_player_email_replies: allowed }).eq('campaign_id', campaignId)
    .select('campaign_id').single()
  if (error) throw error
}

export async function saveSender(campaignId: string, input: { email: string; name: string }): Promise<void> {
  const db = client()
  const normalizedEmail = input.email.trim().toLowerCase()
  const { data: existing, error: lookupError } = await db.from('saved_senders')
    .select('id,email').eq('campaign_id', campaignId)
  if (lookupError) throw lookupError
  const matchingSender = existing?.find((sender) => sender.email.toLowerCase() === normalizedEmail)
  const result = matchingSender
    ? await db.from('saved_senders').update({ email: normalizedEmail, name: input.name.trim() }).eq('id', matchingSender.id).select('id').single()
    : await db.from('saved_senders').insert({ campaign_id: campaignId, email: normalizedEmail, name: input.name.trim() }).select('id').single()
  if (result.error) throw result.error
}

export async function deleteSender(senderId: string): Promise<void> {
  const { error } = await client().from('saved_senders').delete().eq('id', senderId)
  if (error) throw error
}

export async function sendCampaignEmail(input: {
  campaignId: string
  senderEmail: string
  senderName: string
  subject: string
  body: string
  memberIds: string[]
  images: File[]
  replyToId?: string | null
}): Promise<void> {
  const db = client()
  if (!input.memberIds.length) throw new Error('Selecione pelo menos um destinatário.')
  if (input.images.some((file) => !file.type.startsWith('image/') || file.size > 50 * 1024 * 1024)) {
    throw new Error('Anexe somente imagens de até 50 MB cada.')
  }
  const { data: authData, error: authError } = await db.auth.getUser()
  if (authError) throw authError
  if (!authData.user || authData.user.is_anonymous) throw new Error('Somente o mestre pode enviar e-mails internos.')

  const staged: StagedAttachment[] = []
  try {
    for (const image of input.images) {
      const safeName = image.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '_')
      const path = `${input.campaignId}/emails/${crypto.randomUUID()}-${safeName || 'imagem'}`
      const { data: fileRecord, error: metadataError } = await db.from('campaign_files')
        .insert({
          campaign_id: input.campaignId,
          storage_path: path,
          file_name: image.name,
          mime_type: image.type,
          byte_size: image.size,
          uploaded_by: authData.user.id,
        })
        .select('id')
        .single()
      if (metadataError) throw metadataError
      const stagedFile = { id: fileRecord.id as string, path, uploaded: false }
      staged.push(stagedFile)
      const { error: uploadError } = await db.storage.from('campaign-files').upload(path, image, {
        contentType: image.type,
        upsert: false,
      })
      if (uploadError) throw uploadError
      stagedFile.uploaded = true
    }

    const { error } = await db.rpc('send_campaign_email', {
      p_campaign_id: input.campaignId,
      p_sender_email: input.senderEmail.trim().toLowerCase(),
      p_sender_name: input.senderName.trim(),
      p_subject: input.subject.trim(),
      p_body: input.body,
      p_member_ids: input.memberIds,
      p_file_ids: staged.map((file) => file.id),
      p_reply_to_id: input.replyToId ?? null,
    })
    if (error) throw error
  } catch (error) {
    const cleanupErrors = await cleanupStagedAttachments(staged)
    const originalMessage = error instanceof Error ? error.message : 'Falha ao enviar o e-mail.'
    if (cleanupErrors.length) {
      throw new Error(`${originalMessage} As imagens temporárias não puderam ser totalmente removidas: ${cleanupErrors.join('; ')}`)
    }
    throw error
  }
}

async function cleanupStagedAttachments(staged: StagedAttachment[]): Promise<string[]> {
  if (!staged.length) return []
  const db = client()
  const cleanupErrors: string[] = []
  const pathsRemoved = new Set<string>()
  for (let offset = 0; offset < staged.length; offset += 100) {
    const batch = staged.slice(offset, offset + 100)
    const { error } = await db.storage.from('campaign-files').remove(batch.map((file) => file.path))
    if (error) cleanupErrors.push(error.message)
    else batch.forEach((file) => pathsRemoved.add(file.path))
  }
  const removableIds = staged
    .filter((file) => !file.uploaded || pathsRemoved.has(file.path))
    .map((file) => file.id)
  if (removableIds.length) {
    const { error } = await db.from('campaign_files').delete().in('id', removableIds)
    if (error) cleanupErrors.push(error.message)
  }
  return cleanupErrors
}
