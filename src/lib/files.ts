import { getCampaignMembers, type CampaignMember } from './campaigns'
import { supabase } from './supabase'

export type CampaignFolder = {
  id: string
  parent_id: string | null
  name: string
}

export type CampaignFile = {
  id: string
  folder_id: string | null
  storage_path: string
  file_name: string
  mime_type: string
  byte_size: number
  uploaded_at: string
  recipientIds: string[]
  recipientNames: string[]
  attachedToEmail: boolean
}

export type FileWorkspace = {
  folders: CampaignFolder[]
  files: CampaignFile[]
  members: CampaignMember[]
}

type StagedFile = { id: string; path: string; uploaded: boolean }

function client() {
  if (!supabase) throw new Error('Supabase não está configurado neste ambiente.')
  return supabase
}

export async function getFileWorkspace(campaignId: string): Promise<FileWorkspace> {
  const db = client()
  const [foldersResult, filesResult, members] = await Promise.all([
    db.from('campaign_folders').select('id,parent_id,name').eq('campaign_id', campaignId).order('name'),
    db.from('campaign_files').select('id,folder_id,storage_path,file_name,mime_type,byte_size,uploaded_at')
      .eq('campaign_id', campaignId).order('uploaded_at', { ascending: false }),
    getCampaignMembers(campaignId),
  ])
  if (foldersResult.error) throw foldersResult.error
  if (filesResult.error) throw filesResult.error
  const fileIds = (filesResult.data ?? []).map((file) => file.id)
  const [recipientResult, emailImageResult] = await Promise.all([
    fileIds.length
      ? db.from('campaign_file_recipients').select('file_id,member_id').in('file_id', fileIds)
      : Promise.resolve({ data: [], error: null }),
    fileIds.length
      ? db.from('campaign_email_images').select('file_id').in('file_id', fileIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (recipientResult.error) throw recipientResult.error
  if (emailImageResult.error) throw emailImageResult.error
  const memberById = new Map(members.map((member) => [member.id, member.player_name]))
  const recipients = new Map<string, string[]>()
  for (const recipient of recipientResult.data ?? []) {
    recipients.set(recipient.file_id, [...(recipients.get(recipient.file_id) ?? []), recipient.member_id])
  }
  const attachedFiles = new Set((emailImageResult.data ?? []).map((image) => image.file_id))
  return {
    folders: foldersResult.data ?? [],
    files: (filesResult.data ?? []).map((file) => {
      const recipientIds = recipients.get(file.id) ?? []
      return {
        ...file,
        recipientIds,
        recipientNames: recipientIds.map((id) => memberById.get(id)).filter((name): name is string => Boolean(name)),
        attachedToEmail: attachedFiles.has(file.id),
      }
    }),
    members,
  }
}

export async function createCampaignFolder(campaignId: string, parentId: string | null, name: string): Promise<void> {
  const { error } = await client().from('campaign_folders')
    .insert({ campaign_id: campaignId, parent_id: parentId, name: name.trim() }).select('id').single()
  if (error) throw error
}

export async function deleteCampaignFolder(folderId: string): Promise<void> {
  const { error } = await client().from('campaign_folders').delete().eq('id', folderId).select('id').single()
  if (error) throw error
}

export async function uploadCampaignFile(input: {
  campaignId: string
  folderId: string | null
  file: File
  memberIds: string[]
}): Promise<void> {
  const db = client()
  validateFile(input.file)
  if (!input.memberIds.length) throw new Error('Selecione pelo menos um destinatário.')
  const { data: authData, error: authError } = await db.auth.getUser()
  if (authError) throw authError
  if (!authData.user || authData.user.is_anonymous) throw new Error('Somente o mestre pode enviar arquivos.')
  const staged: StagedFile[] = []
  try {
    const path = `${input.campaignId}/files/${crypto.randomUUID()}-${safeFileName(input.file.name)}`
    const { data: record, error: metadataError } = await db.from('campaign_files').insert({
      campaign_id: input.campaignId,
      folder_id: input.folderId,
      storage_path: path,
      file_name: input.file.name,
      mime_type: input.file.type,
      byte_size: input.file.size,
      uploaded_by: authData.user.id,
    }).select('id').single()
    if (metadataError) throw metadataError
    const entry = { id: record.id as string, path, uploaded: false }
    staged.push(entry)
    const { error: uploadError } = await db.storage.from('campaign-files').upload(path, input.file, {
      contentType: input.file.type,
      upsert: false,
    })
    if (uploadError) throw uploadError
    entry.uploaded = true
    const { error: distributionError } = await db.rpc('distribute_campaign_file', {
      p_file_id: entry.id,
      p_member_ids: input.memberIds,
    })
    if (distributionError) throw distributionError
  } catch (error) {
    const cleanupErrors = await cleanupStagedFiles(staged)
    if (cleanupErrors.length) {
      const reason = error instanceof Error ? error.message : 'Falha ao enviar o arquivo.'
      throw new Error(`${reason} A limpeza do arquivo temporário falhou: ${cleanupErrors.join('; ')}`)
    }
    throw error
  }
}

export async function replaceCampaignFile(file: CampaignFile, replacement: File, campaignId: string, folderId: string | null): Promise<void> {
  if (file.attachedToEmail) throw new Error('Este arquivo é anexo de um e-mail permanente e não pode ser substituído sem alterar o histórico.')
  const { data: recipients, error: recipientError } = await client().from('campaign_file_recipients')
    .select('member_id').eq('file_id', file.id)
  if (recipientError) throw recipientError
  await uploadCampaignFile({
    campaignId,
    folderId,
    file: replacement,
    memberIds: (recipients ?? []).map((recipient) => recipient.member_id),
  })
  await deleteCampaignFile(file)
}

export async function deleteCampaignFile(file: CampaignFile): Promise<void> {
  if (file.attachedToEmail) throw new Error('Este arquivo é anexo de um e-mail permanente e não pode ser removido.')
  const db = client()
  const { error: storageError } = await db.storage.from('campaign-files').remove([file.storage_path])
  if (storageError) throw storageError
  const { error: metadataError } = await db.from('campaign_files').delete().eq('id', file.id).select('id').single()
  if (metadataError) throw metadataError
}

function validateFile(file: File) {
  if (!(file.type.startsWith('image/') || file.type === 'application/pdf')) {
    throw new Error('Selecione uma imagem ou arquivo PDF.')
  }
  if (file.size < 1 || file.size > 50 * 1024 * 1024) {
    throw new Error('Cada arquivo deve ter no máximo 50 MB.')
  }
}

function safeFileName(fileName: string) {
  return fileName.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '_') || 'arquivo'
}

async function cleanupStagedFiles(staged: StagedFile[]): Promise<string[]> {
  if (!staged.length) return []
  const db = client()
  const cleanupErrors: string[] = []
  const removedPaths = new Set<string>()
  for (let offset = 0; offset < staged.length; offset += 100) {
    const batch = staged.slice(offset, offset + 100)
    const { error } = await db.storage.from('campaign-files').remove(batch.map((file) => file.path))
    if (error) cleanupErrors.push(error.message)
    else batch.forEach((file) => removedPaths.add(file.path))
  }
  const removableIds = staged.filter((file) => !file.uploaded || removedPaths.has(file.path)).map((file) => file.id)
  if (removableIds.length) {
    const { error } = await db.from('campaign_files').delete().in('id', removableIds)
    if (error) cleanupErrors.push(error.message)
  }
  return cleanupErrors
}
