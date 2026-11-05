import { createCampaign, deleteCampaign, type Campaign } from './campaigns'
import { supabase } from './supabase'

const MAGIC = 'MUTHR6000\n'
const HEADER_BYTES = 14
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024
const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_TOTAL_FILE_BYTES = 500 * 1024 * 1024

type BackupRow = Record<string, unknown>

type BackupFile = {
  record: BackupRow
  byte_size: number
}

type CampaignBackup = {
  format: 'MU-TH-R-6000-CAMPAIGN'
  version: 1
  exported_at: string
  campaign: { name: string; description: string; cover_url: string | null }
  settings: BackupRow
  sessions: BackupRow[]
  global_messages: BackupRow[]
  senders: BackupRow[]
  emails: BackupRow[]
  email_images: BackupRow[]
  folders: BackupRow[]
  files: BackupFile[]
  notebooks: BackupRow[]
  notes: BackupRow[]
  events: BackupRow[]
  bulletins: BackupRow[]
  activity: BackupRow[]
}

export type CampaignBackupPreview = {
  name: string
  description: string
  exportedAt: string
  sessions: number
  emails: number
  notes: number
  events: number
  files: number
  fileBytes: number
}

function client() {
  if (!supabase) throw new Error('Supabase não está configurado neste ambiente.')
  return supabase
}

async function campaignRows(table: string, columns: string, campaignId: string): Promise<BackupRow[]> {
  const rows: BackupRow[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client().from(table).select(columns)
      .eq('campaign_id', campaignId).range(offset, offset + 499)
    if (error) throw error
    const page = (data ?? []) as unknown as BackupRow[]
    rows.push(...page)
    if (page.length < 500) return rows
  }
}

async function tableRows(table: string, columns: string, key: string, ids: string[]): Promise<BackupRow[]> {
  if (!ids.length) return []
  const rows: BackupRow[] = []
  for (let offset = 0; offset < ids.length; offset += 500) {
    const idBatch = ids.slice(offset, offset + 500)
    for (let pageOffset = 0; ; pageOffset += 500) {
      const { data, error } = await client().from(table).select(columns).in(key, idBatch)
        .range(pageOffset, pageOffset + 499)
      if (error) throw error
      const page = (data ?? []) as unknown as BackupRow[]
      rows.push(...page)
      if (page.length < 500) break
    }
  }
  return rows
}

async function permanentActivityRows(campaignId: string): Promise<BackupRow[]> {
  const rows: BackupRow[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client().from('campaign_activity_log').select(
      'id,activity_type,description,is_temporary,session_id,created_at',
    ).eq('campaign_id', campaignId).eq('is_temporary', false).order('created_at')
      .range(offset, offset + 499)
    if (error) throw error
    const page = (data ?? []) as unknown as BackupRow[]
    rows.push(...page)
    if (page.length < 500) return rows
  }
}

