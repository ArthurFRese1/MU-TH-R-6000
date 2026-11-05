import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase, supabaseConfigurationError } from './lib/supabase'
import {
  acknowledgeWelcome,
  dismissCampaignEvent,
  getPlayerCampaigns,
  getPlayerWorkspace,
  getPrivateAnnotation,
  getPrivateFileUrl,
  markEmailRead,
  markEventRead,
  markNotificationRead,
  replyToCampaignEmail,
  getPlayerCharacterSheet,
  getPlayerInterfacePreferences,
  savePlayerCharacterSheet,
  savePlayerInterfacePreferences,
  savePrivateAnnotation,
  updateNoteState,
  type PlayerCampaign,
  type PlayerEmail,
  type PlayerEvent,
  type PlayerCharacterSheet,
  type PlayerInterfacePreferences,
  type PlayerNote,
  type PlayerNotification,
  type PlayerTelemetry,
  type PlayerWorkspace,
} from './lib/player'
import {
  getCampaignSettings,
  invalidateCampaignInvites,
  rotateCampaignInviteSettings,
  saveCampaignGeneral,
  saveCampaignSystemSettings,
  type ActiveCampaignInvite,
  type CampaignSystemSettings,
} from './lib/settings'
import {
  exportCampaignBackup,
  inspectCampaignBackup,
  restoreCampaignBackup,
  type CampaignBackupPreview,
} from './lib/backup'
import {
  createCampaign,
  deleteCampaign,
  getCampaigns,
  getCampaignMembers,
  getInvitePreview,
  joinCampaign,
  removeCampaignMember,
  rotateInvite,
  setCampaignMemberBlocked,
  type Campaign,
  type CampaignMember,
  type InvitePreview,
} from './lib/campaigns'
import {
  endCampaignSession,
  getSessionWorkspace,
  startCampaignSession,
  updateCampaignSession,
  updateSessionSettings,
  type CampaignSession,
  type SessionSettings,
} from './lib/sessions'
import {
  deleteSender,
  getMailWorkspace,
  saveSender,
  setPlayerEmailRepliesAllowed,
  sendCampaignEmail,
  type MailWorkspace,
  type SavedSender,
  type SentEmail,
} from './lib/mail'
import {
  createCampaignNotebook,
  deleteCampaignNotebook,
  deleteCampaignNote,
  getEditorialWorkspace,
  saveCampaignNote,
  sendCampaignEvent,
  type CampaignNotebook,
  type CampaignNoteRecord,
  type EditorialWorkspace,
} from './lib/editorial'
import {
  createCampaignFolder,
  deleteCampaignFile,
  deleteCampaignFolder,
  getFileWorkspace,
  replaceCampaignFile,
  uploadCampaignFile,
  type CampaignFile,
  type CampaignFolder,
  type FileWorkspace,
} from './lib/files'
import {
  getCampaignActivity,
  getCampaignActivityMembers,
  type ActivityScope,
  type CampaignActivity,
} from './lib/activity'
import {
  getCampaignRecoveryRequests,
  getMyIdentityRecoveryRequests,
  identityRecoveryErrorMessage,
  isRecoveryIdentityAlreadyMemberError,
  logIdentityRecoveryError,
  requestIdentityRecovery,
  resolveIdentityRecovery,
  type IdentityRecoveryRequest,
} from './lib/recovery'
import { getEventAlertMigrationHint, getPendingEventAlerts } from './lib/event-alerts'
import {
  clearTypingState,
  deleteChatMessage,
  editChatMessage,
  getCampaignSessionLabels,
  getChatMessages,
  getCurrentCampaignSession,
  getLocalChatAlias,
  getTypingUsers,
  saveLocalChatAlias,
  sendChatMessage,
  setTypingState,
  type ChatMessage,
  type ChatType,
  type ChatTypingUser,
} from './lib/chat'
import { nextWorkspaceMode, type WorkspaceMode } from './lib/workspace-mode'
import { reportDevelopmentError } from './lib/dev-diagnostics'
import { EventAlertOverlay, EventAlertSaveError } from './components/EventAlertOverlay'
import { IdentityRecoveryPopup } from './components/IdentityRecoveryPopup'
import './App.css'

