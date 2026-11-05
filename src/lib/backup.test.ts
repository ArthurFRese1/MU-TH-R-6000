import { describe, expect, it } from 'vitest'
import { inspectCampaignBackup } from './backup'

const emptyManifest = {
  format: 'MU-TH-R-6000-CAMPAIGN',
  version: 1,
  exported_at: '2026-11-04T00:00:00.000Z',
  campaign: {
    name: 'Campanha de teste',
    description: 'Backup usado nos testes locais.',
    cover_url: null,
  },
  settings: {
    welcome_title: 'Boas-vindas',
    welcome_message: '',
    welcome_enabled: true,
    allow_player_email_replies: false,
    show_ship_clock: true,
    show_energy: true,
    show_oxygen: true,
    show_integrity: true,
  },
  sessions: [],
  global_messages: [],
  senders: [],
  emails: [],
  email_images: [],
  folders: [],
  files: [],
  notebooks: [],
  notes: [],
  events: [],
  bulletins: [],
  activity: [],
}

function makeBackupFile(
  manifest: unknown,
  objects: Blob[] = [],
  magic = 'MUTHR6000\n',
): File {
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest))
  const header = new Uint8Array(14)
  header.set(new TextEncoder().encode(magic), 0)
  new DataView(header.buffer).setUint32(10, manifestBytes.byteLength, false)
  return new File([header, manifestBytes, ...objects], 'test.muthr')
}

describe('inspectCampaignBackup', () => {
  it('accepts a valid empty campaign backup', async () => {
    await expect(inspectCampaignBackup(makeBackupFile(emptyManifest))).resolves.toMatchObject({
      name: 'Campanha de teste',
      sessions: 0,
      emails: 0,
      notes: 0,
      events: 0,
      files: 0,
      fileBytes: 0,
    })
  })

  it('rejects unknown archive magic', async () => {
    await expect(inspectCampaignBackup(makeBackupFile(emptyManifest, [], 'INVALID000\n')))
      .rejects.toThrow('Formato de backup desconhecido')
  })

  it('rejects unsupported manifest versions', async () => {
    const manifest = { ...emptyManifest, version: 2 }
    await expect(inspectCampaignBackup(makeBackupFile(manifest)))
      .rejects.toThrow('Versão de backup não suportada')
  })

  it('rejects unsafe cover URL schemes', async () => {
    const manifest = {
      ...emptyManifest,
      campaign: { ...emptyManifest.campaign, cover_url: 'javascript:alert(1)' },
    }
    await expect(inspectCampaignBackup(makeBackupFile(manifest)))
      .rejects.toThrow('A URL de capa no backup deve usar HTTP ou HTTPS')
  })

  it('rejects missing sections', async () => {
    const { emails: _emails, ...manifest } = emptyManifest
    await expect(inspectCampaignBackup(makeBackupFile(manifest)))
      .rejects.toThrow('A seção emails do backup é inválida')
  })

  it('rejects file types outside the private Storage allowlist', async () => {
    const manifest = {
      ...emptyManifest,
      files: [{
        record: { id: 'file-1', file_name: 'payload.exe', mime_type: 'application/octet-stream', byte_size: 1 },
        byte_size: 1,
      }],
    }
    await expect(inspectCampaignBackup(makeBackupFile(manifest, [new Blob(['x'])])))
      .rejects.toThrow('viola o limite de tipo ou tamanho do Storage')
  })

  it('rejects archives truncated inside a file object', async () => {
    const manifest = {
      ...emptyManifest,
      files: [{
        record: { id: 'file-1', file_name: 'photo.png', mime_type: 'image/png', byte_size: 3 },
        byte_size: 3,
      }],
    }
    await expect(inspectCampaignBackup(makeBackupFile(manifest)))
      .rejects.toThrow('O backup está incompleto no arquivo')
  })

  it('rejects extra bytes beyond the declared objects', async () => {
    await expect(inspectCampaignBackup(makeBackupFile(emptyManifest, [new Blob(['extra'])])))
      .rejects.toThrow('O backup contém dados excedentes ou está corrompido')
  })

  it('rejects dangling email reply references', async () => {
    const manifest = {
      ...emptyManifest,
      emails: [{ id: 'email-1', reply_to_id: 'missing-email' }],
    }
    await expect(inspectCampaignBackup(makeBackupFile(manifest)))
      .rejects.toThrow('Referência inválida: resposta do e-mail')
  })

  it('rejects cyclic folder hierarchies', async () => {
    const manifest = {
      ...emptyManifest,
      folders: [
        { id: 'folder-1', parent_id: 'folder-2' },
        { id: 'folder-2', parent_id: 'folder-1' },
      ],
    }
    await expect(inspectCampaignBackup(makeBackupFile(manifest)))
      .rejects.toThrow('O backup contém referências circulares')
  })
})