export async function exportCampaignBackup(campaignId: string): Promise<{ blob: Blob; filename: string }> {
  const db = client()
  const [
    { data: campaign, error: campaignError },
    { data: settings, error: settingsError },
    sessions,
    globalMessages,
    senders,
    emails,
    folders,
    files,
    notebooks,
    notes,
    events,
    bulletins,
    activity,
  ] = await Promise.all([
    db.from('campaigns').select('name,description,cover_url').eq('id', campaignId).single(),
    db.from('campaign_settings')
      .select('welcome_title,welcome_message,welcome_enabled,allow_player_email_replies,show_ship_clock,show_energy,show_oxygen,show_integrity')
      .eq('campaign_id', campaignId).single(),
    campaignRows('campaign_sessions', 'id,label,started_at,ended_at,timer_started_at,timer_elapsed_seconds,ship_clock,energy,oxygen,integrity,created_at', campaignId),
    campaignRows('global_messages', 'id,session_id,author_name,reply_to_id,body,created_at,edited_at', campaignId),
    campaignRows('saved_senders', 'email,name', campaignId),
    campaignRows('campaign_emails', 'id,sender_email,sender_name,subject,body,reply_to_id,sent_at', campaignId),
    campaignRows('campaign_folders', 'id,parent_id,name,created_at', campaignId),
    campaignRows('campaign_files', 'id,folder_id,storage_path,file_name,mime_type,byte_size,uploaded_at', campaignId),
    campaignRows('campaign_notebooks', 'id,name,created_at', campaignId),
    campaignRows('campaign_notes', 'id,notebook_id,title,body,visibility,created_at,updated_at', campaignId),
    campaignRows('campaign_events', 'id,session_id,title,body,event_type,presentation,is_temporary,created_at', campaignId),
    campaignRows('campaign_bulletins', 'title,body,enabled,updated_at', campaignId),
    permanentActivityRows(campaignId),
  ])
  if (campaignError) throw campaignError
  if (settingsError) throw settingsError

  const emailImages = await tableRows('campaign_email_images', 'email_id,file_id', 'email_id', emails.map((row) => row.id as string))
  const totalBytes = files.reduce((total, file) => total + Number(file.byte_size), 0)
  validateFileSizes(files, totalBytes)

  const archiveObjects: Blob[] = []
  const backupFiles: BackupFile[] = []
  for (const record of files) {
    const path = record.storage_path as string
    const { data, error } = await db.storage.from('campaign-files').download(path)
    if (error) throw new Error(`Não foi possível exportar "${record.file_name}": ${error.message}`)
    if (data.size !== Number(record.byte_size)) {
      throw new Error(`O tamanho do arquivo "${record.file_name}" não corresponde aos metadados. O backup foi interrompido.`)
    }
    archiveObjects.push(data)
    backupFiles.push({
      record: {
        ...record,
        storage_path: undefined,
      },
      byte_size: data.size,
    })
  }

  const manifest: CampaignBackup = {
    format: 'MU-TH-R-6000-CAMPAIGN',
    version: 1,
    exported_at: new Date().toISOString(),
    campaign,
    settings,
    sessions,
    global_messages: globalMessages,
    senders,
    emails,
    email_images: emailImages,
    folders,
    files: backupFiles,
    notebooks,
    notes,
    events: events.filter((event) => event.is_temporary !== true),
    bulletins,
    activity,
  }
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest))
  if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) {
    throw new Error('Os metadados excedem o limite de 16 MB para este backup.')
  }
  const header = new Uint8Array(HEADER_BYTES)
  header.set(new TextEncoder().encode(MAGIC), 0)
  new DataView(header.buffer).setUint32(10, manifestBytes.byteLength, false)
  const safeName = campaign.name.normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'campanha'
  return {
    blob: new Blob([header, manifestBytes, ...archiveObjects], { type: 'application/vnd.muthr.backup' }),
    filename: `muthr-${safeName}-${new Date().toISOString().slice(0, 10)}.muthr`,
  }
}

export async function restoreCampaignBackup(file: File): Promise<Campaign> {
  const { manifest, objects } = await readBackupArchive(file)
  const userResult = await client().auth.getUser()
  if (userResult.error) throw userResult.error
  const user = userResult.data.user
  if (!user || user.is_anonymous) throw new Error('Somente uma conta de mestre pode restaurar uma campanha.')

  const campaign = await createCampaign({ name: manifest.campaign.name, description: manifest.campaign.description })
  try {
    await importCampaignData(campaign.id, user.id, manifest, objects)
    return {
      ...campaign,
      name: manifest.campaign.name,
      description: manifest.campaign.description,
      cover_url: manifest.campaign.cover_url,
    }
  } catch (cause) {
    try {
      await deleteCampaign(campaign.id)
    } catch (cleanupError) {
      const originalMessage = cause instanceof Error ? cause.message : 'Falha ao restaurar o backup.'
      const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : 'Falha ao limpar a restauração parcial.'
      throw new Error(`${originalMessage} A limpeza automática não foi concluída: ${cleanupMessage}. A campanha parcial continua disponível como "${campaign.name}" (ID ${campaign.id}).`)
    }
    throw cause
  }
}

export async function inspectCampaignBackup(file: File): Promise<CampaignBackupPreview> {
  const { manifest } = await readBackupArchive(file)
  return {
    name: manifest.campaign.name,
    description: manifest.campaign.description,
    exportedAt: manifest.exported_at,
    sessions: manifest.sessions.length,
    emails: manifest.emails.length,
    notes: manifest.notes.length,
    events: manifest.events.length,
    files: manifest.files.length,
    fileBytes: manifest.files.reduce((total, item) => total + item.byte_size, 0),
  }
}