type Notice = { kind: 'success' | 'error'; text: string }

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(!supabase)
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('command')
  const [recoverySession, setRecoverySession] = useState(false)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null)
  const [inviteCode, setInviteCode] = useState(() => new URLSearchParams(location.search).get('invite') ?? '')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'signup' | 'recovery'>('login')
  const [showCreate, setShowCreate] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Campaign | null>(null)
  const [inviteDraft, setInviteDraft] = useState(inviteCode)
  const [clockNow, setClockNow] = useState(() => new Date())
  const [activeInvite, setActiveInvite] = useState<{ campaignId: string; link: string } | null>(null)

  const refreshCampaigns = useCallback(async () => {
    if (!supabase || !user || user.is_anonymous) return
    setCampaigns(await getCampaigns(user.id))
  }, [user])

  useEffect(() => {
    if (!supabase) return
    let active = true
    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) setNotice({ kind: 'error', text: error.message })
      if (!active) return
      setUser(data.session?.user ?? null)
      setWorkspaceMode((current) => nextWorkspaceMode(
        current,
        'INITIAL_SESSION',
        data.session?.user.is_anonymous ?? null,
      ))
      setAuthReady(true)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setRecoverySession(true)
        setAuthMode('recovery')
      }
      setUser(session?.user ?? null)
      if (!session?.user || session.user.is_anonymous) {
        setCampaigns([])
      }
      setWorkspaceMode((current) => nextWorkspaceMode(current, event, session?.user.is_anonymous ?? null))
      setAuthReady(true)
    })
    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    // Surface backend failures from the initial campaign synchronization in the shared notice region.
    // oxlint-disable-next-line react/set-state-in-effect
    void refreshCampaigns().catch((error: unknown) => setNotice({ kind: 'error', text: errorMessage(error) }))
  }, [refreshCampaigns])

  useEffect(() => {
    if (!inviteCode.trim() || !supabase) return
    let active = true
    void getInvitePreview(inviteCode.trim())
      .then((preview) => {
        // The invite lookup is asynchronous; only apply the result for the current code.
        // oxlint-disable-next-line react/set-state-in-effect
        if (active) setInvitePreview(preview)
      })
      .catch((error: unknown) => {
        if (active) {
          setInvitePreview(null)
          setInviteCode('')
          window.history.replaceState({}, '', window.location.pathname)
          setNotice({ kind: 'error', text: errorMessage(error) })
        }
      })
    return () => {
      active = false
    }
  }, [inviteCode])

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true)
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '').trim()
    const password = String(form.get('password') ?? '')
    try {
      if (authMode === 'recovery') {
        if (recoverySession) {
          if (password !== String(form.get('confirmPassword') ?? '')) {
            throw new Error('A confirmação da senha não corresponde.')
          }
          const { error } = await supabase.auth.updateUser({ password })
          if (error) throw error
          setRecoverySession(false)
          setAuthMode('login')
          setNotice({ kind: 'success', text: 'Senha atualizada com sucesso.' })
        } else {
          const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + window.location.pathname,
          })
          if (error) throw error
          setNotice({ kind: 'success', text: 'Se a conta estiver cadastrada, você receberá as instruções de recuperação.' })
        }
      } else if (authMode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setNotice({ kind: 'success', text: 'Cadastro enviado. Confirme seu e-mail para ativar a conta.' })
        setAuthMode('login')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  async function handleCreateCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') ?? '').trim()
    const description = String(form.get('description') ?? '').trim()
    if (!name) return
    setBusy(true)
    try {
      const campaign = await createCampaign({ name, description })
      await refreshCampaigns()
      setShowCreate(false)
      setSelectedCampaign(campaign)
      setNotice({ kind: 'success', text: 'Campanha criada e convite gerado.' })
    } catch (error) {
      reportDevelopmentError('Criar campanha', error)
      setNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !invitePreview) return
    const form = new FormData(event.currentTarget)
    const playerName = String(form.get('playerName') ?? '').trim()
    const fakeEmail = String(form.get('fakeEmail') ?? '').trim()
    setBusy(true)
    try {
      let currentUser = user
      if (!currentUser) {
        const { data, error } = await supabase.auth.signInAnonymously()
        if (error) throw error
        currentUser = data.user
        setUser(data.user)
      }
      if (!currentUser) throw new Error('Não foi possível iniciar uma sessão anônima.')
      await joinCampaign(inviteCode.trim(), playerName, fakeEmail)
      setWorkspaceMode('crew')
      setInviteCode('')
      setInviteDraft('')
      setInvitePreview(null)
      window.history.replaceState({}, '', window.location.pathname)
      setNotice({ kind: 'success', text: `Participação de jogador autorizada na campanha ${invitePreview.name}.` })
    } catch (error) {
      reportDevelopmentError('Entrar em campanha pelo convite', error)
      setNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  async function handleRequestRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!invitePreview) return
    if (!supabase) {
      setNotice({ kind: 'error', text: supabaseConfigurationError ?? 'Supabase não está configurado.' })
      return
    }
    const form = new FormData(event.currentTarget)
    const fakeEmail = String(form.get('fakeEmail') ?? '').trim()
    setBusy(true)
    let stage = 'iniciar sessão anônima'
    try {
      let currentUser = user
      if (!currentUser) {
        const { data, error } = await supabase.auth.signInAnonymously()
        if (error) throw error
        currentUser = data.user
        setUser(data.user)
      }
      if (!currentUser?.is_anonymous) {
        throw new Error('A recuperação deve ser solicitada por uma identidade anônima de jogador.')
      }
      stage = 'registrar solicitação no Supabase'
      try {
        await requestIdentityRecovery(invitePreview.id, fakeEmail)
      } catch (error) {
        if (!isRecoveryIdentityAlreadyMemberError(error)) throw error

        stage = 'criar nova identidade anônima para recuperação'
        const { data: previousSessionData, error: previousSessionError } = await supabase.auth.getSession()
        if (previousSessionError) throw previousSessionError
        const { data, error: authError } = await supabase.auth.signInAnonymously()
        if (authError) throw authError
        if (!data.user?.is_anonymous) {
          throw new Error('Não foi possível iniciar uma nova identidade anônima para a recuperação.')
        }
        setUser(data.user)

        stage = 'repetir solicitação com a nova identidade'
        try {
          await requestIdentityRecovery(invitePreview.id, fakeEmail)
        } catch (retryError) {
          if (previousSessionData.session) {
            stage = 'restaurar sessão anterior após falha da solicitação'
            const { error: restoreError } = await supabase.auth.setSession({
              access_token: previousSessionData.session.access_token,
              refresh_token: previousSessionData.session.refresh_token,
            })
            if (restoreError) throw restoreError
          }
          throw retryError
        }
      }
      setInviteCode('')
      setInviteDraft('')
      setInvitePreview(null)
      window.history.replaceState({}, '', window.location.pathname)
      setNotice({ kind: 'success', text: 'Solicitação enviada. A antiga identidade manterá os dados até a decisão do mestre.' })
    } catch (error) {
      logIdentityRecoveryError(stage, error)
      setNotice({ kind: 'error', text: identityRecoveryErrorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteCampaign() {
    if (!pendingDelete) return
    setBusy(true)
    try {
      await deleteCampaign(pendingDelete.id)
      setCampaigns((current) => current.filter((campaign) => campaign.id !== pendingDelete.id))
      if (selectedCampaign?.id === pendingDelete.id) setSelectedCampaign(null)
      if (activeInvite?.campaignId === pendingDelete.id) setActiveInvite(null)
      setNotice({ kind: 'success', text: 'Campanha e dados vinculados foram removidos.' })
      setPendingDelete(null)
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    if (!supabase) return
    setBusy(true)
    const { error } = await supabase.auth.signOut()
    if (error) setNotice({ kind: 'error', text: error.message })
    else {
      setSelectedCampaign(null)
      setNotice({ kind: 'success', text: 'Sessão encerrada.' })
    }
    setBusy(false)
  }

  async function copyInvite(campaignId: string) {
    setBusy(true)
    try {
      const code = await rotateInvite(campaignId)
      const link = `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(code)}`
      setActiveInvite({ campaignId, link })
      try {
        await copyText(link)
        setNotice({ kind: 'success', text: 'Convite renovado e link copiado para a área de transferência.' })
      } catch {
        setNotice({ kind: 'error', text: `O novo convite foi gerado, mas não foi possível copiá-lo. Copie o link exibido no painel: ${link}` })
      }
    } catch (error) {
      setNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  if (!authReady) return <LoadingScreen />
  if (user?.is_anonymous && !invitePreview && !inviteCode.trim()) {
    return <PlayerAccess user={user} onSignOut={signOut} externalNotice={notice} />
  }
  if (user && !user.is_anonymous && workspaceMode === 'crew' && !invitePreview && !inviteCode.trim()) {
    return <PlayerAccess user={user} onSignOut={signOut} onSwitchToCommand={() => setWorkspaceMode('command')} externalNotice={notice} />
  }

  return (
    <main className="station-shell">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => setSelectedCampaign(null)} aria-label="Ir ao início">
          <span className="brand-mark" aria-hidden="true">M</span>
          <span><strong>MU/TH/R 6000</strong><small>COMPUTADOR DE BORDO // SISTEMA DE CAMPANHAS</small></span>
        </button>
        <div className="topbar-status"><span className="status-dot" /> SISTEMA {supabase ? 'CONFIGURADO' : 'SEM CONFIGURAÇÃO'}</div>
        {user && !user.is_anonymous && <button className="quiet-button" type="button" onClick={() => setWorkspaceMode('crew')}>TRIPULAÇÃO</button>}
        {user && <button className="quiet-button" type="button" onClick={() => void signOut()} disabled={busy}>ENCERRAR SESSÃO</button>}
      </header>

      <section className="system-strip" aria-label="Estado do sistema">
        <span>MU/TH/R — TERMINAL DE OPERAÇÕES</span>
        <span>SETOR {workspaceMode === 'crew' || user?.is_anonymous ? 'TRIPULAÇÃO' : 'COMANDO'}</span>
        <time>{new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(clockNow)}</time>
      </section>

      {notice && <div className={`notice notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
        <span>{notice.text}</span>
        <button type="button" aria-label="Fechar aviso" onClick={() => setNotice(null)}>×</button>
      </div>}

      {!supabase ? <ConfigurationNotice message={supabaseConfigurationError} /> : recoverySession ? (
        <AuthView mode="recovery" recoverySession inviteDraft={inviteDraft} setInviteDraft={setInviteDraft} onValidateInvite={() => setInviteCode(inviteDraft.trim())} setMode={setAuthMode} onSubmit={handleAuth} busy={busy} />
      ) : invitePreview ? (
        <InviteView preview={invitePreview} code={inviteCode} onCancel={() => {
          setInviteCode('')
          setInviteDraft('')
          setInvitePreview(null)
          window.history.replaceState({}, '', window.location.pathname)
        }} onJoin={handleJoin} onRequestRecovery={handleRequestRecovery} busy={busy} user={user} />
      ) : user?.is_anonymous ? (
        <PlayerAccess user={user} onSignOut={signOut} externalNotice={notice} />
      ) : user ? (
        <section className="workspace">
          <aside className="side-rail">
            <p className="eyebrow">NAVEGAÇÃO</p>
            <button type="button" className={`nav-item ${selectedCampaign ? '' : 'active'}`} onClick={() => setSelectedCampaign(null)}>
              <span className="nav-glyph">⌂</span> Central de comando
            </button>
            <div className="rail-rule" />
            <p className="eyebrow">CAMPANHAS</p>
            {campaigns.map((campaign) => <button key={campaign.id} type="button" className={`nav-item ${selectedCampaign?.id === campaign.id ? 'active' : ''}`} onClick={() => setSelectedCampaign(campaign)}>
              <span className="nav-glyph">▣</span><span className="truncate">{campaign.name}</span>
            </button>)}
            <button className="nav-item nav-create" type="button" onClick={() => setShowCreate(true)}><span className="nav-glyph">＋</span> Nova campanha</button>
            <div className="rail-footer"><span>IDENTIDADE</span><strong>{user.email}</strong></div>
          </aside>

          <div className="main-panel">
            {selectedCampaign
              ? <CampaignDetail campaign={selectedCampaign} onBack={() => setSelectedCampaign(null)} onNotice={setNotice} onInviteLinkChange={(link) => setActiveInvite((current) => link ? { campaignId: selectedCampaign.id, link } : current?.campaignId === selectedCampaign.id ? null : current)} onCampaignUpdated={(patch) => {
                setCampaigns((current) => current.map((item) => item.id === selectedCampaign.id ? { ...item, ...patch } : item))
                setSelectedCampaign((current) => current?.id === selectedCampaign.id ? { ...current, ...patch } : current)
              }} onCampaignImported={(imported) => {
                setCampaigns((current) => [imported, ...current.filter((item) => item.id !== imported.id)])
                setSelectedCampaign(imported)
              }} onCopy={() => void copyInvite(selectedCampaign.id)} inviteLink={activeInvite?.campaignId === selectedCampaign.id ? activeInvite.link : null} onCopyExisting={() => {
                if (!activeInvite || activeInvite.campaignId !== selectedCampaign.id) return
                void copyText(activeInvite.link)
                  .then(() => setNotice({ kind: 'success', text: 'Link copiado.' }))
                  .catch((error: unknown) => setNotice({ kind: 'error', text: errorMessage(error) }))
              }} onDelete={() => setPendingDelete(selectedCampaign)} busy={busy} userId={user.id} />
              : <CommandCenter campaigns={campaigns} onCreate={() => setShowCreate(true)} onOpen={setSelectedCampaign} />}
          </div>
          <aside className="telemetry-panel">
            <p className="eyebrow">TELEMETRIA</p>
            <div className="telemetry-line"><span>CLIENTE</span><strong className="good-value">CONFIGURADO</strong></div>
            <div className="telemetry-line"><span>IDENTIDADE</span><strong>COMANDO</strong></div>
            <div className="telemetry-line"><span>CAMPANHAS</span><strong>{campaigns.length.toString().padStart(2, '0')}</strong></div>
            <div className="telemetry-note">Os dados são sincronizados pelo Supabase com políticas de acesso no banco.</div>
          </aside>
        </section>
      ) : (
        <AuthView
          mode={authMode}
          setMode={setAuthMode}
          onSubmit={handleAuth}
          busy={busy}
          inviteDraft={inviteDraft}
          setInviteDraft={setInviteDraft}
          onValidateInvite={() => setInviteCode(inviteDraft.trim())}
        />
      )}

      {showCreate && <Modal title="REGISTRAR NOVA CAMPANHA" onClose={() => setShowCreate(false)}>
        <form className="form-stack" onSubmit={(event) => void handleCreateCampaign(event)}>
          <label>Nome da campanha<input name="name" required maxLength={100} autoFocus placeholder="Ex.: Ecos de LV-426" /></label>
          <label>Descrição <span className="optional">(opcional)</span><textarea name="description" rows={3} maxLength={1000} placeholder="Uma breve descrição para identificar a operação." /></label>
          <p className="form-hint">Um convite inicial exclusivo será criado. As opções de validade e limite serão configuradas no painel completo de convites.</p>
          <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setShowCreate(false)}>CANCELAR</button><button className="primary-button" disabled={busy}>{busy ? 'CRIANDO…' : 'CRIAR CAMPANHA'}</button></div>
        </form>
      </Modal>}

      {pendingDelete && <Modal title="EXCLUIR CAMPANHA" onClose={() => setPendingDelete(null)}>
        <p className="dialog-copy">A campanha <strong>{pendingDelete.name}</strong> e todos os dados associados serão excluídos permanentemente. Esta operação não pode ser desfeita.</p>
        <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setPendingDelete(null)}>MANTER CAMPANHA</button><button className="danger-button" type="button" onClick={() => void handleDeleteCampaign()} disabled={busy}>{busy ? 'EXCLUINDO…' : 'EXCLUIR DEFINITIVAMENTE'}</button></div>
      </Modal>}

      <footer className="footer"><span>MU/TH/R 6000</span><span>ACESSO RESTRITO // OPERAÇÃO EM REGISTRO</span><span>© 2026</span></footer>
    </main>
  )
}

function AuthView({ mode, setMode, onSubmit, busy, inviteDraft, setInviteDraft, onValidateInvite, recoverySession = false }: {
  mode: 'login' | 'signup' | 'recovery'
  setMode: (mode: 'login' | 'signup' | 'recovery') => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  busy: boolean
  inviteDraft: string
  setInviteDraft: (code: string) => void
  onValidateInvite: () => void
  recoverySession?: boolean
}) {
  return <section className="auth-layout">
    <div className="welcome-panel">
      <p className="eyebrow">TERMINAL CENTRAL // INICIALIZAÇÃO</p>
      <h1>O espaço é vasto.<br /><span>A operação é sua.</span></h1>
      <p>Gerencie campanhas, tripulações e comunicações em um único computador de bordo.</p>
      <div className="welcome-readout"><span>PROTOCOLO DE SEGURANÇA</span><strong>ATIVO // POLÍTICAS NO BANCO</strong></div>
    </div>
    <div className="auth-card">
      <div className="section-heading"><span className="section-index">01</span><div>      <p className="eyebrow">{mode === 'signup' ? 'NOVO REGISTRO' : mode === 'recovery' ? 'RECUPERAÇÃO DE ACESSO' : 'IDENTIFICAÇÃO'}</p><h2>{mode === 'signup' ? 'Criar conta de mestre' : mode === 'recovery' ? recoverySession ? 'Defina uma nova senha' : 'Redefinir senha' : 'Acesso do mestre'}</h2></div></div>
      <form className="form-stack" onSubmit={onSubmit}>
        {!(mode === 'recovery' && recoverySession) && <label>E-mail<input type="email" name="email" required autoComplete="email" placeholder="comando@exemplo.com" /></label>}
        {(mode !== 'recovery' || recoverySession) && <label>{mode === 'recovery' ? 'Nova senha' : 'Senha'}<input type="password" name="password" required minLength={8} autoComplete={mode === 'signup' || recoverySession ? 'new-password' : 'current-password'} placeholder="Mínimo de 8 caracteres" /></label>}
        {mode === 'recovery' && recoverySession && <label>Confirmar nova senha<input type="password" name="confirmPassword" required minLength={8} autoComplete="new-password" placeholder="Digite novamente a nova senha" /></label>}
        <button className="primary-button auth-submit" disabled={busy}>{busy ? 'AGUARDE…' : mode === 'signup' ? 'CRIAR CONTA' : mode === 'recovery' ? recoverySession ? 'ATUALIZAR SENHA' : 'ENVIAR INSTRUÇÕES' : 'ENTRAR NO SISTEMA'}<span aria-hidden="true">→</span></button>
      </form>
      {!recoverySession && <div className="auth-links">
        {mode === 'login' ? <>
          <button type="button" onClick={() => setMode('signup')}>Criar conta de mestre</button>
          <button type="button" onClick={() => setMode('recovery')}>Esqueci minha senha</button>
        </> : <button type="button" onClick={() => setMode('login')}>Voltar para entrar</button>}
      </div>}
      <div className="invite-access">
        <p className="eyebrow">ACESSO DA TRIPULAÇÃO</p>
        <p>Recebeu um convite? Informe o código para continuar.</p>
        <form className="invite-code-form" onSubmit={(event) => { event.preventDefault(); onValidateInvite() }}>
          <input name="invite" value={inviteDraft} onChange={(event) => setInviteDraft(event.target.value)} aria-label="Código de convite" placeholder="CÓDIGO DE CONVITE" />
          <button className="secondary-button" type="submit">VALIDAR</button>
        </form>
      </div>
    </div>
  </section>
}

function InviteView({ preview, code, onCancel, onJoin, onRequestRecovery, busy, user }: {
  preview: InvitePreview
  code: string
  onCancel: () => void
  onJoin: (event: FormEvent<HTMLFormElement>) => void
  onRequestRecovery: (event: FormEvent<HTMLFormElement>) => void
  busy: boolean
  user: User | null
}) {
  const [recoveryMode, setRecoveryMode] = useState(false)
  return <main className="simple-screen"><div className="invite-card">
    <p className="eyebrow">CONVITE DE CAMPANHA // ACESSO RESTRITO</p>{safeImageUrl(preview.cover_url) && <img className="campaign-cover invite-cover" src={safeImageUrl(preview.cover_url) ?? undefined} alt={`Capa de ${preview.name}`} />}<h1>{preview.name}</h1>
    {preview.description && <p className="campaign-description">{preview.description}</p>}
    <p className="invite-explainer">{recoveryMode ? 'Peça ao mestre para transferir sua participação anterior. O acesso só muda depois da aprovação.' : user && !user.is_anonymous ? 'Sua conta atual continuará conectada. Informe o nome de jogador e o e-mail fictício desta participação.' : 'Sua identidade de jogador será privada e independente para esta campanha.'}</p>
    <form className="form-stack" onSubmit={recoveryMode ? onRequestRecovery : onJoin}>
      {!recoveryMode && <label>Seu nome<input name="playerName" required maxLength={60} autoComplete="nickname" /></label>}
      <label>E-mail de identificação<input name="fakeEmail" type="email" required pattern="[^@\s]+@gmail\.com" title="Use um endereço fictício terminado em @gmail.com." placeholder="personagem@gmail.com" autoComplete="off" /></label>
      <p className="form-hint">{recoveryMode ? 'Use o e-mail fictício exato da participação a recuperar; isso não concede acesso automaticamente.' : 'Este endereço é apenas um identificador interno; nenhum e-mail será enviado.'}</p>
      <button className="primary-button" disabled={busy}>{busy ? 'VALIDANDO…' : recoveryMode ? 'SOLICITAR RECUPERAÇÃO' : 'ENTRAR NA CAMPANHA'}</button>
    </form>
    <div className="invite-card-links">
      {(!user || user.is_anonymous) && <button className="text-button" type="button" onClick={() => setRecoveryMode((value) => !value)}>{recoveryMode ? 'CRIAR UMA NOVA PARTICIPAÇÃO' : 'PERDI O ACESSO À MINHA PARTICIPAÇÃO'}</button>}
      <button className="text-button" type="button" onClick={onCancel}>Cancelar e voltar</button>
    </div>
    <span className="invite-code-label">CONVITE {code.slice(0, 8).toUpperCase()}</span>
  </div></main>
}

function PlayerAccess({ user, onSignOut, onSwitchToCommand, externalNotice }: {
  user: User
  onSignOut: () => void
  onSwitchToCommand?: () => void
  externalNotice: Notice | null
}) {
  const [campaigns, setCampaigns] = useState<PlayerCampaign[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [workspace, setWorkspace] = useState<PlayerWorkspace | null>(null)
  const [workspaceLoadedFor, setWorkspaceLoadedFor] = useState<string | null>(null)
  const [workspaceLoadError, setWorkspaceLoadError] = useState<{ campaignId: string; message: string; hint: string | null } | null>(null)
  const [workspaceReloadAttempt, setWorkspaceReloadAttempt] = useState(0)
  const [activeContent, setActiveContent] = useState<{ type: 'email' | 'note' | 'event'; id: string } | null>(null)
  const [activeView, setActiveView] = useState<'home' | 'emails' | 'notes' | 'events' | 'files' | 'globalChat' | 'localChat' | 'sheet' | 'preferences'>('home')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [annotation, setAnnotation] = useState('')
  const [notice, setNotice] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [interfacePreferences, setInterfacePreferences] = useState<PlayerInterfacePreferences>({
    sidebar_position: 'left',
    sidebar_collapsed: false,
    information_panel_order: ['identity', 'campaign', 'telemetry'],
  })
  const [preferencesBusy, setPreferencesBusy] = useState(false)
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [chatUnread, setChatUnread] = useState<{ global: number; local: number }>({ global: 0, local: 0 })
  const [locallyDismissedEventIds, setLocallyDismissedEventIds] = useState<Set<string>>(() => new Set())
  const [eventDismissalError, setEventDismissalError] = useState<{ eventId: string; message: string } | null>(null)
  const [realtimeState, setRealtimeState] = useState<{ campaignId: string; status: 'connected' | 'disconnected' } | null>(null)
  const [recoveryStatus, setRecoveryStatus] = useState<'none' | 'pending' | 'rejected'>('none')
  const currentCampaign = campaigns.find((campaign) => campaign.id === selectedId) ?? null

  const reloadWorkspace = useCallback(async () => {
    if (!currentCampaign) return
    const data = await getPlayerWorkspace(currentCampaign.id, currentCampaign.memberId)
    setWorkspace(data)
  }, [currentCampaign])

  useEffect(() => {
    let active = true
    void getPlayerCampaigns(user.id)
      .then((result) => {
        if (!active) return
        setCampaigns(result)
        setSelectedId((current) => current && result.some((campaign) => campaign.id === current) ? current : result[0]?.id ?? '')
      })
      .catch((cause: unknown) => { if (active) setError(errorMessage(cause)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [user.id])

  useEffect(() => {
    if (loading || campaigns.length > 0) return
    let active = true
    let polling = false
    async function checkRecovery() {
      if (polling) return
      polling = true
      try {
        const requests = await getMyIdentityRecoveryRequests()
        if (!active) return
        const latest = requests[0]
        setRecoveryStatus(latest?.status === 'pending' ? 'pending' : latest?.status === 'rejected' ? 'rejected' : 'none')
        if (latest?.status === 'pending') {
          const access = await getPlayerCampaigns(user.id)
          if (active && access.length) {
            setCampaigns(access)
            setSelectedId(access[0]?.id ?? '')
            setRecoveryStatus('none')
          }
        }
      } catch (cause) {
        if (active) setError(errorMessage(cause))
      } finally {
        polling = false
      }
    }
    void checkRecovery()
    const timer = window.setInterval(() => void checkRecovery(), 5000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [campaigns.length, loading, user.id])

  useEffect(() => {
    if (!currentCampaign || (currentCampaign.welcomeEnabled && !currentCampaign.welcomeAcknowledged)) return
    let active = true
    void getPlayerWorkspace(currentCampaign.id, currentCampaign.memberId)
      .then((data) => {
        if (!active) return
        setWorkspace(data)
        setWorkspaceLoadedFor(currentCampaign.id)
        setWorkspaceLoadError(null)
      })
      .catch((cause: unknown) => {
        if (!active) return
        setWorkspaceLoadError({
          campaignId: currentCampaign.id,
          message: errorMessage(cause),
          hint: getEventAlertMigrationHint(cause),
        })
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [currentCampaign, workspaceReloadAttempt])

  useEffect(() => {
    if (!currentCampaign) return
    let active = true
    void getPlayerInterfacePreferences(currentCampaign.memberId)
      .then((preferences) => {
        if (!active) return
        setInterfacePreferences(preferences)
        setSidebarOpen(!preferences.sidebar_collapsed)
      })
      .catch((cause: unknown) => { if (active) setError(errorMessage(cause)) })
    return () => { active = false }
  }, [currentCampaign])

  useEffect(() => {
    if (!currentCampaign || !supabase || (currentCampaign.welcomeEnabled && !currentCampaign.welcomeAcknowledged)) return
    const realtimeClient = supabase
    let active = true
    const channel = supabase.channel(`player-notifications-${currentCampaign.memberId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'campaign_notifications',
        filter: `member_id=eq.${currentCampaign.memberId}`,
      }, () => {
        if (active) void reloadWorkspace().catch((cause: unknown) => setError(errorMessage(cause)))
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'campaign_sessions',
        filter: `campaign_id=eq.${currentCampaign.id}`,
      }, () => {
        if (active) void reloadWorkspace().catch((cause: unknown) => setError(errorMessage(cause)))
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'campaign_settings',
        filter: `campaign_id=eq.${currentCampaign.id}`,
      }, () => {
        if (active) void reloadWorkspace().catch((cause: unknown) => setError(errorMessage(cause)))
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'global_messages',
        filter: `campaign_id=eq.${currentCampaign.id}`,
      }, (payload) => {
        if (active && payload.new.author_user_id !== user.id && activeView !== 'globalChat') {
          setChatUnread((count) => ({ ...count, global: count.global + 1 }))
          setNotice('Nova mensagem no canal global.')
        }
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'local_messages',
        filter: `campaign_id=eq.${currentCampaign.id}`,
      }, (payload) => {
        if (active && payload.new.author_user_id !== user.id && activeView !== 'localChat') {
          setChatUnread((count) => ({ ...count, local: count.local + 1 }))
          setNotice('Nova mensagem no canal local.')
        }
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setRealtimeState({ campaignId: currentCampaign.id, status: 'disconnected' })
          setNotice('A sincronização em tempo real foi interrompida. Tentando restabelecer a conexão.')
        } else if (status === 'CLOSED') {
          setRealtimeState({ campaignId: currentCampaign.id, status: 'disconnected' })
        } else if (status === 'SUBSCRIBED') {
          setRealtimeState({ campaignId: currentCampaign.id, status: 'connected' })
          setNotice('')
          if (active) void reloadWorkspace().catch((cause: unknown) => setError(errorMessage(cause)))
        }
      })
    return () => {
      active = false
      void realtimeClient.removeChannel(channel)
    }
  }, [activeView, currentCampaign, reloadWorkspace, user.id])

  useEffect(() => {
    if (!currentCampaign || activeContent?.type !== 'note') return
    let active = true
    void getPrivateAnnotation(activeContent.id, currentCampaign.memberId)
      .then((value) => { if (active) setAnnotation(value) })
      .catch((cause: unknown) => { if (active) setError(errorMessage(cause)) })
    return () => { active = false }
  }, [activeContent, currentCampaign])

  const activeEmail = activeContent?.type === 'email' ? workspace?.emails.find((item) => item.id === activeContent.id) : undefined
  const activeNote = activeContent?.type === 'note' ? workspace?.notes.find((item) => item.id === activeContent.id) : undefined
  const activeEvent = activeContent?.type === 'event' ? workspace?.events.find((item) => item.id === activeContent.id) : undefined
  const unreadNotifications = workspace?.notifications.filter((item) => !item.read_at) ?? []
  const pendingEventAlerts = getPendingEventAlerts(
    workspaceLoadedFor === currentCampaign?.id ? workspace?.events ?? [] : [],
  ).filter((event) => !locallyDismissedEventIds.has(event.id))
  const currentRealtimeStatus = currentCampaign && realtimeState?.campaignId === currentCampaign.id
    ? realtimeState.status
    : 'connecting'
  const currentWorkspaceLoadError = workspaceLoadError?.campaignId === currentCampaign?.id
    ? workspaceLoadError
    : null

  async function closeEventAlert(eventId: string) {
    if (!currentCampaign) return
    setLocallyDismissedEventIds((current) => new Set(current).add(eventId))
    try {
      await dismissCampaignEvent(eventId)
      const dismissedAt = new Date().toISOString()
      setWorkspace((current) => current ? {
        ...current,
        events: current.events.map((event) => event.id === eventId ? { ...event, dismissed_at: dismissedAt } : event),
      } : current)
      setEventDismissalError((current) => current?.eventId === eventId ? null : current)
    } catch (cause) {
      setEventDismissalError({ eventId, message: errorMessage(cause) })
    }
  }

  function retryWorkspaceSync() {
    if (!currentCampaign) return
    setWorkspaceLoadError(null)
    setError(null)
    setWorkspaceLoadedFor(null)
    setLoading(true)
    setWorkspaceReloadAttempt((attempt) => attempt + 1)
  }

  async function acknowledgeCampaignWelcome() {
    if (!currentCampaign) return
    setBusy(true)
    try {
      await acknowledgeWelcome(currentCampaign.memberId)
      setCampaigns((current) => current.map((campaign) => campaign.id === currentCampaign.id ? { ...campaign, welcomeAcknowledged: true } : campaign))
      setNotice('Mensagem de entrada confirmada.')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  async function saveInterfacePreferences(preferences: PlayerInterfacePreferences) {
    if (!currentCampaign) return
    setPreferencesBusy(true)
    try {
      await savePlayerInterfacePreferences(currentCampaign.memberId, preferences)
      setInterfacePreferences(preferences)
      setSidebarOpen(!preferences.sidebar_collapsed)
      setNotice('Preferências de interface salvas nesta campanha.')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPreferencesBusy(false)
    }
  }

  async function toggleMailSidebar(collapsed: boolean) {
    await saveInterfacePreferences({ ...interfacePreferences, sidebar_collapsed: collapsed })
  }

  async function selectEmail(email: PlayerEmail) {
    if (!currentCampaign) return
    setActiveContent({ type: 'email', id: email.id })
    setActiveView('emails')
    if (!email.read_at) {
      try {
        await markEmailRead(email.id, currentCampaign.memberId)
        await reloadWorkspace()
      } catch (cause) { setError(errorMessage(cause)) }
    }
  }

  async function sendEmailReply(email: PlayerEmail, body: string): Promise<boolean> {
    if (!workspace?.allowPlayerEmailReplies) {
      setError('O mestre não habilitou respostas a e-mails nesta campanha.')
      return false
    }
    setBusy(true)
    try {
      await replyToCampaignEmail(email.id, body)
      setNotice('Resposta enviada ao mestre.')
      await reloadWorkspace()
      return true
    } catch (cause) {
      setError(errorMessage(cause))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function selectEvent(item: PlayerEvent) {
    if (!currentCampaign) return
    setActiveContent({ type: 'event', id: item.id })
    setActiveView('events')
    if (!item.read_at) {
      try {
        await markEventRead(item.id, currentCampaign.memberId)
        await reloadWorkspace()
      } catch (cause) { setError(errorMessage(cause)) }
    }
  }

  async function selectNote(item: PlayerNote) {
    if (!currentCampaign) return
    setActiveContent({ type: 'note', id: item.id })
    setActiveView('notes')
    if (!item.read_at) {
      try {
        await updateNoteState({ noteId: item.id, memberId: currentCampaign.memberId, readAt: new Date().toISOString() })
        await reloadWorkspace()
      } catch (cause) { setError(errorMessage(cause)) }
    }
  }

  async function openNotification(item: PlayerNotification) {
    if (!workspace) return
    try {
      if (item.content_type === 'email') {
        const target = workspace.emails.find((email) => email.id === item.content_id)
        if (target) await selectEmail(target)
      } else if (item.content_type === 'note') {
        const target = workspace.notes.find((note) => note.id === item.content_id)
        if (target) await selectNote(target)
      } else if (item.content_type === 'event') {
        const target = workspace.events.find((event) => event.id === item.content_id)
        if (target) await selectEvent(target)
      } else if (item.content_type === 'file' && item.content_id) {
        if (!supabase) return
        const { data: file, error: fileError } = await supabase.from('campaign_files')
          .select('storage_path')
          .eq('id', item.content_id)
          .maybeSingle()
        if (fileError) throw fileError
        if (file) {
          setActiveView('files')
          await openFile(file.storage_path, false)
        }
      } else {
        setNotice('Este aviso permanece disponível na lista de notificações.')
      }
      if (!item.read_at) await markNotificationRead(item.id)
      await reloadWorkspace()
    } catch (cause) { setError(errorMessage(cause)) }
  }

  async function handleNoteState(note: PlayerNote, action: 'read' | 'archive') {
    if (!currentCampaign) return
    setBusy(true)
    try {
      await updateNoteState({
        noteId: note.id,
        memberId: currentCampaign.memberId,
        ...(action === 'read' ? { readAt: note.read_at ?? new Date().toISOString() } : { archivedAt: new Date().toISOString() }),
      })
      await reloadWorkspace()
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }

  async function saveAnnotation() {
    if (!currentCampaign || !activeNote) return
    setBusy(true)
    try {
      await savePrivateAnnotation(activeNote.id, currentCampaign.memberId, annotation)
      setNotice('Anotação privada salva. Somente você pode consultá-la.')
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setBusy(false) }
  }

  async function openFile(storagePath: string, newTab: boolean) {
    try {
      const signedUrl = await getPrivateFileUrl(storagePath)
      if (newTab) window.open(signedUrl, '_blank', 'noopener,noreferrer')
      else setFileUrl(signedUrl)
    } catch (cause) { setError(errorMessage(cause)) }
  }

  if (loading && campaigns.length === 0) return <main className="simple-screen"><div className="loading-state"><span className="loading-mark">M</span><p>CARREGANDO PARTICIPAÇÕES…</p></div></main>
  if (error && campaigns.length === 0) return <main className="simple-screen"><div className="simple-card"><p className="eyebrow">FALHA DE SINCRONIZAÇÃO</p><h1>Não foi possível carregar as campanhas</h1><p>{error}</p><button className="secondary-button" type="button" onClick={() => { setError(null); setLoading(true); void getPlayerCampaigns(user.id).then(setCampaigns).catch((cause: unknown) => setError(errorMessage(cause))).finally(() => setLoading(false)) }}>TENTAR NOVAMENTE</button><button className="text-button" type="button" onClick={onSignOut}>ENCERRAR SESSÃO</button></div></main>
  if (campaigns.length === 0) return <main className="simple-screen"><div className="simple-card"><p className="eyebrow">{recoveryStatus === 'pending' ? 'RECUPERAÇÃO // AGUARDANDO AUTORIZAÇÃO' : recoveryStatus === 'rejected' ? 'RECUPERAÇÃO // NÃO AUTORIZADA' : 'PARTICIPAÇÃO NÃO ENCONTRADA'}</p><h1>{recoveryStatus === 'pending' ? 'Solicitação enviada ao mestre' : recoveryStatus === 'rejected' ? 'A solicitação de recuperação foi recusada' : 'Você ainda não participa de uma campanha'}</h1><p>{recoveryStatus === 'pending' ? 'A participação antiga e seus dados permanecem intactos. Esta tela verifica automaticamente quando o mestre autorizar a transferência.' : recoveryStatus === 'rejected' ? 'Se ainda precisar de acesso, peça um novo convite ao mestre e envie outra solicitação ou entre com uma participação diferente.' : 'Abra um convite válido para informar seu nome de jogador e seu e-mail fictício.'}</p><p className="member-id">ID DA IDENTIDADE // {user.id.slice(0, 8).toUpperCase()}</p>{onSwitchToCommand && <button className="secondary-button" type="button" onClick={onSwitchToCommand}>VOLTAR AO COMANDO</button>}<button className="text-button" type="button" onClick={onSignOut}>ENCERRAR SESSÃO</button></div></main>

  if (currentCampaign?.welcomeEnabled && !currentCampaign.welcomeAcknowledged) return <main className="station-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">M</span><span><strong>MU/TH/R 6000</strong><small>CANAL DE COMUNICAÇÃO // TRIPULAÇÃO</small></span></div>{onSwitchToCommand && <button className="quiet-button" type="button" onClick={onSwitchToCommand}>COMANDO</button>}<button className="quiet-button" type="button" onClick={onSignOut}>ENCERRAR SESSÃO</button></header>
    {externalNotice && <div className={`notice notice-${externalNotice.kind}`} role={externalNotice.kind === 'error' ? 'alert' : 'status'}><span>{externalNotice.text}</span></div>}
    <main className="simple-screen"><section className="welcome-card"><p className="eyebrow">COMUNICADO DE ENTRADA // {currentCampaign.name}</p><h1>{currentCampaign.welcomeTitle}</h1><p className="welcome-player-name">Tripulante {currentCampaign.playerName}</p><div className="welcome-message">{currentCampaign.welcomeMessage || 'Nenhuma mensagem adicional foi configurada pelo mestre.'}</div><button className="primary-button" type="button" disabled={busy} onClick={() => void acknowledgeCampaignWelcome()}>{busy ? 'CONFIRMANDO…' : 'LI E DESEJO CONTINUAR'}</button></section></main>
    <footer className="footer"><span>MU/TH/R 6000</span><span>CANAL DE TRIPULAÇÃO</span><span>© 2026</span></footer>
  </main>

  return <main className="station-shell player-shell">
    <header className="topbar">
      <button className="brand" type="button" onClick={() => { setActiveView('home'); setActiveContent(null) }}><span className="brand-mark">M</span><span><strong>MU/TH/R 6000</strong><small>TERMINAL DE TRIPULAÇÃO // {currentCampaign?.name}</small></span></button>
      <div className="player-campaign-picker"><label htmlFor="player-campaign">CAMPANHA</label><select id="player-campaign" value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setActiveContent(null); setActiveView('home'); setFileUrl(null); setChatUnread({ global: 0, local: 0 }) }}>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select></div>
      {onSwitchToCommand && <button className="quiet-button" type="button" onClick={onSwitchToCommand}>COMANDO</button>}
      <div className="player-notice-bell"><span aria-hidden="true">♢</span><span>{unreadNotifications.length}</span><div className="notification-popover"><p className="eyebrow">NOTIFICAÇÕES</p>{unreadNotifications.length === 0 ? <p>Nenhuma nova notificação.</p> : unreadNotifications.slice(0, 6).map((item) => <button key={item.id} type="button" onClick={() => void openNotification(item)}><span>{item.content_type.toUpperCase()}</span><strong>{item.title}</strong></button>)}</div></div>
      <button className="quiet-button" type="button" onClick={onSignOut}>SAIR</button>
    </header>
    {externalNotice && <div className={`notice notice-${externalNotice.kind}`} role={externalNotice.kind === 'error' ? 'alert' : 'status'}><span>{externalNotice.text}</span></div>}
    {notice && <div className="player-sync-notice" role="status">{notice}<button type="button" onClick={() => setNotice('')}>FECHAR</button></div>}
    {error && <div className="notice notice-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)}>×</button></div>}
    <div className={`player-layout ${interfacePreferences.sidebar_position === 'right' ? 'sidebar-right' : ''}`}>
      {sidebarOpen && <aside className="player-sidebar"><div className="sidebar-heading"><p className="eyebrow">MAIL.SYS // RECEBIDOS</p><button className="text-button" type="button" onClick={() => void toggleMailSidebar(true)} aria-label="Recolher lista">RECOLHER</button></div>
        {(workspace?.emails ?? []).length === 0 ? <p className="sidebar-empty">Nenhum e-mail recebido.</p> : workspace?.emails.map((email) => <button key={email.id} type="button" className={`email-list-item ${activeContent?.id === email.id ? 'selected' : ''} ${email.read_at ? '' : 'unread'}`} onClick={() => void selectEmail(email)}><span>{email.sender_name}</span><strong>{email.subject}</strong><small>{new Date(email.sent_at).toLocaleDateString('pt-BR')}</small></button>)}
      </aside>}
      <section className="player-center">
        {!sidebarOpen && <button className="show-sidebar-button" type="button" onClick={() => void toggleMailSidebar(false)}>ABRIR MAIL.SYS</button>}
        <nav className="player-app-tabs" aria-label="Aplicativos da tripulação">
          <button type="button" className={activeView === 'home' ? 'selected' : ''} onClick={() => { setActiveView('home'); setActiveContent(null) }}>CENTRAL</button>
          <button type="button" className={activeView === 'emails' ? 'selected' : ''} onClick={() => { setActiveView('emails'); setActiveContent(null) }}>MAIL.SYS</button>
          <button type="button" className={activeView === 'notes' ? 'selected' : ''} onClick={() => { setActiveView('notes'); setActiveContent(null) }}>NOTES.SYS</button>
          <button type="button" className={activeView === 'events' ? 'selected' : ''} onClick={() => { setActiveView('events'); setActiveContent(null) }}>EVENTS.SYS</button>
          <button type="button" className={activeView === 'files' ? 'selected' : ''} onClick={() => { setActiveView('files'); setActiveContent(null) }}>FILES.SYS</button>
          <button type="button" className={activeView === 'sheet' ? 'selected' : ''} onClick={() => { setActiveView('sheet'); setActiveContent(null) }}>FICHA</button>
          <button type="button" className={activeView === 'preferences' ? 'selected' : ''} onClick={() => { setActiveView('preferences'); setActiveContent(null) }}>INTERFACE.SYS</button>
          <button type="button" className={activeView === 'globalChat' ? 'selected' : ''} onClick={() => { setActiveView('globalChat'); setActiveContent(null); setChatUnread((count) => ({ ...count, global: 0 })) }}>CHAT.GLOBAL{chatUnread.global > 0 && <span className="chat-unread">{chatUnread.global}</span>}</button>
          <button type="button" className={activeView === 'localChat' ? 'selected' : ''} onClick={() => { setActiveView('localChat'); setActiveContent(null); setChatUnread((count) => ({ ...count, local: 0 })) }}>CHAT.LOCAL{chatUnread.local > 0 && <span className="chat-unread">{chatUnread.local}</span>}</button>
        </nav>
        {activeView === 'globalChat' || activeView === 'localChat'
          ? currentCampaign ? <ChatPanel key={`${currentCampaign.id}-${activeView}`} campaignId={currentCampaign.id} chatType={activeView === 'globalChat' ? 'global' : 'local'} userId={user.id} memberId={currentCampaign.memberId} isMaster={false} onNotice={setError} /> : <div className="player-content-loading">SELECIONE UMA CAMPANHA…</div>
          : currentWorkspaceLoadError ? <div className="player-sync-failure" role="alert">
            <p className="eyebrow">FALHA DE SINCRONIZAÇÃO</p>
            <h1>O computador de bordo não respondeu</h1>
            <p>{currentWorkspaceLoadError.message}</p>
            {currentWorkspaceLoadError.hint && <p className="player-sync-migration-hint">{currentWorkspaceLoadError.hint}</p>}
            <button className="secondary-button" type="button" onClick={retryWorkspaceSync}>TENTAR SINCRONIZAR NOVAMENTE</button>
          </div>
          : loading || workspaceLoadedFor !== currentCampaign?.id ? <div className="player-content-loading">SINCRONIZANDO COM O COMPUTADOR DE BORDO…</div> : activeView === 'home' ? <PlayerHome campaign={currentCampaign} workspace={workspace} onOpenEmail={(item) => void selectEmail(item)} onOpenEvent={(item) => void selectEvent(item)} onOpenNote={(item) => void selectNote(item)} />
          : activeView === 'emails' ? <PlayerEmailView emails={workspace?.emails ?? []} email={activeEmail} onOpen={(item) => void selectEmail(item)} allowReplies={workspace?.allowPlayerEmailReplies ?? false} onReply={sendEmailReply} busy={busy} />
          : activeView === 'notes' ? <PlayerNoteView notes={workspace?.notes.filter((note) => !note.archived_at) ?? []} note={activeNote} annotation={annotation} onAnnotationChange={setAnnotation} onSaveAnnotation={() => void saveAnnotation()} onOpen={(note) => void selectNote(note)} onRead={(note) => void handleNoteState(note, 'read')} onArchive={(note) => void handleNoteState(note, 'archive')} busy={busy} />
          : activeView === 'events' ? <PlayerEventView events={workspace?.events ?? []} event={activeEvent} onOpen={(item) => void selectEvent(item)} />
          : activeView === 'preferences' && currentCampaign ? <PlayerPreferencesPanel key={currentCampaign.memberId} preferences={interfacePreferences} onSave={(next) => void saveInterfacePreferences(next)} busy={preferencesBusy} />
          : activeView === 'sheet' && currentCampaign ? <PlayerCharacterSheetPanel key={currentCampaign.memberId} memberId={currentCampaign.memberId} defaultName={currentCampaign.playerName} onError={(message) => setError(message)} onSaved={() => setNotice('Ficha da tripulação salva nesta campanha.')} />
          : <PlayerFileView key={currentCampaign?.memberId} memberId={currentCampaign?.memberId ?? ''} onOpen={(path, newTab) => void openFile(path, newTab)} />}
        {fileUrl && <div className="player-file-viewer"><div><p className="eyebrow">FILES.SYS // VISUALIZADOR PRIVADO</p><button className="text-button" type="button" onClick={() => setFileUrl(null)}>FECHAR</button></div><iframe title="Documento recebido" src={fileUrl} /><a href={fileUrl} target="_blank" rel="noreferrer">ABRIR EM NOVA ABA ↗</a></div>}
      </section>
      <aside className="player-info-panel"><p className="eyebrow">PAINEL DE INFORMAÇÕES</p>{interfacePreferences.information_panel_order.map((panel) => panel === 'identity'
        ? <div className="player-info-identity-group" key={panel}><div className="player-info-row"><span>TRIPULANTE</span><strong>{currentCampaign?.playerName}</strong></div><div className="player-info-row"><span>IDENTIFICAÇÃO</span><strong>{currentCampaign?.fakeEmail}</strong></div></div>
        : panel === 'campaign'
          ? <div className="player-info-row" key={panel}><span>OPERAÇÃO</span><strong>{currentCampaign?.name}</strong></div>
          : <PlayerTelemetryPanel key={panel} telemetry={workspace?.telemetry ?? null} />)}<div className={`player-info-status ${currentRealtimeStatus}`} role="status" aria-live="polite">
          <span className="status-dot" />
          {currentRealtimeStatus === 'connected' ? 'CANAL CONECTADO' : currentRealtimeStatus === 'disconnected' ? 'CANAL DESCONECTADO' : 'CONECTANDO CANAL…'}
        </div></aside>
    </div>
    <footer className="footer"><span>MU/TH/R 6000</span><span>TRIPULAÇÃO // {user.id.slice(0, 8).toUpperCase()}</span><span>© 2026</span></footer>
    {pendingEventAlerts[0] && <EventAlertOverlay
      event={pendingEventAlerts[0]}
      onClose={() => void closeEventAlert(pendingEventAlerts[0].id)}
      saveError={eventDismissalError?.message}
      onRetryDismissal={eventDismissalError ? () => void closeEventAlert(eventDismissalError.eventId) : undefined}
    />}
    {!pendingEventAlerts[0] && eventDismissalError && <EventAlertSaveError
      message={eventDismissalError.message}
      onRetry={() => void closeEventAlert(eventDismissalError.eventId)}
    />}
  </main>
}

function PlayerPreferencesPanel({ preferences, onSave, busy }: {
  preferences: PlayerInterfacePreferences
  onSave: (preferences: PlayerInterfacePreferences) => void
  busy: boolean
}) {
  const [draft, setDraft] = useState(preferences)

  function movePanel(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= draft.information_panel_order.length) return
    const order = [...draft.information_panel_order]
    ;[order[index], order[target]] = [order[target], order[index]]
    setDraft({ ...draft, information_panel_order: order })
  }

  const panelNames: Record<PlayerInterfacePreferences['information_panel_order'][number], string> = {
    identity: 'Tripulante e identificação',
    campaign: 'Operação atual',
    telemetry: 'Indicadores da nave',
  }

  return <section className="player-content-view player-preferences">
    <p className="eyebrow">INTERFACE.SYS // PREFERÊNCIAS DA TRIPULAÇÃO</p>
    <h1>Organizar interface</h1>
    <p className="panel-subtitle">Essas preferências são independentes para cada campanha e ficam vinculadas à sua participação.</p>
    <label className="settings-field">Posição da lista de e-mails
      <select value={draft.sidebar_position} onChange={(event) => setDraft({ ...draft, sidebar_position: event.target.value as 'left' | 'right' })}>
        <option value="left">À esquerda do conteúdo</option>
        <option value="right">À direita do conteúdo</option>
      </select>
    </label>
    <label className="settings-toggle preference-toggle"><input type="checkbox" checked={draft.sidebar_collapsed} onChange={(event) => setDraft({ ...draft, sidebar_collapsed: event.target.checked })} />Iniciar com a lista de e-mails recolhida</label>
    <fieldset className="preference-order">
      <legend>Ordem dos painéis de informações</legend>
      {draft.information_panel_order.map((panel, index) => <div className="preference-order-row" key={panel}><span>{panelNames[panel]}</span><div><button className="secondary-button" type="button" aria-label={`Mover ${panelNames[panel]} para cima`} disabled={index === 0} onClick={() => movePanel(index, -1)}>↑</button><button className="secondary-button" type="button" aria-label={`Mover ${panelNames[panel]} para baixo`} disabled={index === draft.information_panel_order.length - 1} onClick={() => movePanel(index, 1)}>↓</button></div></div>)}
    </fieldset>
    <button className="primary-button" type="button" disabled={busy} onClick={() => onSave(draft)}>{busy ? 'SALVANDO…' : 'SALVAR PREFERÊNCIAS'}</button>
    <p className="form-hint">Chat e notificações permanecem fixos para preservar o acesso rápido e as regras da campanha.</p>
  </section>
}

function PlayerHome({ campaign, workspace, onOpenEmail, onOpenEvent, onOpenNote }: {
  campaign: PlayerCampaign | null
  workspace: PlayerWorkspace | null
  onOpenEmail: (item: PlayerEmail) => void
  onOpenEvent: (item: PlayerEvent) => void
  onOpenNote: (item: PlayerNote) => void
}) {
  const latestEmails = workspace?.emails.slice(0, 3) ?? []
  const latestNotes = workspace?.notes.filter((note) => !note.archived_at).slice(0, 3) ?? []
  const latestEvents = workspace?.events.slice(0, 3) ?? []
  return <div className="player-home">{campaign?.cover_url && safeImageUrl(campaign.cover_url) && <img className="campaign-cover player-campaign-cover" src={safeImageUrl(campaign.cover_url) ?? undefined} alt={`Capa de ${campaign.name}`} />}<p className="eyebrow">CENTRAL DE OPERAÇÕES // {campaign?.name}</p><h1>Bem-vindo, {campaign?.playerName}</h1><p className="panel-subtitle">Conteúdos e comunicados enviados pelo mestre aparecem nesta área.</p>
    <div className="player-summary-grid"><div><span>E-MAILS</span><strong>{workspace?.emails.length ?? 0}</strong></div><div><span>NOTAS</span><strong>{workspace?.notes.filter((note) => !note.archived_at).length ?? 0}</strong></div><div><span>EVENTOS</span><strong>{workspace?.events.length ?? 0}</strong></div></div>
    <section className="player-feed-section"><h2>Últimos e-mails</h2>{latestEmails.length ? latestEmails.map((email) => <button className="player-feed-item" key={email.id} type="button" onClick={() => onOpenEmail(email)}><span>{email.sender_name}</span><strong>{email.subject}</strong><small>{new Date(email.sent_at).toLocaleString('pt-BR')}</small></button>) : <p className="empty-copy">Nenhum e-mail recebido até o momento.</p>}</section>
    <section className="player-feed-section"><h2>Comunicados e notas</h2>{latestNotes.length ? latestNotes.map((note) => <button className="player-feed-item" key={note.id} type="button" onClick={() => onOpenNote(note)}><span>NOTES.SYS</span><strong>{note.title}</strong><small>{new Date(note.created_at).toLocaleString('pt-BR')}</small></button>) : <p className="empty-copy">Nenhuma nota publicada.</p>}</section>
    <section className="player-feed-section"><h2>Eventos recentes</h2>{latestEvents.length ? latestEvents.map((event) => <button className="player-feed-item" key={event.id} type="button" onClick={() => onOpenEvent(event)}><span>{event.event_type.toUpperCase()}</span><strong>{event.title}</strong><small>{new Date(event.created_at).toLocaleString('pt-BR')}</small></button>) : <p className="empty-copy">Nenhum evento registrado.</p>}</section>
  </div>
}

function PlayerCharacterSheetPanel({ memberId, defaultName, onError, onSaved }: {
  memberId: string
  defaultName: string
  onError: (message: string) => void
  onSaved: () => void
}) {
  const [sheet, setSheet] = useState<PlayerCharacterSheet>({
    character_name: defaultName,
    role: '',
    function_name: '',
    description: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const generationRef = useRef(0)

  useEffect(() => {
    const generation = ++generationRef.current
    const isCurrent = () => generationRef.current === generation
    void getPlayerCharacterSheet(memberId)
      .then((record) => {
        if (isCurrent() && record) setSheet({ ...record, character_name: record.character_name || defaultName })
      })
      .catch((error: unknown) => { if (isCurrent()) onError(errorMessage(error)) })
      .finally(() => { if (isCurrent()) setLoading(false) })
    return () => { generationRef.current += 1 }
  }, [defaultName, memberId, onError])

  async function saveSheet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized = {
      character_name: sheet.character_name.trim(),
      role: sheet.role.trim(),
      function_name: sheet.function_name.trim(),
      description: sheet.description.trim(),
    }
    if (!normalized.character_name) {
      onError('Informe o nome do personagem.')
      return
    }
    if (normalized.character_name.length > 100 || normalized.role.length > 100
      || normalized.function_name.length > 100 || normalized.description.length > 2000) {
      onError('A ficha excede o limite de caracteres de um ou mais campos.')
      return
    }
    setSaving(true)
    try {
      await savePlayerCharacterSheet(memberId, normalized)
      setSheet(normalized)
      onSaved()
    } catch (error) {
      onError(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return <section className="character-sheet-panel">
    <header className="panel-title"><div><p className="eyebrow">CREW.SYS // FICHA DO PERSONAGEM</p><h1>Identificação da tripulação</h1><p className="panel-subtitle">Esta ficha é independente para cada campanha. Seu nome de acesso permanece inalterado.</p></div></header>
    {loading ? <div className="player-content-loading">CARREGANDO FICHA…</div> : <form className="character-sheet-form" onSubmit={(event) => void saveSheet(event)}>
      <label>NOME DO PERSONAGEM<input value={sheet.character_name} onChange={(event) => setSheet((current) => ({ ...current, character_name: event.target.value }))} maxLength={100} required /></label>
      <div className="character-sheet-grid">
        <label>CARGO<input value={sheet.role} onChange={(event) => setSheet((current) => ({ ...current, role: event.target.value }))} maxLength={100} placeholder="Ex.: Oficial de ciências" /></label>
        <label>FUNÇÃO<input value={sheet.function_name} onChange={(event) => setSheet((current) => ({ ...current, function_name: event.target.value }))} maxLength={100} placeholder="Ex.: Pesquisa e análise" /></label>
      </div>
      <label>DESCRIÇÃO<textarea value={sheet.description} onChange={(event) => setSheet((current) => ({ ...current, description: event.target.value }))} maxLength={2000} rows={7} placeholder="Descrição do personagem para esta campanha." /></label>
      <div className="character-sheet-footer"><span>IDENTIDADE DE JOGADOR // {defaultName}</span><button className="primary-button" type="submit" disabled={saving}>{saving ? 'SALVANDO…' : 'SALVAR FICHA'}</button></div>
    </form>}
  </section>
}

function PlayerTelemetryPanel({ telemetry }: { telemetry: PlayerTelemetry | null }) {
  const [clockNow, setClockNow] = useState(() => new Date().getTime())
  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(new Date().getTime()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  if (!telemetry) return null
  const elapsed = telemetry.timer_elapsed_seconds + (telemetry.timer_started_at
    ? Math.max(0, Math.floor((clockNow - Date.parse(telemetry.timer_started_at)) / 1000))
    : 0)
  const visible = [
    telemetry.show_ship_clock ? ['RELÓGIO DA NAVE', telemetry.ship_clock || '—'] : null,
    ['CRONÔMETRO', formatDuration(elapsed)],
    telemetry.show_energy && telemetry.energy !== null ? ['ENERGIA', `${telemetry.energy}%`] : null,
    telemetry.show_oxygen && telemetry.oxygen !== null ? ['OXIGÊNIO', `${telemetry.oxygen}%`] : null,
    telemetry.show_integrity && telemetry.integrity !== null ? ['INTEGRIDADE', `${telemetry.integrity}%`] : null,
  ].filter((item): item is [string, string] => item !== null)
  return <section className="player-telemetry"><p className="eyebrow">SESSION.SYS // NAVE</p>{visible.map(([label, value]) => <div className="player-info-row" key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>
}

function PlayerEmailView({ emails, email, onOpen, allowReplies, onReply, busy }: {
  emails: PlayerEmail[]
  email?: PlayerEmail
  onOpen: (item: PlayerEmail) => void
  allowReplies: boolean
  onReply: (item: PlayerEmail, body: string) => Promise<boolean>
  busy: boolean
}) {
  const [replyBody, setReplyBody] = useState('')
  const thread = email ? getPlayerEmailThread(email, emails) : []
  async function handleReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (email && await onReply(email, replyBody)) setReplyBody('')
  }
  return <div className="player-content-view"><p className="eyebrow">MAIL.SYS // CORREIO INTERNO</p>{email ? <article className="player-message"><h1>{email.subject}</h1><p className="message-byline">DE: {email.sender_name} &lt;{email.sender_email}&gt;</p><p className="message-byline">{new Date(email.sent_at).toLocaleString('pt-BR')}</p><div className="message-body">{email.body}</div>{email.imageUrls.length > 0 && <div className="player-email-images">{email.imageUrls.map((url, index) => <img key={url} src={url} alt={`Imagem anexada ${index + 1}`} />)}</div>}{thread.length > 1 && <section className="player-email-thread"><p className="eyebrow">CONVERSA // {thread.length} MENSAGENS</p>{thread.map((item) => <button className={item.id === email.id ? 'selected' : ''} key={item.id} type="button" onClick={() => onOpen(item)}><span>{item.sender_name} · {new Date(item.sent_at).toLocaleString('pt-BR')}</span><strong>{item.subject}</strong></button>)}</section>}{allowReplies && <form className="player-reply-form" onSubmit={(event) => void handleReply(event)}><label>RESPONDER AO MESTRE<textarea value={replyBody} maxLength={20000} required rows={5} onChange={(event) => setReplyBody(event.target.value)} /></label><button className="primary-button" type="submit" disabled={busy}>{busy ? 'ENVIANDO…' : 'ENVIAR RESPOSTA'}</button></form>}</article> : emails.length ? <div className="player-content-list">{emails.map((item) => <button key={item.id} type="button" onClick={() => onOpen(item)}><span>{item.read_at ? 'LIDO' : 'NOVO'} // {item.reply_to_id ? 'RESPOSTA // ' : ''}{item.sender_name}</span><strong>{item.subject}</strong><small>{new Date(item.sent_at).toLocaleString('pt-BR')}</small></button>)}</div> : <div className="empty-state"><h2>Caixa de entrada vazia</h2><p>Os e-mails internos recebidos durante a campanha aparecerão aqui.</p></div>}</div>
}

function getPlayerEmailThread(email: PlayerEmail, emails: PlayerEmail[]): PlayerEmail[] {
  const emailById = new Map(emails.map((item) => [item.id, item]))
  let root = email
  const visited = new Set<string>()
  while (root.reply_to_id && !visited.has(root.id)) {
    visited.add(root.id)
    const parent = emailById.get(root.reply_to_id)
    if (!parent) break
    root = parent
  }
  const thread = new Map<string, PlayerEmail>([[root.id, root]])
  let changed = true
  while (changed) {
    changed = false
    for (const item of emails) {
      if (item.reply_to_id && thread.has(item.reply_to_id) && !thread.has(item.id)) {
        thread.set(item.id, item)
        changed = true
      }
    }
  }
  return [...thread.values()].sort((left, right) => left.sent_at.localeCompare(right.sent_at))
}

function PlayerNoteView({ notes, note, annotation, onAnnotationChange, onSaveAnnotation, onOpen, onRead, onArchive, busy }: {
  notes: PlayerNote[]
  note?: PlayerNote
  annotation: string
  onAnnotationChange: (value: string) => void
  onSaveAnnotation: () => void
  onOpen: (note: PlayerNote) => void
  onRead: (note: PlayerNote) => void
  onArchive: (note: PlayerNote) => void
  busy: boolean
}) {
  return <div className="player-content-view"><p className="eyebrow">NOTES.SYS // COMUNICADOS PUBLICADOS</p>{note ? <article className="player-message"><h1>{note.title}</h1><p className="message-byline">{new Date(note.created_at).toLocaleString('pt-BR')}</p><div className="message-body">{note.body}</div><div className="note-actions">{!note.read_at && <button className="secondary-button" type="button" disabled={busy} onClick={() => onRead(note)}>MARCAR COMO LIDA</button>}<button className="secondary-button" type="button" disabled={busy} onClick={() => onArchive(note)}>ARQUIVAR</button></div><label className="annotation-field">ANOTAÇÃO PRIVADA<textarea rows={5} value={annotation} onChange={(event) => onAnnotationChange(event.target.value)} placeholder="Somente você poderá ler esta anotação." /></label><button className="primary-button" type="button" disabled={busy} onClick={onSaveAnnotation}>SALVAR ANOTAÇÃO</button></article> : notes.length ? <div className="player-content-list">{notes.map((item) => <button key={item.id} type="button" onClick={() => onOpen(item)}><span>{item.read_at ? 'LIDA' : 'NOVA'} // NOTES.SYS</span><strong>{item.title}</strong><small>{new Date(item.created_at).toLocaleString('pt-BR')}</small></button>)}</div> : <div className="empty-state"><h2>Nenhuma nota publicada</h2><p>O mestre ainda não compartilhou notas com esta participação.</p></div>}</div>
}

function PlayerEventView({ events, event, onOpen }: { events: PlayerEvent[]; event?: PlayerEvent; onOpen: (item: PlayerEvent) => void }) {
  return <div className="player-content-view"><p className="eyebrow">EVENTS.SYS // REGISTRO NARRATIVO</p>{event ? <article className="player-message"><p className="eyebrow">{event.event_type.toUpperCase()} // {event.presentation.toUpperCase()}</p><h1>{event.title}</h1><p className="message-byline">{new Date(event.created_at).toLocaleString('pt-BR')}</p><div className="message-body">{event.body}</div></article> : events.length ? <div className="player-content-list">{events.map((item) => <button key={item.id} type="button" onClick={() => onOpen(item)}><span>{item.read_at ? 'LIDO' : 'NOVO'} // {item.event_type.toUpperCase()}</span><strong>{item.title}</strong><small>{new Date(item.created_at).toLocaleString('pt-BR')}</small></button>)}</div> : <div className="empty-state"><h2>Nenhum evento recebido</h2><p>Eventos enviados para esta tripulação aparecerão aqui.</p></div>}</div>
}

function PlayerFileView({ memberId, onOpen }: { memberId: string; onOpen: (storagePath: string, newTab: boolean) => void }) {
  const [files, setFiles] = useState<{ id: string; file_name: string; storage_path: string; mime_type: string; byte_size: number; uploaded_at: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void (async () => {
      if (!supabase) return
      const { data: deliveries, error: deliveryError } = await supabase.from('campaign_file_recipients').select('file_id').eq('member_id', memberId)
      if (deliveryError) throw deliveryError
      const ids = (deliveries ?? []).map((item) => item.file_id)
      if (!ids.length) { if (active) setFiles([]); return }
      const { data, error: fileError } = await supabase.from('campaign_files').select('id,file_name,storage_path,mime_type,byte_size,uploaded_at').in('id', ids).order('uploaded_at', { ascending: false })
      if (fileError) throw fileError
      if (active) setFiles(data ?? [])
    })().catch((cause: unknown) => { if (active) setError(errorMessage(cause)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [memberId])
  return <div className="player-content-view"><p className="eyebrow">FILES.SYS // DOCUMENTOS DISTRIBUÍDOS</p>{error && <p className="config-error" role="alert">{error}</p>}{loading ? <div className="player-content-loading">CARREGANDO DOCUMENTOS…</div> : files.length ? <div className="player-content-list">{files.map((file) => <div className="player-file-row" key={file.id}><div><span>{file.mime_type.toUpperCase()} // {(file.byte_size / 1024 / 1024).toFixed(1)} MB</span><strong>{file.file_name}</strong><small>{new Date(file.uploaded_at).toLocaleString('pt-BR')}</small></div><button className="secondary-button" type="button" onClick={() => onOpen(file.storage_path, false)}>ABRIR</button><button className="text-button" type="button" onClick={() => onOpen(file.storage_path, true)}>NOVA ABA ↗</button></div>)}</div> : <div className="empty-state"><h2>Nenhum arquivo distribuído</h2><p>Arquivos compartilhados pelo mestre aparecerão aqui.</p></div>}</div>
}

function CommandCenter({ campaigns, onCreate, onOpen }: { campaigns: Campaign[]; onCreate: () => void; onOpen: (campaign: Campaign) => void }) {
  return <>
    <div className="panel-title"><div><p className="eyebrow">CENTRAL DE COMANDO // MESTRE</p><h1>Suas campanhas</h1><p className="panel-subtitle">Acesse as operações sob sua responsabilidade.</p></div><button className="primary-button" type="button" onClick={onCreate}>＋ NOVA CAMPANHA</button></div>
    {campaigns.length === 0 ? <div className="empty-state"><span className="empty-glyph">▣</span><h2>Nenhuma operação registrada</h2><p>Crie sua primeira campanha. Um convite seguro será gerado junto com ela.</p><button className="secondary-button" type="button" onClick={onCreate}>CRIAR CAMPANHA</button></div>
      : <div className="campaign-grid">{campaigns.map((campaign, index) => <article className="campaign-card" key={campaign.id}>
        {safeImageUrl(campaign.cover_url) && <img className="campaign-cover campaign-card-cover" src={safeImageUrl(campaign.cover_url) ?? undefined} alt="" />}
        <div className="campaign-card-top"><span className="campaign-index">OPERAÇÃO {String(index + 1).padStart(2, '0')}</span><span className="card-status">REGISTRADA</span></div>
        <h2>{campaign.name}</h2><p>{campaign.description || 'Sem descrição registrada.'}</p>
        <div className="campaign-card-footer"><span>CRIADA {new Date(campaign.created_at).toLocaleDateString('pt-BR')}</span><button className="text-button" type="button" onClick={() => onOpen(campaign)}>ABRIR PAINEL <span aria-hidden="true">→</span></button></div>
      </article>)}</div>}
  </>
}

function CampaignDetail({ campaign, onBack, onNotice, onInviteLinkChange, onCampaignUpdated, onCampaignImported, onCopy, inviteLink, onCopyExisting, onDelete, busy, userId }: { campaign: Campaign; onBack: () => void; onNotice: (notice: Notice) => void; onInviteLinkChange: (link: string | null) => void; onCampaignUpdated: (patch: Partial<Campaign>) => void; onCampaignImported: (campaign: Campaign) => void; onCopy: () => void; inviteLink: string | null; onCopyExisting: () => void; onDelete: () => void; busy: boolean; userId: string }) {
  const [activeApp, setActiveApp] = useState<'campaign' | 'settings' | 'crew' | 'session' | 'mail' | 'notes' | 'events' | 'files' | 'chat' | 'log'>('campaign')
  const [members, setMembers] = useState<CampaignMember[]>([])
  const [recoveryRequests, setRecoveryRequests] = useState<IdentityRecoveryRequest[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [memberBusy, setMemberBusy] = useState(false)
  const [pendingMemberRemoval, setPendingMemberRemoval] = useState<CampaignMember | null>(null)
  const [pendingRecovery, setPendingRecovery] = useState<IdentityRecoveryRequest | null>(null)
  const [unreadGlobalChat, setUnreadGlobalChat] = useState(0)

  useEffect(() => {
    if (!supabase) return
    let active = true
    const refreshLock = { current: false }
    async function refreshCrewData() {
      if (refreshLock.current) return
      refreshLock.current = true
      try {
        const [recoveryResult, memberResult] = await Promise.all([
          getCampaignRecoveryRequests(campaign.id),
          getCampaignMembers(campaign.id),
        ])
        if (!active) return
        setRecoveryRequests(recoveryResult)
        setMembers(memberResult)
      } catch (error) {
        if (active) onNotice({ kind: 'error', text: errorMessage(error) })
      } finally {
        refreshLock.current = false
        if (active && activeApp === 'crew') setMembersLoading(false)
      }
    }

    void refreshCrewData()
    const refreshTimer = window.setInterval(() => void refreshCrewData(), 15_000)
    const realtime = supabase
    const channel = realtime.channel(`crew-management-${campaign.id}`)
    if (activeApp === 'crew') {
      channel.on('postgres_changes', {
        event: '*', schema: 'public', table: 'campaign_members', filter: `campaign_id=eq.${campaign.id}`,
      }, () => { if (active) void refreshCrewData() })
    }
    channel.on('postgres_changes', {
      event: '*', schema: 'public', table: 'identity_recovery_requests', filter: `campaign_id=eq.${campaign.id}`,
    }, () => { if (active) void refreshCrewData() })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' && active) void refreshCrewData()
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          onNotice({ kind: 'error', text: 'A sincronização de pedidos de recuperação foi interrompida. Tentando restabelecer a conexão.' })
        }
      })
    return () => {
      active = false
      window.clearInterval(refreshTimer)
      void realtime.removeChannel(channel)
    }
  }, [activeApp, campaign.id, onNotice])

  useEffect(() => {
    if (activeApp === 'chat' || !supabase) return
    const realtime = supabase
    let active = true
    const channel = realtime.channel(`master-chat-notifications-${campaign.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'global_messages', filter: `campaign_id=eq.${campaign.id}` }, (payload) => {
        if (active && payload.new.author_user_id !== userId) setUnreadGlobalChat((count) => count + 1)
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          onNotice({ kind: 'error', text: 'As notificações do chat global foram interrompidas. Tentando reconectar.' })
        }
      })
    return () => {
      active = false
      void realtime.removeChannel(channel)
    }
  }, [activeApp, campaign.id, onNotice, userId])

  async function toggleMemberBlocked(member: CampaignMember) {
    setMemberBusy(true)
    try {
      await setCampaignMemberBlocked(member.id, !member.is_blocked)
      setMembers((current) => current.map((item) => item.id === member.id ? { ...item, is_blocked: !item.is_blocked } : item))
      onNotice({ kind: 'success', text: member.is_blocked ? 'Acesso do jogador restaurado.' : 'Jogador bloqueado; seu acesso foi suspenso.' })
    } catch (error) {
      onNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setMemberBusy(false)
    }
  }

  async function confirmMemberRemoval() {
    if (!pendingMemberRemoval) return
    setMemberBusy(true)
    try {
      await removeCampaignMember(pendingMemberRemoval.id)
      setMembers((current) => current.filter((item) => item.id !== pendingMemberRemoval.id))
      onNotice({ kind: 'success', text: `Participação de ${pendingMemberRemoval.player_name} removida.` })
      setPendingMemberRemoval(null)
    } catch (error) {
      onNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setMemberBusy(false)
    }
  }

  async function decideRecovery(request: IdentityRecoveryRequest, decision: 'approve' | 'reject') {
    setMemberBusy(true)
    try {
      await resolveIdentityRecovery(request.id, decision)
      setRecoveryRequests((current) => current.map((currentRequest) => currentRequest.id === request.id
        ? { ...request, status: decision === 'approve' ? 'approved' : 'rejected' }
        : currentRequest))
      if (decision === 'approve') setMembers(await getCampaignMembers(campaign.id))
      setPendingRecovery((current) => current?.id === request.id ? null : current)
      onNotice({
        kind: 'success',
        text: decision === 'approve'
          ? 'Vínculo transferido. A identidade antiga perdeu acesso à participação.'
          : 'Solicitação de recuperação recusada; a participação original permanece inalterada.',
      })
    } catch (error) {
      onNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setMemberBusy(false)
    }
  }

  async function resolveRecovery(decision: 'approve' | 'reject') {
    if (!pendingRecovery) return
    await decideRecovery(pendingRecovery, decision)
  }

  const pendingPopupRequest = recoveryRequests.find((request) =>
    request.campaign_id === campaign.id && request.status === 'pending')
  const pendingPopupMember = pendingPopupRequest
    ? members.find((member) => member.id === pendingPopupRequest.member_id)
    : undefined

  return <div className="campaign-detail">
    <button className="back-button" type="button" onClick={onBack}>← TODAS AS CAMPANHAS</button>
    <nav className="app-tabs" aria-label="Aplicativos da campanha">
      <button type="button" className={activeApp === 'campaign' ? 'selected' : ''} onClick={() => setActiveApp('campaign')}>CAMPAIGN.SYS</button>
      <button type="button" className={activeApp === 'settings' ? 'selected' : ''} onClick={() => setActiveApp('settings')}>SETTINGS.SYS</button>
      <button type="button" className={activeApp === 'crew' ? 'selected' : ''} onClick={() => { setMembersLoading(true); setActiveApp('crew') }}>CREW.SYS</button>
      <button type="button" className={activeApp === 'chat' ? 'selected' : ''} onClick={() => { setActiveApp('chat'); setUnreadGlobalChat(0) }}>CHAT.SYS{unreadGlobalChat > 0 && <span className="chat-unread">{unreadGlobalChat}</span>}</button>
      <button type="button" className={activeApp === 'session' ? 'selected' : ''} onClick={() => setActiveApp('session')}>SESSION.SYS</button>
      <button type="button" className={activeApp === 'mail' ? 'selected' : ''} onClick={() => setActiveApp('mail')}>MAIL.SYS</button>
      <button type="button" className={activeApp === 'notes' ? 'selected' : ''} onClick={() => setActiveApp('notes')}>NOTES.SYS</button>
      <button type="button" className={activeApp === 'events' ? 'selected' : ''} onClick={() => setActiveApp('events')}>EVENTS.SYS</button>
      <button type="button" className={activeApp === 'files' ? 'selected' : ''} onClick={() => setActiveApp('files')}>FILES.SYS</button>
      <button type="button" className={activeApp === 'log' ? 'selected' : ''} onClick={() => setActiveApp('log')}>LOG.SYS</button>
    </nav>
    {activeApp === 'settings' ? <CampaignSettingsPanel key={campaign.id} campaign={campaign} onNotice={onNotice} onInviteLinkChange={onInviteLinkChange} onCampaignUpdated={onCampaignUpdated} onCampaignImported={onCampaignImported} />
      : activeApp === 'log' ? <ActivityLogPanel campaignId={campaign.id} userId={userId} onNotice={onNotice} /> : activeApp === 'chat' ? <ChatPanel key={campaign.id} campaignId={campaign.id} chatType="global" userId={userId} memberId={null} isMaster onNotice={(message) => onNotice({ kind: 'error', text: message })} /> : activeApp === 'files' ? <FilesPanel campaign={campaign} onNotice={onNotice} /> : activeApp === 'events' ? <EventsPanel campaign={campaign} onNotice={onNotice} /> : activeApp === 'notes' ? <NotesPanel campaign={campaign} onNotice={onNotice} /> : activeApp === 'mail' ? <MailPanel campaign={campaign} onNotice={onNotice} /> : activeApp === 'session' ? <SessionPanel campaign={campaign} onNotice={onNotice} /> : activeApp === 'crew' ? <>
      <p className="eyebrow">CREW.SYS // PARTICIPAÇÕES</p>
      <h1>Tripulação</h1>
      <p className="detail-description">Gerencie o acesso dos participantes. Nomes e e-mails de identificação são definidos pelos próprios jogadores.</p>
      {membersLoading ? <div className="empty-state"><p>CARREGANDO PARTICIPAÇÕES…</p></div> : members.length === 0 ? <div className="empty-state"><h2>Nenhum jogador nesta campanha</h2><p>Gere um convite em CAMPAIGN.SYS para permitir a entrada de jogadores.</p></div> : <div className="member-list">
        {members.map((member) => <article className="member-row" key={member.id}>
          <div className="member-identity"><span className="member-avatar">{member.player_name.slice(0, 1).toUpperCase()}</span><div><h2>{member.player_name}</h2><p>{member.fake_email} · entrou {new Date(member.joined_at).toLocaleDateString('pt-BR')}</p></div></div>
          <div className="member-controls"><span className={`member-state ${member.is_blocked ? 'blocked' : ''}`}>{member.is_blocked ? 'BLOQUEADO' : 'PARTICIPANTE'}</span><button className="secondary-button" type="button" disabled={memberBusy} onClick={() => void toggleMemberBlocked(member)}>{member.is_blocked ? 'DESBLOQUEAR' : 'BLOQUEAR'}</button><button className="danger-button" type="button" disabled={memberBusy} onClick={() => setPendingMemberRemoval(member)}>REMOVER</button></div>
        </article>)}
      </div>}
      <section className="recovery-requests">
        <div className="panel-title"><div><p className="eyebrow">RECUPERAÇÃO DE IDENTIDADE</p><h2>Solicitações pendentes</h2><p className="panel-subtitle">A aprovação transfere a participação e revoga imediatamente a identidade anterior.</p></div></div>
        {recoveryRequests.filter((request) => request.status === 'pending').length ? recoveryRequests.filter((request) => request.status === 'pending').map((request) => {
          const member = members.find((item) => item.id === request.member_id)
          return <article className="recovery-request-row" key={request.id}>
            <div><strong>{member?.player_name ?? 'Participação indisponível'}</strong><span>{member?.fake_email ?? 'E-mail não disponível'}</span><small>Solicitada {new Date(request.requested_at).toLocaleString('pt-BR')} · nova identidade {request.requested_user_id.slice(0, 8).toUpperCase()}</small></div>
            <button className="primary-button" type="button" disabled={memberBusy || !member || member.is_blocked} onClick={() => setPendingRecovery(request)}>REVISAR</button>
          </article>
        }) : <p className="empty-copy">Nenhuma solicitação de recuperação pendente.</p>}
      </section>
      {pendingMemberRemoval && <Modal title="REMOVER PARTICIPANTE" onClose={() => setPendingMemberRemoval(null)}><p className="dialog-copy">Remover <strong>{pendingMemberRemoval.player_name}</strong> desta campanha? A participação e as relações dependentes serão removidas. Esta ação não pode ser desfeita.</p><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setPendingMemberRemoval(null)}>CANCELAR</button><button className="danger-button" type="button" disabled={memberBusy} onClick={() => void confirmMemberRemoval()}>{memberBusy ? 'REMOVENDO…' : 'REMOVER PARTICIPANTE'}</button></div></Modal>}
      {pendingRecovery && <Modal title="REVISAR RECUPERAÇÃO DE IDENTIDADE" onClose={() => { if (!memberBusy) setPendingRecovery(null) }}><p className="dialog-copy">A nova identidade solicitou acesso à participação de <strong>{members.find((member) => member.id === pendingRecovery.member_id)?.player_name ?? 'jogador'}</strong>. A solicitação usou o e-mail fictício já associado a essa participação, mas não comprova sozinha quem está pedindo.</p><p className="dialog-copy">Ao aprovar, a participação, ficha e dados vinculados permanecem; a identidade anterior perde acesso imediatamente. Se não puder confirmar com o jogador, recuse a solicitação.</p><div className="modal-actions"><button className="secondary-button" type="button" disabled={memberBusy} onClick={() => setPendingRecovery(null)}>CANCELAR</button><button className="danger-button" type="button" disabled={memberBusy} onClick={() => void resolveRecovery('reject')}>{memberBusy ? 'AGUARDE…' : 'RECUSAR'}</button><button className="primary-button" type="button" disabled={memberBusy} onClick={() => void resolveRecovery('approve')}>{memberBusy ? 'TRANSFERINDO…' : 'APROVAR E TRANSFERIR'}</button></div></Modal>}
    </> : <>
    <p className="eyebrow">CAMPAIGN.SYS // IDENTIFICAÇÃO DE OPERAÇÃO</p>
    {safeImageUrl(campaign.cover_url) && <img className="campaign-cover detail-cover" src={safeImageUrl(campaign.cover_url) ?? undefined} alt={`Capa de ${campaign.name}`} />}
    <h1>{campaign.name}</h1><p className="detail-description">{campaign.description || 'Nenhuma descrição fornecida.'}</p>
    <div className="detail-grid">
      <section className="detail-block"><span className="detail-icon">⌁</span><p className="eyebrow">CONVITES</p><h2>Acesso à tripulação</h2><p>Gere um link exclusivo de acesso. Gerar outro link invalida imediatamente o convite anterior.</p><button className="primary-button" type="button" onClick={onCopy} disabled={busy}>{busy ? 'GERANDO…' : 'GERAR NOVO LINK'}</button>{inviteLink && <div className="invite-link-readout"><label htmlFor="active-invite-link">LINK ATIVO</label><input id="active-invite-link" readOnly value={inviteLink} onFocus={(event) => event.currentTarget.select()} /><button className="text-button" type="button" onClick={onCopyExisting}>COPIAR LINK</button></div>}</section>
      <section className="detail-block"><span className="detail-icon">▤</span><p className="eyebrow">INTEGRIDADE</p><h2>Dados protegidos</h2><p>O acesso à campanha e às participações é validado no PostgreSQL por políticas RLS.</p><span className="security-badge">RLS ATIVO</span></section>
    </div>
    <section className="detail-danger"><div><p className="eyebrow">ZONA DE RISCO</p><h2>Excluir campanha</h2><p>Remove a campanha e registros relacionados do banco.</p></div><button className="danger-button" type="button" onClick={onDelete}>EXCLUIR</button></section>
    <div className="module-notice"><strong>BACKUP E RESTAURAÇÃO</strong><p>Exporte uma cópia da campanha ou restaure um pacote .muthr como uma nova campanha em SETTINGS.SYS.</p></div>
    </>}
    {pendingPopupRequest && pendingPopupMember && <IdentityRecoveryPopup
      playerName={pendingPopupMember.player_name}
      busy={memberBusy}
      onAllow={() => void decideRecovery(pendingPopupRequest, 'approve')}
      onReject={() => void decideRecovery(pendingPopupRequest, 'reject')}
    />}
  </div>
}

function CampaignSettingsPanel({ campaign, onNotice, onInviteLinkChange, onCampaignUpdated, onCampaignImported }: {
  campaign: Campaign
  onNotice: (notice: Notice) => void
  onInviteLinkChange: (link: string | null) => void
  onCampaignUpdated: (patch: Partial<Campaign>) => void
  onCampaignImported: (campaign: Campaign) => void
}) {
  const [category, setCategory] = useState<'general' | 'invites' | 'communications' | 'indicators' | 'access'>('general')
  const [settings, setSettings] = useState<CampaignSystemSettings | null>(null)
  const [invite, setInvite] = useState<ActiveCampaignInvite | null>(null)
  const [loadedCampaignId, setLoadedCampaignId] = useState('')
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState(campaign.name)
  const [description, setDescription] = useState(campaign.description)
  const [coverUrl, setCoverUrl] = useState(campaign.cover_url ?? '')
  const [inviteExpiry, setInviteExpiry] = useState('')
  const [inviteMaxUses, setInviteMaxUses] = useState('')

  useEffect(() => {
    let active = true
    void getCampaignSettings(campaign.id)
      .then((result) => {
        if (!active) return
        setSettings(result.settings)
        setInvite(result.invite)
        setInviteExpiry(result.invite?.valid_until ? toDateTimeLocal(result.invite.valid_until) : '')
        setInviteMaxUses(result.invite?.max_uses?.toString() ?? '')
        setLoadedCampaignId(campaign.id)
      })
      .catch((cause: unknown) => { if (active) onNotice({ kind: 'error', text: errorMessage(cause) }) })
    return () => { active = false }
  }, [campaign.id, onNotice])

  async function saveGeneral(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedName = name.trim()
    const normalizedDescription = description.trim()
    const normalizedCover = coverUrl.trim()
    if (!normalizedName || normalizedName.length > 100 || normalizedDescription.length > 1000) {
      onNotice({ kind: 'error', text: 'Informe um nome de campanha de até 100 caracteres e uma descrição de até 1.000 caracteres.' })
      return
    }
    let safeCoverUrl: string | null = null
    if (normalizedCover) {
      try {
        const parsed = new URL(normalizedCover)
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('protocolo')
        safeCoverUrl = parsed.toString()
      } catch {
        onNotice({ kind: 'error', text: 'A capa deve usar um endereço HTTP ou HTTPS válido.' })
        return
      }
    }
    setSaving(true)
    try {
      await saveCampaignGeneral({ campaignId: campaign.id, name: normalizedName, description: normalizedDescription, coverUrl: safeCoverUrl })
      onCampaignUpdated({ name: normalizedName, description: normalizedDescription, cover_url: safeCoverUrl })
      onNotice({ kind: 'success', text: 'Identificação da campanha salva.' })
    } catch (cause) {
      onNotice({ kind: 'error', text: errorMessage(cause) })
    } finally {
      setSaving(false)
    }
  }

  async function saveSettingsPatch(patch: Partial<CampaignSystemSettings>, message: string) {
    if (!settings) return
    setSaving(true)
    try {
      await saveCampaignSystemSettings(campaign.id, patch)
      setSettings({ ...settings, ...patch })
      onNotice({ kind: 'success', text: message })
    } catch (cause) {
      onNotice({ kind: 'error', text: errorMessage(cause) })
    } finally {
      setSaving(false)
    }
  }

  async function generateInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    let validUntil: string | null = null
    if (inviteExpiry) {
      const expiry = new Date(inviteExpiry)
      if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) {
        onNotice({ kind: 'error', text: 'A validade do convite deve ser uma data futura válida.' })
        return
      }
      validUntil = expiry.toISOString()
    }
    const maxUses = inviteMaxUses.trim() ? Number(inviteMaxUses) : null
    if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) {
      onNotice({ kind: 'error', text: 'O limite de usos deve ser um número inteiro positivo ou ficar vazio para ilimitado.' })
      return
    }
    setSaving(true)
    try {
      const code = await rotateCampaignInviteSettings({ campaignId: campaign.id, validUntil, maxUses })
      const link = new URL(window.location.pathname, window.location.origin)
      link.searchParams.set('invite', code)
      onInviteLinkChange(link.toString())
      const result = await getCampaignSettings(campaign.id)
      setInvite(result.invite)
      setInviteExpiry(result.invite?.valid_until ? toDateTimeLocal(result.invite.valid_until) : '')
      setInviteMaxUses(result.invite?.max_uses?.toString() ?? '')
      onNotice({ kind: 'success', text: 'Novo convite gerado; o link ativo anterior foi invalidado.' })
    } catch (cause) {
      onNotice({ kind: 'error', text: errorMessage(cause) })
    } finally {
      setSaving(false)
    }
  }

  async function revokeInvite() {
    if (!window.confirm('Invalidar todos os convites ativos? Os links atuais deixarão de funcionar.')) return
    setSaving(true)
    try {
      await invalidateCampaignInvites(campaign.id)
      setInvite(null)
      onInviteLinkChange(null)
      onNotice({ kind: 'success', text: 'Todos os convites ativos foram invalidados.' })
    } catch (cause) {
      onNotice({ kind: 'error', text: errorMessage(cause) })
    } finally {
      setSaving(false)
    }
  }

  async function copyActiveInvite() {
    if (!invite) return
    const url = new URL(window.location.href)
    url.searchParams.set('invite', invite.code)
    url.hash = ''
    try {
      await copyText(url.toString())
      onNotice({ kind: 'success', text: 'Link do convite ativo copiado.' })
    } catch (cause) {
      onNotice({ kind: 'error', text: errorMessage(cause) })
    }
  }

  function toggleSetting(key: keyof CampaignSystemSettings, value: boolean) {
    void saveSettingsPatch({ [key]: value }, 'Configuração aplicada à campanha.')
  }

  const categories: { id: typeof category; title: string }[] = [
    { id: 'general', title: 'GERAL' },
    { id: 'invites', title: 'CONVITES' },
    { id: 'communications', title: 'COMUNICAÇÃO' },
    { id: 'indicators', title: 'INDICADORES' },
    { id: 'access', title: 'ACESSO' },
  ]

  return <section className="settings-system">
    <p className="eyebrow">SETTINGS.SYS // CONTROLE DA OPERAÇÃO</p>
    <h1>Configurações da campanha</h1>
    <p className="detail-description">Preferências salvas no banco e aplicadas às interfaces dos participantes desta campanha.</p>
    <nav className="settings-categories" aria-label="Categorias de configuração">
      {categories.map((item) => <button key={item.id} type="button" className={category === item.id ? 'selected' : ''} onClick={() => setCategory(item.id)}>{item.title}</button>)}
    </nav>
    {loadedCampaignId !== campaign.id ? <div className="empty-state"><p>CARREGANDO CONFIGURAÇÕES…</p></div> : !settings ? <div className="empty-state"><h2>Configurações indisponíveis</h2><p>Não foi possível carregar as preferências desta campanha.</p></div> : category === 'general' ? <form className="settings-form" onSubmit={(event) => void saveGeneral(event)}>
      <label>Nome da campanha<input maxLength={100} value={name} onChange={(event) => setName(event.target.value)} required /></label>
      <label>Descrição<textarea maxLength={1000} rows={5} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <label>URL da capa <span className="optional">(opcional)</span><input type="url" maxLength={2000} placeholder="https://…" value={coverUrl} onChange={(event) => setCoverUrl(event.target.value)} /></label>
      {safeImageUrl(coverUrl) && <img className="settings-cover-preview" src={safeImageUrl(coverUrl) ?? undefined} alt="Prévia da capa da campanha" />}
      <button className="primary-button" type="submit" disabled={saving}>{saving ? 'SALVANDO…' : 'SALVAR DADOS DA CAMPANHA'}</button>
    </form> : category === 'invites' ? <div className="settings-section">
      <h2>Convites de acesso</h2>
      <p className="panel-subtitle">A geração de um novo convite invalida o atual. Campos vazios significam sem validade e usos ilimitados.</p>
      <form className="settings-form" onSubmit={(event) => void generateInvite(event)}>
        <label>Expira em <span className="optional">(opcional)</span><input type="datetime-local" value={inviteExpiry} onChange={(event) => setInviteExpiry(event.target.value)} /></label>
        <label>Máximo de utilizações <span className="optional">(opcional)</span><input type="number" min={1} step={1} value={inviteMaxUses} onChange={(event) => setInviteMaxUses(event.target.value)} placeholder="Ilimitado" /></label>
        <button className="primary-button" type="submit" disabled={saving}>{saving ? 'PROCESSANDO…' : invite ? 'GERAR E SUBSTITUIR CONVITE' : 'GERAR CONVITE'}</button>
      </form>
      {invite && <div className="active-invite-card"><div><p className="eyebrow">CONVITE ATIVO</p><p>{invite.max_uses === null ? 'Usos ilimitados' : `${invite.uses} de ${invite.max_uses} usos`}</p><p>{invite.valid_until ? `Expira ${new Date(invite.valid_until).toLocaleString('pt-BR')}` : 'Sem data de expiração'}</p></div><div className="settings-actions"><button className="secondary-button" type="button" onClick={() => void copyActiveInvite()}>COPIAR LINK</button><button className="danger-button" type="button" disabled={saving} onClick={() => void revokeInvite()}>INVALIDAR</button></div></div>}
    </div> : category === 'communications' ? <div className="settings-section">
      <h2>Boas-vindas e comunicação</h2>
      <form className="settings-form" onSubmit={(event) => {
        event.preventDefault()
        if (settings.welcome_title.trim().length === 0 || settings.welcome_title.length > 120 || settings.welcome_message.length > 5000) {
          onNotice({ kind: 'error', text: 'O título deve conter até 120 caracteres e a mensagem até 5.000 caracteres.' })
          return
        }
        void saveSettingsPatch({ welcome_title: settings.welcome_title.trim(), welcome_message: settings.welcome_message }, 'Mensagem de boas-vindas salva.')
      }}>
        <label className="settings-toggle"><input type="checkbox" checked={settings.welcome_enabled} disabled={saving} onChange={(event) => toggleSetting('welcome_enabled', event.target.checked)} />Exigir confirmação de boas-vindas para jogadores que ainda não confirmaram</label>
        <label>Título<input maxLength={120} value={settings.welcome_title} onChange={(event) => setSettings({ ...settings, welcome_title: event.target.value })} /></label>
        <label>Mensagem<textarea maxLength={5000} rows={6} value={settings.welcome_message} onChange={(event) => setSettings({ ...settings, welcome_message: event.target.value })} /></label>
        <button className="primary-button" type="submit" disabled={saving}>{saving ? 'SALVANDO…' : 'SALVAR MENSAGEM'}</button>
      </form>
      <label className="settings-toggle standalone-toggle"><input type="checkbox" checked={settings.allow_player_email_replies} disabled={saving} onChange={(event) => toggleSetting('allow_player_email_replies', event.target.checked)} />Permitir que jogadores respondam aos e-mails recebidos</label>
    </div> : category === 'indicators' ? <div className="settings-section">
      <h2>Indicadores visíveis à tripulação</h2>
      <p className="panel-subtitle">Esses indicadores também podem ser atualizados em SESSION.SYS durante uma sessão.</p>
      <div className="settings-checklist">{([
        ['show_ship_clock', 'Relógio da nave'],
        ['show_energy', 'Energia'],
        ['show_oxygen', 'Oxigênio'],
        ['show_integrity', 'Integridade'],
      ] as const).map(([key, label]) => <label className="settings-toggle" key={key}><input type="checkbox" checked={settings[key]} disabled={saving} onChange={(event) => toggleSetting(key, event.target.checked)} />{label}</label>)}</div>
    </div> : <div className="settings-section">
      <h2>Permissões e recursos</h2>
      <p className="panel-subtitle">As permissões são verificadas no banco; esta tela não oferece controles que enfraqueçam o isolamento entre campanhas.</p>
      <div className="settings-policy-list">
        <p><strong>Chat local:</strong> acessível somente aos jogadores participantes; o mestre não recebe permissão de leitura.</p>
        <p><strong>Arquivos:</strong> bucket privado; distribuição disponível para imagens e PDFs conforme as regras do Storage.</p>
        <p><strong>Dados:</strong> notas, e-mails, eventos, sessões e participações são limitados à campanha por RLS.</p>
        <p><strong>Participantes:</strong> bloqueio, remoção e recuperação de identidade são administrados em CREW.SYS.</p>
      </div>
      <CampaignBackupPanel campaign={campaign} onNotice={onNotice} onCampaignImported={onCampaignImported} />
    </div>}
  </section>
}

function CampaignBackupPanel({ campaign, onNotice, onCampaignImported }: {
  campaign: Campaign
  onNotice: (notice: Notice) => void
  onCampaignImported: (campaign: Campaign) => void
}) {
  const [backupFile, setBackupFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<CampaignBackupPreview | null>(null)
  const [exporting, setExporting] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [confirming, setConfirming] = useState(false)

  async function exportBackup() {
    setExporting(true)
    try {
      const backup = await exportCampaignBackup(campaign.id)
      const url = URL.createObjectURL(backup.blob)
      const link = document.createElement('a')
      link.href = url
      link.download = backup.filename
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      onNotice({ kind: 'success', text: `Backup de "${campaign.name}" exportado.` })
    } catch (cause) {
      onNotice({ kind: 'error', text: errorMessage(cause) })
    } finally {
      setExporting(false)
    }
  }

  async function inspectFile(file: File | undefined) {
    setBackupFile(null)
    setPreview(null)
    if (!file) return
    try {
      const details = await inspectCampaignBackup(file)
      setBackupFile(file)
      setPreview(details)
    } catch (cause) {
      onNotice({ kind: 'error', text: errorMessage(cause) })
    }
  }

  async function restoreBackup() {
    if (!backupFile) return
    setRestoring(true)
    try {
      const imported = await restoreCampaignBackup(backupFile)
      setConfirming(false)
      setBackupFile(null)
      setPreview(null)
      onCampaignImported(imported)
      onNotice({ kind: 'success', text: `Backup restaurado como nova campanha: "${imported.name}".` })
    } catch (cause) {
      onNotice({ kind: 'error', text: errorMessage(cause) })
    } finally {
      setRestoring(false)
    }
  }

  return <section className="campaign-backup">
    <div><p className="eyebrow">BACKUP // EXPORTAR E RESTAURAR</p><h3>Arquivo da campanha</h3></div>
    <p className="panel-subtitle">O backup inclui conteúdo, histórico global, relações internas e arquivos privados. O arquivo .muthr não é enviado para nenhum servidor.</p>
    <button className="secondary-button" type="button" disabled={exporting} onClick={() => void exportBackup()}>{exporting ? 'PREPARANDO BACKUP…' : 'EXPORTAR BACKUP'}</button>
    <label className="backup-file-input">Selecionar backup para restauração<input type="file" accept=".muthr,application/vnd.muthr.backup" onChange={(event) => void inspectFile(event.currentTarget.files?.[0])} /></label>
    {preview && <div className="backup-preview">
      <p className="eyebrow">PRÉVIA VALIDADA</p><strong>{preview.name}</strong>
      <span>Exportado {new Date(preview.exportedAt).toLocaleString('pt-BR')}</span>
      <span>{preview.sessions} sessões · {preview.emails} e-mails · {preview.notes} notas · {preview.events} eventos</span>
      <span>{preview.files} arquivos · {formatBytes(preview.fileBytes)}</span>
      <button className="primary-button" type="button" onClick={() => setConfirming(true)}>RESTAURAR COMO NOVA CAMPANHA</button>
    </div>}
    <p className="form-hint">O Storage limita cada arquivo a 50 MB; este navegador processa até 500 MB de arquivos por backup.</p>
    {confirming && preview && <Modal title="CONFIRMAR RESTAURAÇÃO" onClose={() => { if (!restoring) setConfirming(false) }}>
      <p className="dialog-copy">Criar uma nova campanha chamada <strong>{preview.name}</strong>? A campanha atual não será alterada nem sobrescrita.</p>
      <p className="dialog-copy">A restauração envia os dados ao Supabase configurado e cria um novo convite. Por segurança, identidades, lista de jogadores, destinatários, anotações privadas, fichas, chat local e permissões não são transferidos. Mensagens, notas, eventos permanentes e arquivos ficam preservados sem distribuição; convide a tripulação e publique/distribua novamente após conferir os destinatários. Sessões abertas serão encerradas na restauração e eventos temporários não são incluídos.</p>
      <div className="modal-actions"><button className="secondary-button" type="button" disabled={restoring} onClick={() => setConfirming(false)}>CANCELAR</button><button className="primary-button" type="button" disabled={restoring} onClick={() => void restoreBackup()}>{restoring ? 'RESTAURANDO…' : 'CRIAR E RESTAURAR'}</button></div>
    </Modal>}
  </section>
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function safeImageUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

function toDateTimeLocal(value: string) {
  const date = new Date(value)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

function ActivityLogPanel({ campaignId, userId, onNotice }: {
  campaignId: string
  userId: string
  onNotice: (notice: Notice) => void
}) {
  const [activities, setActivities] = useState<CampaignActivity[]>([])
  const [members, setMembers] = useState<Map<string, string>>(new Map())
  const [scope, setScope] = useState<ActivityScope>('all')
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const generationRef = useRef(0)

  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedSearch(search.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [search])

  const reload = useCallback(async () => {
    const [page, memberNames] = await Promise.all([
      getCampaignActivity({ campaignId, scope, search: appliedSearch }),
      getCampaignActivityMembers(campaignId),
    ])
    setActivities(page.activities)
    setTotal(page.total)
    setHasMore(page.hasMore)
    setMembers(memberNames)
  }, [appliedSearch, campaignId, scope])

  useEffect(() => {
    const generation = ++generationRef.current
    const isCurrent = () => generationRef.current === generation
    // oxlint-disable-next-line react/set-state-in-effect
    void reload()
      .catch((error: unknown) => { if (isCurrent()) onNotice({ kind: 'error', text: errorMessage(error) }) })
      .finally(() => { if (isCurrent()) setLoading(false) })
    if (!supabase) return () => { generationRef.current += 1 }
    const realtime = supabase
    const channel = realtime.channel(`activity-log-${campaignId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'campaign_activity_log', filter: `campaign_id=eq.${campaignId}` }, () => {
        if (isCurrent()) void reload().catch((error: unknown) => onNotice({ kind: 'error', text: errorMessage(error) }))
      })
      .subscribe((status) => {
        if (!isCurrent()) return
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          onNotice({ kind: 'error', text: 'A sincronização de LOG.SYS foi interrompida. Tentando restabelecer a conexão.' })
        }
      })
    return () => {
      generationRef.current += 1
      void realtime.removeChannel(channel)
    }
  }, [campaignId, onNotice, reload])

  async function loadMore() {
    const lastActivity = activities.at(-1)
    if (!lastActivity || loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      const page = await getCampaignActivity({
        campaignId,
        scope,
        search: appliedSearch,
        before: { created_at: lastActivity.created_at, id: lastActivity.id },
      })
      setActivities((current) => [...current, ...page.activities.filter((item) => !current.some((existing) => existing.id === item.id))])
      setHasMore(page.hasMore)
    } catch (error) {
      onNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setLoadingMore(false)
    }
  }

  function actorLabel(activity: CampaignActivity) {
    if (activity.actor_user_id === userId) return 'MESTRE'
    if (activity.actor_member_id) return members.get(activity.actor_member_id) ?? 'TRIPULANTE'
    return 'SISTEMA DA CAMPANHA'
  }

  return <section className="activity-panel">
    <header className="panel-title">
      <div><p className="eyebrow">LOG.SYS // HISTÓRICO DE ATIVIDADES</p><h1>Registro da campanha</h1><p className="panel-subtitle">Ações permanentes e eventos temporários da sessão, com data e hora.</p></div>
      <button className="secondary-button" type="button" disabled={loading} onClick={() => {
        setLoading(true)
        void reload().catch((error: unknown) => onNotice({ kind: 'error', text: errorMessage(error) })).finally(() => setLoading(false))
      }}>ATUALIZAR</button>
    </header>
    <div className="activity-controls">
      <label htmlFor="activity-scope">CATEGORIA
        <select id="activity-scope" value={scope} onChange={(event) => { setScope(event.target.value as ActivityScope); setLoading(true) }}>
          <option value="all">Todos os registros</option>
          <option value="permanent">Permanentes</option>
          <option value="temporary">Temporários da sessão</option>
        </select>
      </label>
      <label htmlFor="activity-search">BUSCAR NO HISTÓRICO
        <input id="activity-search" value={search} onChange={(event) => { setSearch(event.target.value); setLoading(true) }} maxLength={100} placeholder="Descrição da atividade" />
      </label>
      <div className="activity-total"><strong>{total}</strong><span>REGISTROS ENCONTRADOS</span></div>
    </div>
    {loading ? <div className="empty-state"><p>CARREGANDO HISTÓRICO…</p></div> : activities.length === 0 ? <div className="empty-state"><h2>Nenhuma atividade encontrada</h2><p>As atividades da campanha serão registradas aqui conforme ocorrerem.</p></div> : <div className="activity-list">
      {activities.map((activity) => <article className={`activity-row ${activity.is_temporary ? 'temporary' : ''}`} key={activity.id}>
        <span className="activity-marker" aria-hidden="true" />
        <div className="activity-row-content">
          <div className="activity-row-heading"><strong>{activity.description}</strong><span className={activity.is_temporary ? 'temporary-badge' : 'permanent-badge'}>{activity.is_temporary ? 'TEMPORÁRIO' : 'PERMANENTE'}</span></div>
          <div className="activity-row-meta"><span>{actorLabel(activity)}</span><span>{activity.activity_type.replaceAll('_', ' ').toUpperCase()}</span><time dateTime={activity.created_at}>{new Date(activity.created_at).toLocaleString('pt-BR')}</time>{activity.session_id && <span>SESSÃO // {activity.session_id.slice(0, 8).toUpperCase()}</span>}</div>
        </div>
      </article>)}
      {hasMore && <button className="activity-load-more" type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'CARREGANDO…' : 'CARREGAR REGISTROS ANTERIORES'}</button>}
    </div>}
    <p className="activity-retention-note">Os registros permanentes não são apagados ao encerrar uma sessão. Registros temporários só são removidos quando o mestre seleciona essa opção no encerramento.</p>
  </section>
}

function ChatPanel({ campaignId, chatType, userId, memberId, isMaster, onNotice }: {
  campaignId: string
  chatType: ChatType
  userId: string
  memberId: string | null
  isMaster: boolean
  onNotice: (message: string) => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sessionLabels, setSessionLabels] = useState<Map<string, string>>(new Map())
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [typingUsers, setTypingUsers] = useState<ChatTypingUser[]>([])
  const [alias, setAlias] = useState('')
  const [aliasDraft, setAliasDraft] = useState('')
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [editing, setEditing] = useState<ChatMessage | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ChatMessage | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const noticeRef = useRef(onNotice)
  const generationRef = useRef(0)
  const loadedOlderRef = useRef(false)
  const localChat = chatType === 'local'

  useEffect(() => {
    noticeRef.current = onNotice
  }, [onNotice])

  const refresh = useCallback(async () => {
    const [page, labels, session] = await Promise.all([
      getChatMessages(campaignId, chatType),
      getCampaignSessionLabels(campaignId),
      getCurrentCampaignSession(campaignId),
    ])
    if (loadedOlderRef.current) {
      setMessages((current) => {
        if (!page.messages.length) return []
        const oldestFetched = page.messages[0]
        const olderMessages = current.filter((message) => message.created_at < oldestFetched.created_at
          || (message.created_at === oldestFetched.created_at && message.id < oldestFetched.id))
        const fetchedById = new Map(page.messages.map((message) => [message.id, message]))
        return [...olderMessages, ...fetchedById.values()]
      })
    } else {
      setMessages(page.messages)
      setHasMore(page.hasMore)
    }
    setSessionLabels(labels)
    setActiveSessionId(session?.id ?? null)
  }, [campaignId, chatType])

  const refreshTyping = useCallback(async () => {
    setTypingUsers(await getTypingUsers(campaignId, chatType, memberId, isMaster))
  }, [campaignId, chatType, isMaster, memberId])

  useEffect(() => {
    if (isMaster && localChat) return
    const generation = ++generationRef.current
    const isCurrent = () => generationRef.current === generation
    const realtime = supabase
    void Promise.all([
      // oxlint-disable-next-line react/set-state-in-effect
      refresh(),
      refreshTyping(),
      ...(localChat && memberId ? [getLocalChatAlias(memberId).then((value) => {
        if (isCurrent()) {
          setAlias(value)
          setAliasDraft(value)
        }
      })] : []),
    ]).catch((error: unknown) => {
      if (isCurrent()) noticeRef.current(errorMessage(error))
    }).finally(() => {
      if (isCurrent()) setLoading(false)
    })
    if (!realtime) return () => { generationRef.current += 1 }

    const messageTable = localChat ? 'local_messages' : 'global_messages'
    const channel = realtime.channel(`chat-${chatType}-${campaignId}-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: messageTable, filter: `campaign_id=eq.${campaignId}` }, (payload) => {
        if (payload.eventType === 'DELETE') {
          setMessages((current) => current.filter((message) => message.id !== payload.old.id))
        } else if (payload.eventType === 'UPDATE') {
          setMessages((current) => current.map((message) => message.id === payload.new.id ? {
            ...message,
            ...payload.new,
            author_name: localChat ? 'Tripulante' : payload.new.author_name,
            author_alias: localChat ? payload.new.author_alias : '',
          } as ChatMessage : message))
        }
        if (isCurrent()) void refresh().catch((error: unknown) => noticeRef.current(errorMessage(error)))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_typing_indicators', filter: `campaign_id=eq.${campaignId}` }, () => {
        if (isCurrent()) void refreshTyping().catch((error: unknown) => noticeRef.current(errorMessage(error)))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'campaign_sessions', filter: `campaign_id=eq.${campaignId}` }, () => {
        if (isCurrent()) void refresh().catch((error: unknown) => noticeRef.current(errorMessage(error)))
      })
      .subscribe((status) => {
        if (!isCurrent()) return
        if (status === 'SUBSCRIBED') {
          setConnectionState('connected')
          void Promise.all([refresh(), refreshTyping()])
            .catch((error: unknown) => noticeRef.current(errorMessage(error)))
        }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setConnectionState('disconnected')
          noticeRef.current('A conexão do chat foi interrompida. Reconectando e sincronizando as mensagens.')
        }
      })
    const typingRefreshTimer = window.setInterval(() => {
      if (isCurrent()) void refreshTyping().catch((error: unknown) => noticeRef.current(errorMessage(error)))
    }, 5000)
    return () => {
      generationRef.current += 1
      window.clearInterval(typingRefreshTimer)
      void realtime.removeChannel(channel)
    }
  }, [campaignId, chatType, isMaster, localChat, memberId, refresh, refreshTyping, userId])

  async function loadOlderMessages() {
    const oldestMessage = messages[0]
    if (!oldestMessage || loadingOlder || !hasMore) return
    setLoadingOlder(true)
    try {
      const page = await getChatMessages(campaignId, chatType, oldestMessage)
      loadedOlderRef.current = true
      setMessages((current) => {
        const messageIds = new Set(current.map((message) => message.id))
        return [...page.messages.filter((message) => !messageIds.has(message.id)), ...current]
      })
      setHasMore(page.hasMore)
    } catch (error) {
      noticeRef.current(errorMessage(error))
    } finally {
      setLoadingOlder(false)
    }
  }

  useEffect(() => {
    if (!userId || (localChat && !memberId)) return
    if (!draft.trim()) {
      void clearTypingState({ campaignId, userId, chatType }).catch((error: unknown) => noticeRef.current(errorMessage(error)))
      return
    }
    let expiryTimer = 0
    const activationTimer = window.setTimeout(() => {
      void setTypingState({ campaignId, userId, memberId, chatType })
        .then(() => {
          expiryTimer = window.setTimeout(() => {
            void clearTypingState({ campaignId, userId, chatType })
              .catch((error: unknown) => noticeRef.current(errorMessage(error)))
          }, 8000)
        })
        .catch((error: unknown) => noticeRef.current(errorMessage(error)))
    }, 450)
    return () => {
      window.clearTimeout(activationTimer)
      window.clearTimeout(expiryTimer)
    }
  }, [campaignId, chatType, draft, localChat, memberId, userId])

  useEffect(() => () => {
    if (memberId || !localChat) {
      void clearTypingState({ campaignId, userId, chatType })
        .catch((error: unknown) => noticeRef.current(errorMessage(error)))
    }
  }, [campaignId, chatType, localChat, memberId, userId])

  async function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const body = draft.trim()
    if (!body || busy) return
    setBusy(true)
    try {
      await sendChatMessage({ campaignId, sessionId: activeSessionId, chatType, memberId, body, replyToId: replyTo?.id ?? null })
      setDraft('')
      setReplyTo(null)
      await refresh()
    } catch (error) {
      noticeRef.current(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function saveAlias(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!memberId || busy) return
    const nextAlias = aliasDraft.trim()
    if (nextAlias.length > 40) {
      noticeRef.current('O apelido pode ter no máximo 40 caracteres.')
      return
    }
    setBusy(true)
    try {
      await saveLocalChatAlias(memberId, nextAlias)
      setAlias(nextAlias)
      noticeRef.current('Apelido do chat local atualizado.')
    } catch (error) {
      noticeRef.current(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing || !editDraft.trim() || busy) return
    setBusy(true)
    try {
      await editChatMessage(chatType, editing.id, editDraft.trim())
      setEditing(null)
      setEditDraft('')
      await refresh()
    } catch (error) {
      noticeRef.current(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  async function removeMessage() {
    if (!pendingDelete) return
    if (busy) return
    setBusy(true)
    try {
      await deleteChatMessage(chatType, pendingDelete.id)
      setPendingDelete(null)
      await refresh()
    } catch (error) {
      noticeRef.current(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  function appendEmoji(emoji: string) {
    setDraft((current) => `${current}${emoji}`)
  }

  if (isMaster && localChat) return <div className="empty-state"><p>O chat local não está disponível para a conta do mestre.</p></div>

  return <section className="chat-panel" aria-label={`Chat ${chatType}`}>
    <header className="chat-heading">
      <div><p className="eyebrow">CHAT.SYS // {localChat ? 'CANAL LOCAL' : 'CANAL GLOBAL'}</p><h1>{localChat ? 'Comunicação entre tripulantes' : 'Canal aberto da campanha'}</h1><p>{localChat ? 'Mensagens visíveis somente às identidades de jogadores desta campanha.' : 'Mensagens compartilhadas entre o mestre e toda a tripulação.'}</p></div>
      <span className={`chat-connection ${connectionState}`}><i />{connectionState === 'connected' ? 'SINCRONIZADO' : connectionState === 'connecting' ? 'CONECTANDO' : 'RECONEXÃO'}</span>
    </header>
    {localChat && <form className="chat-alias-form" onSubmit={(event) => void saveAlias(event)}>
      <label htmlFor="local-chat-alias">APELIDO NESTE CANAL</label>
      <input id="local-chat-alias" value={aliasDraft} onChange={(event) => setAliasDraft(event.target.value)} maxLength={40} placeholder="Seu nome de tripulante" />
      <button className="secondary-button" type="submit" disabled={busy || aliasDraft.trim() === alias.trim()}>SALVAR</button>
    </form>}
    <div className="chat-history" aria-live="polite">
      {!loading && hasMore && <button className="chat-load-older" type="button" disabled={loadingOlder} onClick={() => void loadOlderMessages()}>{loadingOlder ? 'CARREGANDO…' : 'CARREGAR MENSAGENS ANTERIORES'}</button>}
      {loading ? <div className="player-content-loading">SINCRONIZANDO CHAT…</div> : messages.length === 0 ? <div className="empty-state"><h2>Canal sem mensagens</h2><p>As mensagens enviadas durante a campanha aparecerão aqui.</p></div> : messages.map((message) => {
        const authorLabel = localChat ? message.author_alias || 'Tripulante' : message.author_name
        const repliedMessage = messages.find((candidate) => candidate.id === message.reply_to_id)
        return <article className={`chat-message ${message.author_user_id === userId ? 'own' : ''}`} key={message.id}>
          <div className="chat-message-meta"><strong>{authorLabel}</strong><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString('pt-BR')}</time>{message.edited_at && <span>EDITADA</span>}<small>{message.session_id ? sessionLabels.get(message.session_id) ?? 'SESSÃO ANTERIOR' : 'SEM SESSÃO'}</small></div>
          {repliedMessage && <button className="chat-reply-context" type="button" onClick={() => document.getElementById(`chat-message-${repliedMessage.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>↳ {localChat ? repliedMessage.author_alias || 'Tripulante' : repliedMessage.author_name}: {repliedMessage.body.slice(0, 100)}</button>}
          {editing?.id === message.id ? <form className="chat-edit-form" onSubmit={(event) => void saveEdit(event)}><textarea value={editDraft} maxLength={4000} rows={3} onChange={(event) => setEditDraft(event.target.value)} required /><div><button className="primary-button" type="submit" disabled={busy}>SALVAR</button><button className="text-button" type="button" onClick={() => setEditing(null)}>CANCELAR</button></div></form> : <p className="chat-message-body" id={`chat-message-${message.id}`}>{message.body}</p>}
          {message.author_user_id === userId && editing?.id !== message.id && <div className="chat-message-actions"><button type="button" onClick={() => { setEditing(message); setEditDraft(message.body) }}>EDITAR</button><button type="button" onClick={() => setPendingDelete(message)} disabled={busy}>EXCLUIR</button></div>}
          {editing?.id !== message.id && <button className="chat-reply-button" type="button" onClick={() => setReplyTo(message)}>RESPONDER</button>}
        </article>
      })}
      {!loading && typingUsers.length > 0 && <p className="chat-typing" role="status">{localChat ? 'Tripulante digitando…' : typingUsers.some((item) => item.member_id === null) ? 'O computador de bordo está digitando…' : 'Tripulante digitando…'}</p>}
    </div>
    {replyTo && <div className="chat-replying"><span>RESPONDENDO A {localChat ? replyTo.author_alias || 'TRIPULANTE' : replyTo.author_name}: {replyTo.body.slice(0, 90)}</span><button type="button" onClick={() => setReplyTo(null)} aria-label="Cancelar resposta">×</button></div>}
    <form className="chat-composer" onSubmit={(event) => void submitMessage(event)}>
      <div className="chat-emoji-row" aria-label="Inserir emoji">{['👽', '🚨', '👁️', '👍'].map((emoji) => <button key={emoji} type="button" aria-label={`Inserir ${emoji}`} onClick={() => appendEmoji(emoji)}>{emoji}</button>)}</div>
      <label className="visually-hidden" htmlFor={`chat-message-input-${chatType}`}>Mensagem</label>
      <textarea id={`chat-message-input-${chatType}`} value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={4000} rows={3} placeholder="Escreva uma mensagem…" required />
      <div className="chat-composer-footer"><small>{activeSessionId ? `SESSÃO ATUAL // ${sessionLabels.get(activeSessionId) ?? 'ATIVA'}` : 'MENSAGEM FORA DE SESSÃO'}</small><button className="primary-button" type="submit" disabled={busy || !draft.trim()}>{busy ? 'ENVIANDO…' : 'ENVIAR MENSAGEM'}</button></div>
    </form>
    {pendingDelete && <Modal title="EXCLUIR MENSAGEM" onClose={() => setPendingDelete(null)}><p className="dialog-copy">Excluir esta mensagem do canal? Esta ação não pode ser desfeita.</p><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setPendingDelete(null)}>CANCELAR</button><button className="danger-button" type="button" disabled={busy} onClick={() => void removeMessage()}>{busy ? 'EXCLUINDO…' : 'EXCLUIR MENSAGEM'}</button></div></Modal>}
  </section>
}

function MailPanel({ campaign, onNotice }: { campaign: Campaign; onNotice: (notice: Notice) => void }) {
  const [workspace, setWorkspace] = useState<MailWorkspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)
  const [senderEmail, setSenderEmail] = useState('')
  const [senderName, setSenderName] = useState('')
  const [senderNameEdited, setSenderNameEdited] = useState(false)
  const [recipientIds, setRecipientIds] = useState<string[]>([])
  const [images, setImages] = useState<File[]>([])
  const [replyTarget, setReplyTarget] = useState<SentEmail | null>(null)

  const reload = useCallback(async () => {
    setWorkspace(await getMailWorkspace(campaign.id))
  }, [campaign.id])

  useEffect(() => {
    let active = true
    void getMailWorkspace(campaign.id)
      .then((result) => { if (active) setWorkspace(result) })
      .catch((error: unknown) => onNotice({ kind: 'error', text: errorMessage(error) }))
      .finally(() => { if (active) setLoading(false) })
    if (!supabase) return () => { active = false }
    const realtime = supabase
    const channel = realtime.channel(`mail-panel-${campaign.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'campaign_emails', filter: `campaign_id=eq.${campaign.id}` }, () => {
        if (active) void reload().catch((error: unknown) => onNotice({ kind: 'error', text: errorMessage(error) }))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'campaign_settings', filter: `campaign_id=eq.${campaign.id}` }, () => {
        if (active) void reload().catch((error: unknown) => onNotice({ kind: 'error', text: errorMessage(error) }))
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onNotice({ kind: 'error', text: 'A sincronização de MAIL.SYS foi interrompida. Tentando restabelecer a conexão.' })
      })
    return () => {
      active = false
      void realtime.removeChannel(channel)
    }
  }, [campaign.id, onNotice, reload])

  const availableMembers = workspace?.members.filter((member) => !member.is_blocked) ?? []

  function chooseRecipients(ids: string[]) {
    setRecipientIds(ids)
  }

  function selectSender(sender: SavedSender | null) {
    setSenderEmail(sender?.email ?? '')
    setSenderName(sender?.name ?? '')
    setSenderNameEdited(Boolean(sender))
  }

  async function handleSaveSender() {
    if (!senderEmail.trim() || !senderName.trim()) {
      onNotice({ kind: 'error', text: 'Informe o e-mail e o nome do remetente antes de salvá-lo.' })
      return
    }
    setBusy(true)
    try {
      await saveSender(campaign.id, { email: senderEmail, name: senderName })
      await reload()
      onNotice({ kind: 'success', text: 'Remetente salvo para reutilização.' })
    } catch (error) {
      onNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteSender(senderId: string) {
    setBusy(true)
    try {
      await deleteSender(senderId)
      await reload()
      onNotice({ kind: 'success', text: 'Remetente salvo removido.' })
    } catch (error) {
      onNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  async function handleReplyPermission(allowed: boolean) {
    setBusy(true)
    try {
      await setPlayerEmailRepliesAllowed(campaign.id, allowed)
      await reload()
      onNotice({ kind: 'success', text: allowed ? 'Respostas de jogadores habilitadas.' : 'Respostas de jogadores desabilitadas.' })
    } catch (error) {
      onNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const subject = String(form.get('subject') ?? '').trim()
    const body = String(form.get('body') ?? '')
    if (!recipientIds.length) {
      onNotice({ kind: 'error', text: 'Selecione pelo menos um destinatário.' })
      return
    }
    setBusy(true)
    try {
      await sendCampaignEmail({
        campaignId: campaign.id,
        senderEmail,
        senderName,
        subject,
        body,
        memberIds: recipientIds,
        images,
        replyToId: replyTarget?.id ?? null,
      })
      await reload()
      setComposeOpen(false)
      setRecipientIds([])
      setImages([])
      setReplyTarget(null)
      onNotice({ kind: 'success', text: 'E-mail enviado aos destinatários selecionados.' })
    } catch (error) {
      onNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  function beginReply(email: SentEmail) {
    if (!workspace) return
    const root = getEmailThreadRoot(email, workspace.emails)
    if (!root) {
      onNotice({ kind: 'error', text: 'A mensagem original não está disponível para responder.' })
      return
    }
    const activeMemberIds = new Set(workspace.members.filter((member) => !member.is_blocked).map((member) => member.id))
    const respondingMember = workspace.members.find((member) =>
      !member.is_blocked && member.fake_email.toLowerCase() === email.sender_email.toLowerCase())
    const targets = email.reply_to_id && respondingMember
      ? [respondingMember.id]
      : root.recipientIds.filter((memberId) => activeMemberIds.has(memberId))
    if (!targets.length) {
      onNotice({ kind: 'error', text: 'Não há destinatários ativos disponíveis para esta conversa.' })
      return
    }
    setReplyTarget(root)
    setRecipientIds(targets)
    setComposeOpen(true)
  }

  function closeComposer() {
    if (busy) return
    setComposeOpen(false)
    setReplyTarget(null)
    setRecipientIds([])
  }

  if (loading) return <div className="empty-state"><p>CARREGANDO MAIL.SYS…</p></div>
  return <section className="mail-panel">
    <div className="panel-title"><div><p className="eyebrow">MAIL.SYS // COMUNICAÇÃO INTERNA</p><h1>Correio da campanha</h1><p className="panel-subtitle">As mensagens são persistentes e não enviam e-mails reais.</p></div><button className="primary-button" type="button" onClick={() => { setReplyTarget(null); setRecipientIds([]); setComposeOpen(true) }} disabled={!availableMembers.length}>＋ REDIGIR</button></div>
    <label className="mail-reply-permission"><input type="checkbox" checked={workspace?.allowPlayerEmailReplies ?? false} disabled={busy} onChange={(event) => void handleReplyPermission(event.target.checked)} />Permitir que jogadores respondam aos e-mails</label>
    {!availableMembers.length && <div className="module-notice"><strong>SEM DESTINATÁRIOS</strong><p>Convide ao menos um jogador ativo para enviar uma mensagem.</p></div>}
    <section className="mail-senders">
      <div><p className="eyebrow">REMETENTES SALVOS</p><p>Identidades internas reutilizáveis nesta campanha.</p></div>
      {workspace?.senders.length ? workspace.senders.map((sender) => <div className="mail-sender-row" key={sender.id}><span>{sender.name} <small>&lt;{sender.email}&gt;</small></span><button className="text-button" type="button" disabled={busy} onClick={() => void handleDeleteSender(sender.id)}>REMOVER</button></div>) : <p className="empty-copy">Nenhum remetente salvo.</p>}
    </section>
    <section className="mail-sent-list"><p className="eyebrow">ENVIADOS // {workspace?.emails.length ?? 0}</p>
      {workspace?.emails.length ? getEmailThreadRoots(workspace.emails).map((email) => <SentEmailThreadItem key={email.id} email={email} emails={workspace.emails} onReply={beginReply} />) : <div className="empty-state"><h2>Nenhuma mensagem enviada</h2><p>Os e-mails internos desta campanha ficarão registrados aqui.</p></div>}
    </section>
    {composeOpen && <Modal title={replyTarget ? 'RESPONDER NO FIO' : 'REDIGIR E-MAIL INTERNO'} onClose={closeComposer}>
      <form className="form-stack mail-compose" onSubmit={(event) => void handleSend(event)}>
        {replyTarget && <div className="mail-reply-context"><span>RESPONDENDO AO FIO</span><strong>{replyTarget.subject}</strong><small>A resposta ficará vinculada à mensagem original e será enviada aos destinatários selecionados.</small></div>}
        {workspace?.senders.length ? <label>Remetente salvo<select defaultValue="" onChange={(event) => selectSender(workspace.senders.find((sender) => sender.id === event.target.value) ?? null)}><option value="">Escolher ou preencher abaixo</option>{workspace.senders.map((sender) => <option key={sender.id} value={sender.id}>{sender.name} &lt;{sender.email}&gt;</option>)}</select></label> : null}
        <label>E-mail fictício do remetente<input type="email" required maxLength={254} value={senderEmail} onChange={(event) => setSenderEmail(event.target.value)} onBlur={() => { if (!senderNameEdited) setSenderName(senderNameFromEmail(senderEmail)) }} placeholder="central@weyland.example" /></label>
        <label>Nome do remetente<input required maxLength={100} value={senderName} onChange={(event) => { setSenderNameEdited(true); setSenderName(event.target.value) }} /></label>
        <button className="text-button mail-save-sender" type="button" disabled={busy} onClick={() => void handleSaveSender()}>SALVAR ESTE REMETENTE</button>
        <fieldset className="mail-recipients"><legend>Destinatários</legend>
          <label><input type="checkbox" checked={availableMembers.length > 0 && availableMembers.every((member) => recipientIds.includes(member.id))} onChange={(event) => chooseRecipients(event.target.checked ? availableMembers.map((member) => member.id) : [])} />Todos os jogadores ativos</label>
          {availableMembers.map((member) => <label key={member.id}><input type="checkbox" checked={recipientIds.includes(member.id)} onChange={(event) => chooseRecipients(event.target.checked ? [...new Set([...recipientIds, member.id])] : recipientIds.filter((id) => id !== member.id))} />{member.player_name} <small>{member.fake_email}</small></label>)}
        </fieldset>
        <label>Assunto<input key={replyTarget?.id ?? 'new-email'} name="subject" required maxLength={200} defaultValue={replyTarget ? replySubject(replyTarget.subject) : ''} /></label>
        <label>Conteúdo<textarea name="body" required rows={7} maxLength={20000} /></label>
        <label>Imagens anexadas<input type="file" accept="image/*" multiple disabled={busy} onChange={(event) => setImages(Array.from(event.target.files ?? []))} /></label>
        {images.length > 0 && <p className="form-hint">{images.length} imagem(ns) · limite de 50 MB por arquivo.</p>}
        <div className="modal-actions"><button className="secondary-button" type="button" disabled={busy} onClick={closeComposer}>CANCELAR</button><button className="primary-button" disabled={busy || !recipientIds.length}>{busy ? 'ENVIANDO…' : replyTarget ? 'ENVIAR RESPOSTA' : 'ENVIAR E-MAIL'}</button></div>
      </form>
    </Modal>}
  </section>
}

function getEmailThreadRoot(email: SentEmail, emails: SentEmail[]): SentEmail | undefined {
  let current = email
  const visited = new Set<string>()
  while (current.reply_to_id && !visited.has(current.id)) {
    visited.add(current.id)
    const parent = emails.find((candidate) => candidate.id === current.reply_to_id)
    if (!parent) break
    current = parent
  }
  return current
}

function getEmailThreadRoots(emails: SentEmail[]): SentEmail[] {
  const ids = new Set(emails.map((email) => email.id))
  return emails.filter((email) => !email.reply_to_id || !ids.has(email.reply_to_id))
    .sort((left, right) => right.sent_at.localeCompare(left.sent_at))
}

function SentEmailThreadItem({ email, emails, onReply }: {
  email: SentEmail
  emails: SentEmail[]
  onReply: (email: SentEmail) => void
}) {
  const children = emails.filter((candidate) => candidate.reply_to_id === email.id)
    .sort((left, right) => left.sent_at.localeCompare(right.sent_at))
  return <details className={`mail-sent-item ${email.reply_to_id ? 'mail-thread-reply' : ''}`}>
    <summary><span><strong>{email.subject}</strong><small>{email.sender_name} · {new Date(email.sent_at).toLocaleString('pt-BR')}</small></span><small>{email.recipientNames.join(', ') || (email.reply_to_id ? 'resposta de jogador' : 'destinatário removido')}</small></summary>
    <p className="mail-sent-body">{email.body}</p>
    <button className="text-button mail-thread-reply-action" type="button" onClick={() => onReply(email)}>RESPONDER NO FIO</button>
    {children.length > 0 && <div className="mail-thread-children">{children.map((child) => <SentEmailThreadItem key={child.id} email={child} emails={emails} onReply={onReply} />)}</div>}
  </details>
}

function replySubject(subject: string) {
  return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`
}

function senderNameFromEmail(email: string) {
  const localPart = email.split('@')[0] ?? ''
  return localPart.replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function RecipientSelector({ members, selectedIds, onChange }: {
  members: CampaignMember[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
}) {
  const activeMembers = members.filter((member) => !member.is_blocked)
  return <fieldset className="mail-recipients"><legend>Destinatários</legend>
    <label><input type="checkbox" checked={activeMembers.length > 0 && activeMembers.every((member) => selectedIds.includes(member.id))} onChange={(event) => onChange(event.target.checked ? activeMembers.map((member) => member.id) : [])} />Todos os jogadores ativos</label>
    {activeMembers.map((member) => <label key={member.id}><input type="checkbox" checked={selectedIds.includes(member.id)} onChange={(event) => onChange(event.target.checked ? [...new Set([...selectedIds, member.id])] : selectedIds.filter((id) => id !== member.id))} />{member.player_name} <small>{member.fake_email}</small></label>)}
  </fieldset>
}

function FilesPanel({ campaign, onNotice }: { campaign: Campaign; onNotice: (notice: Notice) => void }) {
  const [workspace, setWorkspace] = useState<FileWorkspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [folderOpen, setFolderOpen] = useState(false)
  const [replacementTarget, setReplacementTarget] = useState<CampaignFile | null>(null)
  const [pendingDelete, setPendingDelete] = useState<CampaignFile | null>(null)
  const [pendingFolderDelete, setPendingFolderDelete] = useState<CampaignFolder | null>(null)
  const [folderId, setFolderId] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [viewerUrl, setViewerUrl] = useState<string | null>(null)

  const reload = useCallback(async () => setWorkspace(await getFileWorkspace(campaign.id)), [campaign.id])
  useEffect(() => {
    let active = true
    void getFileWorkspace(campaign.id)
      .then((result) => { if (active) setWorkspace(result) })
      .catch((error: unknown) => onNotice({ kind: 'error', text: errorMessage(error) }))
      .finally(() => { if (active) setLoading(false) })
    if (!supabase) return () => { active = false }
    const realtime = supabase
    const channel = realtime.channel(`files-panel-${campaign.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'campaign_files', filter: `campaign_id=eq.${campaign.id}` }, () => {
        if (active) void reload().catch((error: unknown) => onNotice({ kind: 'error', text: errorMessage(error) }))
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onNotice({ kind: 'error', text: 'A sincronização de FILES.SYS foi interrompida. Tentando restabelecer a conexão.' })
      })
    return () => {
      active = false
      void realtime.removeChannel(channel)
    }
  }, [campaign.id, onNotice, reload])

  function openUpload(file?: CampaignFile) {
    setReplacementTarget(file ?? null)
    setFolderId(file?.folder_id ?? '')
    setSelectedIds(file?.recipientIds ?? [])
    setUploadOpen(true)
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const value = form.get('file')
    if (!(value instanceof File) || value.size === 0) {
      onNotice({ kind: 'error', text: 'Selecione uma imagem ou PDF para enviar.' })
      return
    }
    if (!selectedIds.length) {
      onNotice({ kind: 'error', text: 'Selecione pelo menos um destinatário.' })
      return
    }
    setBusy(true)
    try {
      if (replacementTarget) await replaceCampaignFile(replacementTarget, value, campaign.id, folderId || null)
      else await uploadCampaignFile({
        campaignId: campaign.id,
        folderId: folderId || null,
        file: value,
        memberIds: selectedIds,
      })
      await reload()
      setUploadOpen(false)
      setReplacementTarget(null)
      onNotice({ kind: 'success', text: replacementTarget ? 'Arquivo substituído e distribuído novamente.' : 'Arquivo enviado e distribuído.' })
    } catch (error) {
      onNotice({ kind: 'error', text: errorMessage(error) })
      await reload().catch((reloadError: unknown) => onNotice({ kind: 'error', text: errorMessage(reloadError) }))
    } finally {
      setBusy(false)
    }
  }

  async function handleCreateFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') ?? '').trim()
    const parentId = String(form.get('parentId') ?? '') || null
    setBusy(true)
    try {
      await createCampaignFolder(campaign.id, parentId, name)
      await reload()
      setFolderOpen(false)
      onNotice({ kind: 'success', text: 'Pasta criada.' })
    } catch (error) {
      onNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteFile() {
    if (!pendingDelete) return
    setBusy(true)
    try {
      await deleteCampaignFile(pendingDelete)
      await reload()
      setPendingDelete(null)
      onNotice({ kind: 'success', text: 'Arquivo removido do Storage e da campanha.' })
    } catch (error) {
      onNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteFolder() {
    if (!pendingFolderDelete) return
    setBusy(true)
    try {
      await deleteCampaignFolder(pendingFolderDelete.id)
      await reload()
      setPendingFolderDelete(null)
      onNotice({ kind: 'success', text: 'Pasta removida; arquivos foram mantidos sem pasta.' })
    } catch (error) {
      onNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  async function openFile(file: CampaignFile) {
    try {
      setViewerUrl(await getPrivateFileUrl(file.storage_path))
    } catch (error) {
      onNotice({ kind: 'error', text: errorMessage(error) })
    }
  }

  if (loading) return <div className="empty-state"><p>CARREGANDO FILES.SYS…</p></div>
  const folders = workspace?.folders ?? []
  const members = workspace?.members ?? []
  function folderName(id: string | null) {
    if (!id) return 'SEM PASTA'
    const folder = folders.find((item) => item.id === id)
    if (!folder) return 'PASTA REMOVIDA'
    const parent = folder.parent_id ? folders.find((item) => item.id === folder.parent_id)?.name : null
    return parent ? `${parent} / ${folder.name}` : folder.name
  }
  return <section className="files-panel">
    <div className="panel-title"><div><p className="eyebrow">FILES.SYS // ARQUIVOS PRIVADOS</p><h1>Biblioteca da campanha</h1><p className="panel-subtitle">Somente imagens e PDFs de até 50 MB. O mestre envia e seleciona quem pode abrir cada arquivo.</p></div><div className="editorial-actions"><button className="secondary-button" type="button" onClick={() => setFolderOpen(true)}>＋ PASTA</button><button className="primary-button" type="button" onClick={() => openUpload()}>＋ ENVIAR ARQUIVO</button></div></div>
    {folders.length > 0 && <div className="notebook-strip">{folders.map((folder) => <span key={folder.id}>{folderName(folder.id)}<button type="button" disabled={busy} onClick={() => setPendingFolderDelete(folder)} aria-label={`Excluir pasta ${folder.name}`}>×</button></span>)}</div>}
    {workspace?.files.length ? <div className="files-list">{workspace.files.map((file) => <article className="file-manager-row" key={file.id}>
      <div className="file-manager-info"><span className="eyebrow">{file.mime_type.toUpperCase()} // {(file.byte_size / 1024 / 1024).toFixed(1)} MB // {folderName(file.folder_id)}</span><h2>{file.file_name}</h2><p>ENVIADO {new Date(file.uploaded_at).toLocaleString('pt-BR')}</p><p>DESTINATÁRIOS // {file.recipientNames.join(', ') || 'nenhum participante ativo'}</p>{file.attachedToEmail && <small className="file-permanent-warning">ANEXO DE E-MAIL // SUBSTITUIÇÃO E EXCLUSÃO BLOQUEADAS PARA PRESERVAR O HISTÓRICO</small>}</div>
      <div className="file-manager-actions"><button className="secondary-button" type="button" onClick={() => void openFile(file)}>ABRIR</button><button className="secondary-button" type="button" disabled={busy || file.attachedToEmail} onClick={() => openUpload(file)}>SUBSTITUIR</button><button className="danger-button" type="button" disabled={busy || file.attachedToEmail} onClick={() => setPendingDelete(file)}>EXCLUIR</button></div>
    </article>)}</div> : <div className="empty-state"><h2>Nenhum arquivo registrado</h2><p>Envie imagens ou PDFs e selecione os destinatários da campanha.</p></div>}
    {uploadOpen && <Modal title={replacementTarget ? 'SUBSTITUIR ARQUIVO' : 'ENVIAR ARQUIVO'} onClose={() => { if (!busy) { setUploadOpen(false); setReplacementTarget(null) } }}>
      <form className="form-stack mail-compose" onSubmit={(event) => void handleUpload(event)}>
        {replacementTarget && <p className="form-hint">O objeto anterior será removido permanentemente e a nova versão será redistribuída aos mesmos jogadores.</p>}
        <label>{replacementTarget ? 'Novo arquivo' : 'Arquivo'}<input name="file" type="file" required accept="image/*,application/pdf" /></label>
        <p className="form-hint">Imagens ou PDF · máximo 50 MB por arquivo.</p>
        <label>Pasta<select value={folderId} onChange={(event) => setFolderId(event.target.value)}><option value="">Sem pasta</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folderName(folder.id)}</option>)}</select></label>
        {!replacementTarget && <RecipientSelector members={members} selectedIds={selectedIds} onChange={setSelectedIds} />}
        {replacementTarget && <p className="form-hint">DESTINATÁRIOS PRESERVADOS // {replacementTarget.recipientNames.join(', ')}</p>}
        <div className="modal-actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => setUploadOpen(false)}>CANCELAR</button><button className="primary-button" disabled={busy || !selectedIds.length}>{busy ? 'ENVIANDO…' : replacementTarget ? 'SUBSTITUIR E REDISTRIBUIR' : 'ENVIAR E DISTRIBUIR'}</button></div>
      </form>
    </Modal>}
    {folderOpen && <Modal title="CRIAR PASTA" onClose={() => { if (!busy) setFolderOpen(false) }}><form className="form-stack" onSubmit={(event) => void handleCreateFolder(event)}><label>Nome<input name="name" required maxLength={120} autoFocus /></label><label>Pasta superior<select name="parentId" defaultValue=""><option value="">Raiz</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folderName(folder.id)}</option>)}</select></label><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setFolderOpen(false)}>CANCELAR</button><button className="primary-button" disabled={busy}>{busy ? 'CRIANDO…' : 'CRIAR PASTA'}</button></div></form></Modal>}
    {pendingDelete && <Modal title="EXCLUIR ARQUIVO" onClose={() => { if (!busy) setPendingDelete(null) }}><p className="dialog-copy">Remover permanentemente <strong>{pendingDelete.file_name}</strong> do Storage privado e da campanha? Os destinatários perderão o acesso.</p><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setPendingDelete(null)}>CANCELAR</button><button className="danger-button" type="button" disabled={busy} onClick={() => void handleDeleteFile()}>{busy ? 'EXCLUINDO…' : 'EXCLUIR ARQUIVO'}</button></div></Modal>}
    {pendingFolderDelete && <Modal title="EXCLUIR PASTA" onClose={() => { if (!busy) setPendingFolderDelete(null) }}><p className="dialog-copy">Excluir a pasta <strong>{pendingFolderDelete.name}</strong>? Os arquivos serão mantidos sem pasta e as subpastas serão removidas.</p><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setPendingFolderDelete(null)}>CANCELAR</button><button className="danger-button" type="button" disabled={busy} onClick={() => void handleDeleteFolder()}>{busy ? 'EXCLUINDO…' : 'EXCLUIR PASTA'}</button></div></Modal>}
    {viewerUrl && <div className="player-file-viewer"><div><p className="eyebrow">FILES.SYS // VISUALIZADOR PRIVADO</p><button className="text-button" type="button" onClick={() => setViewerUrl(null)}>FECHAR</button></div><iframe title="Documento da campanha" src={viewerUrl} /><a href={viewerUrl} target="_blank" rel="noreferrer">ABRIR EM NOVA ABA ↗</a></div>}
  </section>
}

function NotesPanel({ campaign, onNotice }: { campaign: Campaign; onNotice: (notice: Notice) => void }) {
  const [workspace, setWorkspace] = useState<EditorialWorkspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<CampaignNoteRecord | null>(null)
  const [noteDialog, setNoteDialog] = useState(false)
  const [notebookDialog, setNotebookDialog] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<CampaignNoteRecord | null>(null)
  const [visibility, setVisibility] = useState<'private' | 'published'>('private')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectedNotebook, setSelectedNotebook] = useState('')

  const reload = useCallback(async () => setWorkspace(await getEditorialWorkspace(campaign.id)), [campaign.id])
  useEffect(() => {
    let active = true
    void getEditorialWorkspace(campaign.id)
      .then((result) => { if (active) setWorkspace(result) })
      .catch((error: unknown) => onNotice({ kind: 'error', text: errorMessage(error) }))
      .finally(() => { if (active) setLoading(false) })
    if (!supabase) return () => { active = false }
    const realtime = supabase
    const channel = realtime.channel(`notes-panel-${campaign.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'campaign_notes', filter: `campaign_id=eq.${campaign.id}` }, () => {
        if (active) void reload().catch((error: unknown) => onNotice({ kind: 'error', text: errorMessage(error) }))
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onNotice({ kind: 'error', text: 'A sincronização de NOTES.SYS foi interrompida. Tentando restabelecer a conexão.' })
      })
    return () => {
      active = false
      void realtime.removeChannel(channel)
    }
  }, [campaign.id, onNotice, reload])

  function openNewNote() {
    setEditing(null)
    setVisibility('private')
    setSelectedIds([])
    setSelectedNotebook('')
    setNoteDialog(true)
  }

  function openNote(note: CampaignNoteRecord) {
    setEditing(note)
    setVisibility(note.visibility)
    setSelectedIds(note.recipientIds)
    setSelectedNotebook(note.notebook_id ?? '')
    setNoteDialog(true)
  }

  async function handleSaveNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (visibility === 'published' && !selectedIds.length) {
      onNotice({ kind: 'error', text: 'Selecione ao menos um jogador para publicar a nota.' })
      return
    }
    const form = new FormData(event.currentTarget)
    setBusy(true)
    try {
      await saveCampaignNote({
        campaignId: campaign.id,
        noteId: editing?.id ?? null,
        notebookId: selectedNotebook || null,
        title: String(form.get('title') ?? ''),
        body: String(form.get('body') ?? ''),
        visibility,
        memberIds: visibility === 'published' ? selectedIds : [],
      })
      await reload()
      setNoteDialog(false)
      onNotice({ kind: 'success', text: visibility === 'published' ? 'Nota publicada aos destinatários selecionados.' : 'Nota privada salva.' })
    } catch (error) {
      onNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  async function handleCreateNotebook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get('name') ?? '').trim()
    if (!name) return
    setBusy(true)
    try {
      await createCampaignNotebook(campaign.id, name)
      await reload()
      setNotebookDialog(false)
      onNotice({ kind: 'success', text: 'Caderno criado.' })
    } catch (error) {
      onNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteNotebook(notebook: CampaignNotebook) {
    setBusy(true)
    try {
      await deleteCampaignNotebook(notebook.id)
      await reload()
      onNotice({ kind: 'success', text: 'Caderno removido. As notas foram mantidas sem caderno.' })
    } catch (error) {
      onNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteNote() {
    if (!pendingDelete) return
    setBusy(true)
    try {
      await deleteCampaignNote(pendingDelete.id)
      await reload()
      setPendingDelete(null)
      onNotice({ kind: 'success', text: 'Nota e publicação removidas.' })
    } catch (error) {
      onNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="empty-state"><p>CARREGANDO NOTES.SYS…</p></div>
  return <section className="editorial-panel">
    <div className="panel-title"><div><p className="eyebrow">NOTES.SYS // CADERNOS DE OPERAÇÃO</p><h1>Notas da campanha</h1><p className="panel-subtitle">Notas privadas ficam visíveis somente ao mestre; publique para compartilhar com tripulantes.</p></div><div className="editorial-actions"><button className="secondary-button" type="button" onClick={() => setNotebookDialog(true)}>＋ CADERNO</button><button className="primary-button" type="button" onClick={openNewNote}>＋ NOVA NOTA</button></div></div>
    {workspace?.notebooks.length ? <div className="notebook-strip">{workspace.notebooks.map((notebook) => <span key={notebook.id}>{notebook.name}<button type="button" disabled={busy} onClick={() => void handleDeleteNotebook(notebook)} aria-label={`Excluir caderno ${notebook.name}`}>×</button></span>)}</div> : null}
    {workspace?.notes.length ? <div className="editorial-list">{workspace.notes.map((note) => <article className="editorial-card" key={note.id}>
      <div className="editorial-card-heading"><span className="eyebrow">{note.visibility === 'private' ? 'PRIVADA' : 'PUBLICADA'}{note.notebook_id ? ` // ${workspace.notebooks.find((notebook) => notebook.id === note.notebook_id)?.name ?? 'CADERNO'}` : ''}</span><small>{new Date(note.updated_at).toLocaleString('pt-BR')}</small></div>
      <h2>{note.title}</h2><p className="editorial-preview">{note.body || 'Sem conteúdo adicional.'}</p>
      {note.visibility === 'published' && <p className="editorial-recipients">DESTINATÁRIOS // {note.recipients.join(', ') || 'nenhum participante ativo'}</p>}
      <div className="editorial-card-actions"><button className="secondary-button" type="button" onClick={() => openNote(note)}>EDITAR</button><button className="danger-button" type="button" disabled={busy} onClick={() => setPendingDelete(note)}>EXCLUIR</button></div>
    </article>)}</div> : <div className="empty-state"><h2>Nenhuma nota registrada</h2><p>Crie uma nota privada ou publique um comunicado para a tripulação.</p></div>}
    {noteDialog && <Modal title={editing ? 'EDITAR NOTA' : 'NOVA NOTA'} onClose={() => { if (!busy) setNoteDialog(false) }}>
      <form className="form-stack mail-compose" onSubmit={(event) => void handleSaveNote(event)}>
        <label>Título<input name="title" defaultValue={editing?.title ?? ''} required maxLength={200} autoFocus /></label>
        <label>Caderno<select value={selectedNotebook} onChange={(event) => setSelectedNotebook(event.target.value)}><option value="">Sem caderno</option>{workspace?.notebooks.map((notebook) => <option key={notebook.id} value={notebook.id}>{notebook.name}</option>)}</select></label>
        <label>Visibilidade<select value={visibility} onChange={(event) => { setVisibility(event.target.value as 'private' | 'published'); if (event.target.value === 'private') setSelectedIds([]) }}><option value="private">Privada — somente o mestre</option><option value="published">Publicada — compartilhar</option></select></label>
        {visibility === 'published' && <RecipientSelector members={workspace?.members ?? []} selectedIds={selectedIds} onChange={setSelectedIds} />}
        <label>Conteúdo<textarea name="body" defaultValue={editing?.body ?? ''} rows={9} maxLength={30000} /></label>
        {editing?.visibility === 'published' && visibility === 'private' && <p className="form-hint">Ao tornar privada, a nota deixará de aparecer aos jogadores e as publicações serão removidas.</p>}
        <div className="modal-actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => setNoteDialog(false)}>CANCELAR</button><button className="primary-button" disabled={busy}>{busy ? 'SALVANDO…' : visibility === 'published' ? 'PUBLICAR NOTA' : 'SALVAR PRIVADA'}</button></div>
      </form>
    </Modal>}
    {notebookDialog && <Modal title="CRIAR CADERNO" onClose={() => { if (!busy) setNotebookDialog(false) }}><form className="form-stack" onSubmit={(event) => void handleCreateNotebook(event)}><label>Nome do caderno<input name="name" required maxLength={120} autoFocus /></label><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setNotebookDialog(false)}>CANCELAR</button><button className="primary-button" disabled={busy}>{busy ? 'CRIANDO…' : 'CRIAR CADERNO'}</button></div></form></Modal>}
    {pendingDelete && <Modal title="EXCLUIR NOTA" onClose={() => { if (!busy) setPendingDelete(null) }}><p className="dialog-copy">Excluir <strong>{pendingDelete.title}</strong>? A publicação e estados de leitura relacionados também serão removidos.</p><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setPendingDelete(null)}>CANCELAR</button><button className="danger-button" type="button" disabled={busy} onClick={() => void handleDeleteNote()}>{busy ? 'EXCLUINDO…' : 'EXCLUIR NOTA'}</button></div></Modal>}
  </section>
}

function EventsPanel({ campaign, onNotice }: { campaign: Campaign; onNotice: (notice: Notice) => void }) {
  const [workspace, setWorkspace] = useState<EditorialWorkspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [temporary, setTemporary] = useState(false)

  const reload = useCallback(async () => setWorkspace(await getEditorialWorkspace(campaign.id)), [campaign.id])
  useEffect(() => {
    let active = true
    void getEditorialWorkspace(campaign.id)
      .then((result) => { if (active) setWorkspace(result) })
      .catch((error: unknown) => onNotice({ kind: 'error', text: errorMessage(error) }))
      .finally(() => { if (active) setLoading(false) })
    if (!supabase) return () => { active = false }
    const realtime = supabase
    const channel = realtime.channel(`events-panel-${campaign.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'campaign_events', filter: `campaign_id=eq.${campaign.id}` }, () => {
        if (active) void reload().catch((error: unknown) => onNotice({ kind: 'error', text: errorMessage(error) }))
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onNotice({ kind: 'error', text: 'A sincronização de EVENTS.SYS foi interrompida. Tentando restabelecer a conexão.' })
      })
    return () => {
      active = false
      void realtime.removeChannel(channel)
    }
  }, [campaign.id, onNotice, reload])

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    if (!selectedIds.length) {
      onNotice({ kind: 'error', text: 'Selecione pelo menos um destinatário para o evento.' })
      return
    }
    if (temporary && !workspace?.activeSessionId) {
      onNotice({ kind: 'error', text: 'Inicie uma sessão em SESSION.SYS para criar eventos temporários.' })
      return
    }
    const form = new FormData(formElement)
    setBusy(true)
    try {
      await sendCampaignEvent({
        campaignId: campaign.id,
        sessionId: workspace?.activeSessionId ?? null,
        title: String(form.get('title') ?? ''),
        body: String(form.get('body') ?? ''),
        eventType: String(form.get('eventType') ?? 'alert'),
        presentation: String(form.get('presentation') ?? 'standard'),
        temporary,
        memberIds: selectedIds,
      })
      await reload()
      setSelectedIds([])
      formElement.reset()
      onNotice({ kind: 'success', text: 'Evento disparado e notificação entregue aos jogadores selecionados.' })
    } catch (error) {
      onNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="empty-state"><p>CARREGANDO EVENTS.SYS…</p></div>
  const activeMembers = workspace?.members.filter((member) => !member.is_blocked) ?? []
  return <section className="editorial-panel">
    <div className="panel-title"><div><p className="eyebrow">EVENTS.SYS // TRANSMISSÃO NARRATIVA</p><h1>Disparar evento</h1><p className="panel-subtitle">Eventos são enviados manualmente e geram notificações na mesa dos jogadores.</p></div></div>
    <form className="form-stack event-compose" onSubmit={(event) => void handleSend(event)}>
      <label>Título<input name="title" required maxLength={200} /></label>
      <div className="event-form-grid">
        <label>Tipo<select name="eventType"><option value="alert">Alerta</option><option value="urgent">Urgente</option><option value="terminal">Mensagem de terminal</option><option value="failure">Falha</option><option value="incident">Incidente</option><option value="custom">Personalizado</option></select></label>
        <label>Apresentação<select name="presentation"><option value="standard">Padrão</option><option value="emergency">Emergência</option><option value="quiet">Discreta</option></select></label>
      </div>
      <label>Conteúdo<textarea name="body" required rows={6} maxLength={10000} /></label>
      <label className="session-visibility"><input type="checkbox" checked={temporary} disabled={!workspace?.activeSessionId || busy} onChange={(event) => setTemporary(event.target.checked)} />Marcar como temporário da sessão ativa{!workspace?.activeSessionId && <small> — inicie uma sessão em SESSION.SYS para habilitar</small>}</label>
      <RecipientSelector members={workspace?.members ?? []} selectedIds={selectedIds} onChange={setSelectedIds} />
      <button className="primary-button" disabled={busy || !activeMembers.length || !selectedIds.length}>{busy ? 'TRANSMITINDO…' : 'DISPARAR EVENTO'}</button>
    </form>
    <section className="mail-sent-list events-history"><p className="eyebrow">HISTÓRICO DE EVENTOS // {workspace?.events.length ?? 0}</p>
      {workspace?.events.length ? workspace.events.map((item) => <article className="editorial-card event-history-item" key={item.id}>
        <div className="editorial-card-heading"><span className="eyebrow">{item.event_type.toUpperCase()} // {item.presentation.toUpperCase()}{item.is_temporary ? ' // TEMPORÁRIO' : ' // PERMANENTE'}</span><small>{new Date(item.created_at).toLocaleString('pt-BR')}</small></div>
        <h2>{item.title}</h2><p className="editorial-preview">{item.body}</p><p className="editorial-recipients">DESTINATÁRIOS // {item.recipients.join(', ') || 'nenhum participante ativo'}</p>
      </article>) : <div className="empty-state"><h2>Nenhum evento disparado</h2><p>Os eventos enviados serão registrados aqui.</p></div>}
    </section>
  </section>
}

function SessionPanel({ campaign, onNotice }: { campaign: Campaign; onNotice: (notice: Notice) => void }) {
  const [session, setSession] = useState<CampaignSession | null>(null)
  const [history, setHistory] = useState<CampaignSession[]>([])
  const [settings, setSettings] = useState<SessionSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [clockNow, setClockNow] = useState(() => new Date().getTime())
  const [showEndDialog, setShowEndDialog] = useState(false)
  const [cleanup, setCleanup] = useState({ globalChat: false, localChat: false, temporaryActivity: true })

  const reload = useCallback(async () => {
    const workspace = await getSessionWorkspace(campaign.id)
    setSession(workspace.current)
    setHistory(workspace.history)
    setSettings(workspace.settings)
  }, [campaign.id])

  useEffect(() => {
    let active = true
    void getSessionWorkspace(campaign.id)
      .then((workspace) => {
        if (!active) return
        setSession(workspace.current)
        setHistory(workspace.history)
        setSettings(workspace.settings)
      })
      .catch((error: unknown) => onNotice({ kind: 'error', text: errorMessage(error) }))
      .finally(() => { if (active) setLoading(false) })
    if (!supabase) return () => { active = false }
    const realtime = supabase
    const channel = realtime.channel(`session-panel-${campaign.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'campaign_sessions', filter: `campaign_id=eq.${campaign.id}` }, () => {
        if (active) void reload().catch((error: unknown) => onNotice({ kind: 'error', text: errorMessage(error) }))
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'campaign_settings', filter: `campaign_id=eq.${campaign.id}` }, () => {
        if (active) void reload().catch((error: unknown) => onNotice({ kind: 'error', text: errorMessage(error) }))
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onNotice({ kind: 'error', text: 'A sincronização de SESSION.SYS foi interrompida. Tentando restabelecer a conexão.' })
      })
    return () => {
      active = false
      void realtime.removeChannel(channel)
    }
  }, [campaign.id, onNotice, reload])

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const elapsed = session
    ? session.timer_elapsed_seconds + (session.timer_started_at ? Math.max(0, Math.floor((clockNow - Date.parse(session.timer_started_at)) / 1000)) : 0)
    : 0
  const historyDuration = (item: CampaignSession) => item.timer_elapsed_seconds
    + (item.timer_started_at && item.ended_at
      ? Math.max(0, Math.floor((Date.parse(item.ended_at) - Date.parse(item.timer_started_at)) / 1000))
      : 0)

  async function perform(action: () => Promise<void>, successText: string) {
    setBusy(true)
    try {
      await action()
      await reload()
      onNotice({ kind: 'success', text: successText })
    } catch (error) {
      onNotice({ kind: 'error', text: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  async function saveIndicator(key: 'energy' | 'oxygen' | 'integrity', value: string) {
    if (!session) return
    const parsed = value === '' ? null : Number(value)
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 0 || parsed > 100)) {
      onNotice({ kind: 'error', text: 'Informe um valor inteiro entre 0 e 100.' })
      await reload().catch((error: unknown) => onNotice({ kind: 'error', text: errorMessage(error) }))
      return
    }
    await perform(() => updateCampaignSession(session.id, { [key]: parsed }), 'Indicador atualizado.')
  }

  async function saveSettings(key: keyof SessionSettings, checked: boolean) {
    if (!settings) return
    await perform(() => updateSessionSettings(campaign.id, { [key]: checked }), 'Exibição do indicador atualizada.')
  }

  async function toggleTimer() {
    if (!session) return
    if (session.timer_started_at) {
      await perform(() => updateCampaignSession(session.id, {
        timer_started_at: null,
        timer_elapsed_seconds: elapsed,
      }), 'Cronômetro pausado.')
    } else {
      await perform(() => updateCampaignSession(session.id, { timer_started_at: new Date().toISOString() }), 'Cronômetro iniciado.')
    }
  }

  async function confirmEndSession() {
    if (!session) return
    await perform(async () => {
      await endCampaignSession(session.id, cleanup)
      setShowEndDialog(false)
    }, 'Sessão encerrada. Os dados permanentes foram preservados.')
  }

  return <section className="session-panel">
    <p className="eyebrow">SESSION.SYS // CONTROLE DA OPERAÇÃO</p>
    <h1>Painel de sessão</h1>
    <p className="detail-description">Cronômetro, relógio e indicadores são sincronizados pelo Supabase e exibidos aos jogadores conforme as opções abaixo.</p>
    {loading ? <div className="empty-state"><p>CARREGANDO DADOS DA SESSÃO…</p></div> : !session ? <div className="session-start-card">
      <h2>Nenhuma sessão ativa</h2><p>Inicie uma sessão para habilitar o cronômetro e associar o chat e os eventos temporários a esta operação.</p>
      <form className="session-start-form" onSubmit={(event) => {
        event.preventDefault()
        const label = String(new FormData(event.currentTarget).get('label') ?? '').trim()
        if (label) void perform(() => startCampaignSession(campaign.id, label), 'Sessão iniciada.')
      }}>
        <label>Nome da sessão<input name="label" required maxLength={100} defaultValue="Sessão" /></label>
        <button className="primary-button" disabled={busy}>{busy ? 'INICIANDO…' : 'INICIAR SESSÃO'}</button>
      </form>
    </div> : <>
      <div className="session-overview">
        <div><p className="eyebrow">SESSÃO ATIVA</p><h2>{session.label}</h2><p>Iniciada {new Date(session.started_at).toLocaleString('pt-BR')}</p></div>
        <div className="session-timer"><span>CRONÔMETRO</span><strong>{formatDuration(elapsed)}</strong><button className="secondary-button" type="button" disabled={busy} onClick={() => void toggleTimer()}>{session.timer_started_at ? 'PAUSAR' : 'INICIAR'}</button></div>
      </div>
      <div className="session-controls">
        <section className="detail-block"><p className="eyebrow">RELÓGIO DA NAVE</p><label>Horário exibido<input value={session.ship_clock} maxLength={80} placeholder="Ex.: 08:42 / 12 DE JULHO" disabled={busy} onChange={(event) => setSession({ ...session, ship_clock: event.target.value })} onBlur={() => void perform(() => updateCampaignSession(session.id, { ship_clock: session.ship_clock }), 'Relógio da nave atualizado.')} /></label>
          <label className="session-visibility"><input type="checkbox" checked={settings?.show_ship_clock ?? true} disabled={busy} onChange={(event) => void saveSettings('show_ship_clock', event.target.checked)} />Exibir aos jogadores</label>
        </section>
        {([
          { key: 'energy', label: 'Energia', setting: 'show_energy' },
          { key: 'oxygen', label: 'Oxigênio', setting: 'show_oxygen' },
          { key: 'integrity', label: 'Integridade', setting: 'show_integrity' },
        ] as const).map(({ key, label, setting }) => <section className="detail-block" key={key}>
          <p className="eyebrow">{label.toUpperCase()}</p><label>Valor (0–100)<input type="number" min="0" max="100" step="1" value={session[key] ?? ''} disabled={busy} onChange={(event) => setSession({ ...session, [key]: event.target.value === '' ? null : Number(event.target.value) })} onBlur={(event) => void saveIndicator(key, event.target.value)} /></label>
          <label className="session-visibility"><input type="checkbox" checked={settings?.[setting] ?? true} disabled={busy} onChange={(event) => void saveSettings(setting, event.target.checked)} />Exibir aos jogadores</label>
        </section>)}
      </div>
      <section className="detail-danger session-end"><div><p className="eyebrow">ENCERRAMENTO EXPLÍCITO</p><h2>Finalizar sessão</h2><p>Escolha quais dados temporários serão removidos. E-mails, arquivos, notas, fichas e configurações permanecem intactos.</p></div><button className="danger-button" type="button" disabled={busy} onClick={() => setShowEndDialog(true)}>ENCERRAR SESSÃO</button></section>
    </>}
    <section className="session-history">
      <div className="panel-title"><div><p className="eyebrow">HISTÓRICO // ÚLTIMAS 25</p><h2>Sessões encerradas</h2></div></div>
      {loading ? <p className="empty-copy">Carregando o histórico…</p> : history.length ? <div className="session-history-list">{history.map((item) => <article className="session-history-row" key={item.id}>
        <div><strong>{item.label}</strong><span>Início {new Date(item.started_at).toLocaleString('pt-BR')}</span><span>Encerrada {item.ended_at ? new Date(item.ended_at).toLocaleString('pt-BR') : '—'}</span></div>
        <div><span>DURAÇÃO</span><strong>{formatDuration(historyDuration(item))}</strong></div>
      </article>)}</div> : <p className="empty-copy">Nenhuma sessão encerrada foi registrada.</p>}
    </section>
    {showEndDialog && <Modal title="ENCERRAR SESSÃO" onClose={() => setShowEndDialog(false)}>
      <p className="dialog-copy">A sessão será encerrada agora. Selecione os dados temporários que deseja excluir; itens não selecionados permanecerão vinculados à campanha.</p>
      <div className="session-cleanup-options">
        <label><input type="checkbox" checked={cleanup.globalChat} onChange={(event) => setCleanup({ ...cleanup, globalChat: event.target.checked })} />Apagar mensagens do chat GLOBAL desta sessão</label>
        <label><input type="checkbox" checked={cleanup.localChat} onChange={(event) => setCleanup({ ...cleanup, localChat: event.target.checked })} />Apagar mensagens do chat LOCAL desta sessão</label>
        <label><input type="checkbox" checked={cleanup.temporaryActivity} onChange={(event) => setCleanup({ ...cleanup, temporaryActivity: event.target.checked })} />Apagar eventos e registros temporários desta sessão</label>
      </div>
      <p className="form-hint">Dados permanentes da campanha não serão removidos. Esta operação não pode ser desfeita.</p>
      <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setShowEndDialog(false)}>CANCELAR</button><button className="danger-button" type="button" disabled={busy} onClick={() => void confirmEndSession()}>{busy ? 'ENCERRANDO…' : 'CONFIRMAR ENCERRAMENTO'}</button></div>
    </Modal>}
  </section>
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600).toString().padStart(2, '0')
  const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0')
  const remainder = (seconds % 60).toString().padStart(2, '0')
  return `${hours}:${minutes}:${remainder}`
}

function ConfigurationNotice({ message }: { message: string | null }) {
  return <main className="simple-screen"><div className="simple-card config-card">
    <p className="eyebrow">CONFIGURAÇÃO NECESSÁRIA</p><h1>Conecte seu projeto Supabase</h1>
    <p>O cliente estático não pode funcionar sem a URL do projeto e a chave pública anon/publishable. Nenhuma credencial foi inventada ou embutida no código.</p>
    {message && <p className="config-error" role="alert">{message}</p>}
    <ol><li>Crie um arquivo <code>.env.local</code> na raiz do projeto.</li><li>Preencha <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> com os valores do painel Supabase.</li><li>Execute a migração SQL de <code>supabase/migrations</code> no SQL Editor.</li></ol>
    <a className="text-link" href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">Abrir painel do Supabase ↗</a>
  </div></main>
}

function LoadingScreen() {
  return <main className="simple-screen"><div className="loading-state"><span className="loading-mark">M</span><p>INICIALIZANDO SISTEMA…</p></div></main>
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: import('react').ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal-header"><h2 id="modal-title">{title}</h2><button className="modal-close" type="button" onClick={onClose} aria-label="Fechar">×</button></div>
      {children}
    </section>
  </div>
}

async function copyText(text: string) {
  if (!navigator.clipboard) throw new Error('A cópia automática exige uma conexão HTTPS. Copie o link pela barra de endereço.')
  await navigator.clipboard.writeText(text)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação. Tente novamente.'
}

export default App