async function readBackupArchive(file: File): Promise<{ manifest: CampaignBackup; objects: Blob[] }> {
  if (file.size < HEADER_BYTES) throw new Error('O arquivo selecionado não contém um backup MU/TH/R válido.')
  const header = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer())
  if (new TextDecoder().decode(header.slice(0, 10)) !== MAGIC) {
    throw new Error('Formato de backup desconhecido. Selecione um arquivo .muthr exportado pelo MU/TH/R 6000.')
  }
  const manifestSize = new DataView(header.buffer).getUint32(10, false)
  if (manifestSize < 2 || manifestSize > MAX_MANIFEST_BYTES || HEADER_BYTES + manifestSize > file.size) {
    throw new Error('O manifesto do backup tem um tamanho inválido.')
  }
  let manifest: CampaignBackup
  try {
    manifest = JSON.parse(await file.slice(HEADER_BYTES, HEADER_BYTES + manifestSize).text()) as CampaignBackup
  } catch {
    throw new Error('O manifesto do backup não é um JSON válido.')
  }
  validateManifest(manifest)
  const objects: Blob[] = []
  let offset = HEADER_BYTES + manifestSize
  for (const item of manifest.files) {
    const end = offset + item.byte_size
    if (end > file.size) throw new Error(`O backup está incompleto no arquivo "${item.record.file_name}".`)
    objects.push(file.slice(offset, end, String(item.record.mime_type)))
    offset = end
  }
  if (offset !== file.size) throw new Error('O backup contém dados excedentes ou está corrompido.')
  validateRelationships(manifest)
  return { manifest, objects }
}

function validateManifest(manifest: CampaignBackup) {
  if (!manifest || typeof manifest !== 'object'
    || manifest.format !== 'MU-TH-R-6000-CAMPAIGN' || manifest.version !== 1) {
    throw new Error('Versão de backup não suportada.')
  }
  if (!manifest.campaign || typeof manifest.campaign.name !== 'string'
    || !manifest.campaign.name.trim() || manifest.campaign.name.length > 100
    || typeof manifest.campaign.description !== 'string' || manifest.campaign.description.length > 1000
    || (manifest.campaign.cover_url !== null && typeof manifest.campaign.cover_url !== 'string')) {
    throw new Error('Os dados gerais da campanha no backup são inválidos.')
  }
  if (manifest.campaign.cover_url) {
    let cover: URL
    try { cover = new URL(manifest.campaign.cover_url) } catch { throw new Error('A URL de capa no backup é inválida.') }
    if (cover.protocol !== 'https:' && cover.protocol !== 'http:') throw new Error('A URL de capa no backup deve usar HTTP ou HTTPS.')
  }
  const arrays: (keyof CampaignBackup)[] = [
    'sessions', 'global_messages', 'senders', 'emails', 'email_images',
    'folders', 'files', 'notebooks', 'notes', 'events', 'bulletins', 'activity',
  ]
  for (const key of arrays) {
    if (!Array.isArray(manifest[key])) throw new Error(`A seção ${key} do backup é inválida.`)
    if ((manifest[key] as unknown[]).some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
      throw new Error(`A seção ${key} contém registros inválidos.`)
    }
  }
  if (!manifest.settings || typeof manifest.settings !== 'object' || Array.isArray(manifest.settings)) {
    throw new Error('As configurações da campanha são inválidas.')
  }
  if (typeof manifest.exported_at !== 'string' || Number.isNaN(Date.parse(manifest.exported_at))) {
    throw new Error('A data de exportação do backup é inválida.')
  }
  const settings = manifest.settings
  if (typeof settings.welcome_title !== 'string' || settings.welcome_title.length > 120
    || typeof settings.welcome_message !== 'string' || settings.welcome_message.length > 5000
    || !['welcome_enabled', 'allow_player_email_replies', 'show_ship_clock', 'show_energy', 'show_oxygen', 'show_integrity']
      .every((key) => typeof settings[key] === 'boolean')) {
    throw new Error('As configurações da campanha no backup são inválidas.')
  }
  for (const item of manifest.files) {
    if (!item || typeof item !== 'object' || !item.record || typeof item.record !== 'object' || Array.isArray(item.record)
      || item.byte_size !== Number(item.record.byte_size)
      || typeof item.record.file_name !== 'string' || !item.record.file_name.trim() || item.record.file_name.length > 255) {
      throw new Error('Os metadados de um arquivo no backup são inválidos.')
    }
  }
  const totalBytes = manifest.files.reduce((total, item) => total + item.byte_size, 0)
  validateFileSizes(manifest.files.map((item) => item.record), totalBytes)
}

function validateFileSizes(files: BackupRow[], totalBytes: number) {
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 0 || totalBytes > MAX_TOTAL_FILE_BYTES) {
    throw new Error('O conjunto de arquivos excede o limite de 500 MB por backup neste navegador.')
  }
  for (const file of files) {
    const size = Number(file.byte_size)
    const mimeType = file.mime_type
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_FILE_BYTES
      || (typeof mimeType !== 'string' || (!mimeType.startsWith('image/') && mimeType !== 'application/pdf'))) {
      throw new Error(`O arquivo "${String(file.file_name ?? 'sem nome')}" viola o limite de tipo ou tamanho do Storage.`)
    }
  }
}

function validateRelationships(manifest: CampaignBackup) {
  const ids = (rows: BackupRow[], section: string) => {
    const result = new Set(rows.map((row) => requiredId(row.id, section)))
    if (result.size !== rows.length) throw new Error(`A seção ${section} contém IDs repetidos.`)
    return result
  }
  const sessionIds = ids(manifest.sessions, 'sessions')
  const messageIds = ids(manifest.global_messages, 'global_messages')
  const emailIds = ids(manifest.emails, 'emails')
  const folderIds = ids(manifest.folders, 'folders')
  const fileIds = ids(manifest.files.map((item) => item.record), 'files')
  const notebookIds = ids(manifest.notebooks, 'notebooks')
  const noteIds = ids(manifest.notes, 'notes')
  const eventIds = ids(manifest.events, 'events')
  for (const row of manifest.global_messages) {
    optionalReference(row.session_id, sessionIds, 'sessão da mensagem')
    optionalReference(row.reply_to_id, messageIds, 'resposta do chat')
  }
  validateAcyclicParentLinks(manifest.global_messages, 'reply_to_id', 'respostas do chat')
  validateAcyclicParentLinks(manifest.emails, 'reply_to_id', 'respostas de e-mail')
  validateAcyclicParentLinks(manifest.folders, 'parent_id', 'hierarquia de pastas')
  for (const row of manifest.folders) optionalReference(row.parent_id, folderIds, 'pasta superior')
  for (const item of manifest.files) optionalReference(item.record.folder_id, folderIds, 'pasta do arquivo')
  for (const row of manifest.emails) optionalReference(row.reply_to_id, emailIds, 'resposta do e-mail')
  for (const row of manifest.email_images) {
    reference(row.email_id, emailIds, 'e-mail da imagem')
    reference(row.file_id, fileIds, 'arquivo da imagem')
  }
  for (const row of manifest.notes) optionalReference(row.notebook_id, notebookIds, 'caderno da nota')
  for (const row of manifest.events) optionalReference(row.session_id, sessionIds, 'sessão do evento')
  for (const row of manifest.activity) optionalReference(row.session_id, sessionIds, 'sessão do registro')
  for (const row of manifest.events) requiredId(row.id, 'events')
  for (const row of manifest.notes) requiredId(row.id, 'notes')
  for (const row of manifest.bulletins) {
    if (typeof row.title !== 'string' || typeof row.body !== 'string' || typeof row.enabled !== 'boolean') {
      throw new Error('Um comunicado de boas-vindas no backup é inválido.')
    }
  }
  if (eventIds.size !== manifest.events.length || noteIds.size !== manifest.notes.length) {
    throw new Error('O backup contém registros duplicados.')
  }
}

function validateAcyclicParentLinks(rows: BackupRow[], parentKey: string, label: string) {
  const parentById = new Map(rows.map((row) => [requiredId(row.id, label), row[parentKey]]))
  for (const id of parentById.keys()) {
    const visited = new Set<string>()
    let current: string | undefined = id
    while (current) {
      if (visited.has(current)) throw new Error(`O backup contém referências circulares em ${label}.`)
      visited.add(current)
      const parent = parentById.get(current)
      current = typeof parent === 'string' ? parent : undefined
    }
  }
}

function requiredId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`ID inválido na seção ${label}.`)
  return value
}

function optionalReference(value: unknown, ids: Set<string>, label: string) {
  if (value !== null && value !== undefined) reference(value, ids, label)
}

function reference(value: unknown, ids: Set<string>, label: string) {
  if (typeof value !== 'string' || !ids.has(value)) throw new Error(`Referência inválida: ${label}.`)
}

async function importCampaignData(
  campaignId: string,
  userId: string,
  backup: CampaignBackup,
  objects: Blob[],
) {
  const db = client()
  const { error: campaignError } = await db.from('campaigns').update({
    name: backup.campaign.name,
    description: backup.campaign.description,
    cover_url: backup.campaign.cover_url,
    updated_at: new Date().toISOString(),
  }).eq('id', campaignId)
  if (campaignError) throw campaignError
  const { error: settingsError } = await db.from('campaign_settings')
    .update({
      welcome_title: backup.settings.welcome_title,
      welcome_message: backup.settings.welcome_message,
      welcome_enabled: backup.settings.welcome_enabled,
      allow_player_email_replies: backup.settings.allow_player_email_replies,
      show_ship_clock: backup.settings.show_ship_clock,
      show_energy: backup.settings.show_energy,
      show_oxygen: backup.settings.show_oxygen,
      show_integrity: backup.settings.show_integrity,
    }).eq('campaign_id', campaignId)
  if (settingsError) throw settingsError

  const sessionIds = makeIdMap(backup.sessions)
  const messageIds = makeIdMap(backup.global_messages)
  const emailIds = makeIdMap(backup.emails)
  const folderIds = makeIdMap(backup.folders)
  const fileIds = makeIdMap(backup.files.map((item) => item.record))
  const notebookIds = makeIdMap(backup.notebooks)
  const noteIds = makeIdMap(backup.notes)
  const eventIds = makeIdMap(backup.events)
  const now = new Date().toISOString()

  await insertRows('campaign_sessions', backup.sessions.map((row) => {
    const ended = typeof row.ended_at === 'string' ? row.ended_at : now
    const runningDuration = !row.ended_at && typeof row.timer_started_at === 'string'
      ? Math.max(0, Math.floor((Date.now() - Date.parse(row.timer_started_at)) / 1000))
      : 0
    return {
      id: mapId(sessionIds, row.id),
      campaign_id: campaignId,
      label: row.label,
      started_at: row.started_at,
      ended_at: ended,
      timer_started_at: null,
      timer_elapsed_seconds: Number(row.timer_elapsed_seconds ?? 0) + runningDuration,
      ship_clock: row.ship_clock,
      energy: row.energy,
      oxygen: row.oxygen,
      integrity: row.integrity,
      created_by: userId,
      created_at: row.created_at,
    }
  }))

  await insertLinkedRows('campaign_folders', backup.folders, folderIds, 'parent_id', (row) => ({
    id: mapId(folderIds, row.id),
    campaign_id: campaignId,
    parent_id: optionalMappedId(folderIds, row.parent_id),
    name: row.name,
    created_at: row.created_at,
  }))

  for (let index = 0; index < backup.files.length; index += 1) {
    const item = backup.files[index]
    const source = item.record
    const id = mapId(fileIds, source.id)
    const safeName = String(source.file_name).normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '_') || 'arquivo'
    const storagePath = `${campaignId}/files/${crypto.randomUUID()}-${safeName}`
    const metadata = {
      id,
      campaign_id: campaignId,
      folder_id: optionalMappedId(folderIds, source.folder_id),
      storage_path: storagePath,
      file_name: source.file_name,
      mime_type: source.mime_type,
      byte_size: item.byte_size,
      uploaded_by: userId,
      uploaded_at: source.uploaded_at,
    }
    const { error: metadataError } = await db.from('campaign_files').insert(metadata)
    if (metadataError) throw metadataError
    const { error: uploadError } = await db.storage.from('campaign-files').upload(storagePath, objects[index], {
      contentType: String(source.mime_type),
      upsert: false,
    })
    if (uploadError) throw new Error(`Não foi possível restaurar "${source.file_name}": ${uploadError.message}`)
  }

  await insertRows('saved_senders', backup.senders.map((row) => ({
    campaign_id: campaignId,
    email: row.email,
    name: row.name,
  })))

  await restoreEmailRows(db, campaignId, backup.emails, emailIds)

  await insertRows('campaign_email_images', backup.email_images.map((row) => ({
    email_id: mapId(emailIds, row.email_id),
    file_id: mapId(fileIds, row.file_id),
  })))

  await insertRows('campaign_notebooks', backup.notebooks.map((row) => ({
    id: mapId(notebookIds, row.id),
    campaign_id: campaignId,
    name: row.name,
    created_at: row.created_at,
  })))

  await insertRows('campaign_notes', backup.notes.map((row) => ({
    id: mapId(noteIds, row.id),
    campaign_id: campaignId,
    notebook_id: optionalMappedId(notebookIds, row.notebook_id),
    title: row.title,
    body: row.body,
    visibility: row.visibility,
    created_by: userId,
    created_at: row.created_at,
    updated_at: row.updated_at,
  })))

  await insertRows('campaign_events', backup.events.map((row) => ({
    id: mapId(eventIds, row.id),
    campaign_id: campaignId,
    session_id: optionalMappedId(sessionIds, row.session_id),
    title: row.title,
    body: row.body,
    event_type: row.event_type,
    presentation: row.presentation,
    is_temporary: false,
    created_by: userId,
    created_at: row.created_at,
  })))

  await insertRows('campaign_bulletins', backup.bulletins.map((row) => ({
    campaign_id: campaignId,
    title: row.title,
    body: row.body,
    enabled: row.enabled,
    updated_at: row.updated_at,
  })))

  await insertLinkedRows('global_messages', backup.global_messages, messageIds, 'reply_to_id', (row) => ({
    id: mapId(messageIds, row.id),
    campaign_id: campaignId,
    session_id: optionalMappedId(sessionIds, row.session_id),
    author_user_id: userId,
    author_member_id: null,
    author_name: row.author_name,
    reply_to_id: optionalMappedId(messageIds, row.reply_to_id),
    body: row.body,
    created_at: row.created_at,
    edited_at: row.edited_at,
  }))

  await insertRows('campaign_activity_log', backup.activity.map((row) => ({
    campaign_id: campaignId,
    actor_user_id: userId,
    actor_member_id: null,
    activity_type: row.activity_type,
    description: row.description,
    is_temporary: false,
    session_id: optionalMappedId(sessionIds, row.session_id),
    created_at: row.created_at,
  })))
}

function makeIdMap(rows: BackupRow[]) {
  return new Map(rows.map((row) => [requiredId(row.id, 'IDs'), crypto.randomUUID()]))
}

function mapId(idMap: Map<string, string>, oldId: unknown) {
  const id = typeof oldId === 'string' ? idMap.get(oldId) : undefined
  if (!id) throw new Error('Não foi possível remapear um ID relacionado no backup.')
  return id
}

function optionalMappedId(idMap: Map<string, string>, oldId: unknown) {
  return oldId === null || oldId === undefined ? null : mapId(idMap, oldId)
}

async function insertRows(table: string, rows: BackupRow[]) {
  for (let offset = 0; offset < rows.length; offset += 100) {
    const { error } = await client().from(table).insert(rows.slice(offset, offset + 100))
    if (error) throw error
  }
}

async function insertLinkedRows(
  table: string,
  rows: BackupRow[],
  ids: Map<string, string>,
  parentKey: string,
  mapRow: (row: BackupRow) => BackupRow,
) {
  const pending = [...rows]
  const inserted = new Set<string>()
  while (pending.length) {
    const ready = pending.filter((row) => row[parentKey] === null || row[parentKey] === undefined
      || (typeof row[parentKey] === 'string' && inserted.has(row[parentKey])))
    if (!ready.length) throw new Error(`Há referências circulares ou ausentes na seção ${table}.`)
    await insertRows(table, ready.map(mapRow))
    for (const row of ready) {
      const oldId = requiredId(row.id, table)
      inserted.add(oldId)
      pending.splice(pending.indexOf(row), 1)
    }
  }
  if (ids.size !== rows.length) throw new Error(`Não foi possível validar os IDs da seção ${table}.`)
}

async function restoreEmailRows(
  db: ReturnType<typeof client>,
  campaignId: string,
  rows: BackupRow[],
  ids: Map<string, string>,
) {
  const pending = [...rows]
  const inserted = new Set<string>()
  while (pending.length) {
    const ready = pending.filter((row) => row.reply_to_id === null || row.reply_to_id === undefined
      || (typeof row.reply_to_id === 'string' && inserted.has(row.reply_to_id)))
    if (!ready.length) throw new Error('Há referências circulares ou ausentes nas respostas de e-mail.')
    for (const row of ready) {
      const newId = mapId(ids, row.id)
      const { data, error } = await db.rpc('restore_campaign_email', {
        p_campaign_id: campaignId,
        p_email_id: newId,
        p_sender_email: row.sender_email,
        p_sender_name: row.sender_name,
        p_subject: row.subject,
        p_body: row.body,
        p_reply_to_id: optionalMappedId(ids, row.reply_to_id),
        p_sent_at: row.sent_at,
      })
      if (error) throw error
      if (data !== newId) throw new Error('O banco retornou um ID inesperado ao restaurar um e-mail.')
      inserted.add(requiredId(row.id, 'emails'))
      pending.splice(pending.indexOf(row), 1)
    }
  }
}
