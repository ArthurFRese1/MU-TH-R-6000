# MU/TH/R 6000

Plataforma web estática para gerenciamento de campanhas de RPG, com identidade de computador de bordo. O frontend usa React + TypeScript + Vite; autenticação, PostgreSQL, RLS e Realtime são fornecidos pelo Supabase. O deploy estático é feito pelo GitHub Pages.

> **Estado do projeto:** o produto segue em desenvolvimento e ainda requer validação em um projeto Supabase real. Veja [DEVELOPMENT_STATUS.md](./DEVELOPMENT_STATUS.md) para o que foi implementado, o que falta e os testes executados. Não use em uma campanha real antes dos testes de isolamento, Storage e integração ainda pendentes.

## Arquitetura e pastas

```text
src/
  lib/
    campaigns.ts       operações de campanhas, convites e entrada
    player.ts          mesa do jogador, conteúdos privados e telemetria
    mail.ts            correio interno, destinatários e imagens privadas
    settings.ts        preferências da campanha e gestão de convites
    sessions.ts        sessão atual, indicadores e encerramento seletivo
    editorial.ts       notas, cadernos, eventos e destinatários
    activity.ts       consulta e paginação do histórico de atividades
    supabase.ts        cliente Supabase opcional e configuração de sessão
  App.tsx              autenticação e fluxo inicial do mestre/jogador
  App.css              terminal responsivo e componentes
  index.css            tokens visuais e estilos globais
supabase/
  migrations/          SQL versionado para executar pelo painel Supabase
.github/workflows/
  deploy.yml           build e publicação estática no GitHub Pages
```

O cliente usa somente a chave `anon`/publishable. A chave `service_role` nunca deve estar no navegador. Nenhuma senha, chave privada ou URL de projeto foi incluída no código. As chamadas de criação/entrada de campanha usam funções PostgreSQL validadas no backend; as tabelas privadas têm RLS. A tabela `local_messages` não concede leitura ao mestre, inclusive por requisições REST diretas.

## Configuração do Supabase

1. No [painel Supabase](https://supabase.com/dashboard), abra o projeto e vá a **Project Settings → API**.
2. Copie a **Project URL** (a raiz do projeto, sem `/rest/v1`) e a chave **anon/public** (ou publishable key) para `.env.local`, na raiz:

   ```dotenv
   VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
   VITE_SUPABASE_ANON_KEY=SUA_CHAVE_PUBLICA_ANON
   VITE_BASE_PATH=/
   ```

   `.env.local` é ignorado pelo Git. Nunca use a chave `service_role` aqui.
3. Em **Authentication → Sign In / Providers**, habilite o provedor **Anonymous** e **Email**. Mantenha a confirmação de e-mail habilitada para contas de mestre.
4. Em **SQL Editor**, execute integralmente as migrações numeradas em `supabase/migrations`, da `202611030001_foundation.sql` à `202611050014_recovery_campaign_scope.sql`, na ordem. Cada arquivo é uma migração separada. Se as migrações 001–013 já foram aplicadas, execute somente a 014; nunca reexecute migrações já aplicadas.
5. A segunda migração adiciona tabelas dos módulos e políticas restritivas próprias para o bucket privado já existente `campaign-files`. As migrações seguintes acrescentam operações transacionais de e-mail, sessão, notas/eventos, distribuição de arquivos validada por campanha, registro de atividades da tripulação, qualificação de `pgcrypto`, entrada de contas autenticadas como jogadores em campanhas onde não são proprietárias, fechamento individual persistente dos alertas recebidos e recuperação de participação escopada pela campanha. A migração 011 habilita `pgcrypto` em `extensions` caso ainda não esteja instalada e usa o schema em que a extensão está efetivamente instalada. A migração 012 associa a participação ao mesmo usuário autenticado, sem dar privilégios de mestre naquela campanha; as ações de jogador continuam condicionadas à participação ativa e a recuperação de identidade continua reservada a sessões anônimas. A migração 013 salva o fechamento exclusivamente na participação destinatária e não remove o evento do histórico. A migração 014 localiza a participação pelo identificador fornecido e o e-mail fictício dentro da mesma campanha, sem exigir que o convite continue ativo; a transferência continua dependendo da aprovação explícita do mestre. Nenhuma migração cria, remove nem torna público o bucket `campaign-files`, nem altera seu limite/tipos MIME. Revise as políticas pré-existentes antes de aplicar.
6. No painel, confirme que a publicação `supabase_realtime` existe. As migrações habilitam notificações, e-mails, eventos, sessões, configurações e histórico de atividades para sincronização quando ainda não estão incluídos.
7. Cadastre uma conta de mestre, confirme o endereço e entre. O trigger de perfil identifica contas convencionais como mestres; sessões anônimas de jogadores não recebem essa permissão. Uma conta de mestre também pode aceitar o convite de outra campanha com nome de jogador e e-mail fictício; use o seletor **TRIPULAÇÃO/COMANDO** para alternar entre a mesa como jogador e as campanhas que administra, sem encerrar a sessão.

## Desenvolvimento local

1. Instale Node.js 22 ou superior.
2. Instale dependências com `npm install`.
3. Configure `.env.local` usando as etapas acima.
4. No VS Code, escolha **Terminal → Executar Tarefa… → MU/TH/R: iniciar servidor local (Vite)**. O terminal integrado mostrará o endereço local do Vite; abra esse endereço (normalmente `http://127.0.0.1:5173/MU-TH-R-6000/`). Alternativamente, inicie o servidor com `npm run dev`. Durante o desenvolvimento, falhas de criação de campanha e aceite de convite também são encaminhadas ao terminal com `code`, `message`, `details`, `hint` e `status`; tokens e chaves são omitidos/redigidos. Essa rota de diagnóstico não existe no build de produção.
5. Antes de publicar, execute `npm run lint` e `npm run build`. A compilação separa os pacotes de terceiros em um chunk `vendor` para manter os arquivos JavaScript de produção abaixo de 500 kB.

Sem `.env.local`, a interface abre uma tela explicando a configuração necessária. Autenticação exige a URL/chave pública do Supabase; criação e gerenciamento de campanhas também exigem que as migrações SQL deste projeto estejam aplicadas.

Não abra `index.html` usando Live Server (porta 5500) nem diretamente pelo sistema de arquivos: o ponto de entrada usa TypeScript/TSX, que precisa ser transformado pelo Vite. Servir `/src/main.tsx` como arquivo estático provoca erro de MIME `application/octet-stream`. Nesse caso, a página agora mostra instruções em vez de ficar branca. Use a tarefa **MU/TH/R: iniciar servidor local (Vite)** no VS Code e abra o endereço mostrado no terminal integrado; a tarefa abre o endereço automaticamente. Para testar a build de produção, use `npm run build` e `npm run preview`.

## GitHub Pages

1. Publique o repositório no GitHub com a branch `main`.
2. Em **Settings → Secrets and variables → Actions → Variables**, crie `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` com os valores públicos do Supabase.
3. Em **Settings → Pages**, selecione **GitHub Actions** como fonte de publicação.
4. O workflow `.github/workflows/deploy.yml` compila com o caminho base `/<nome-do-repositório>/` e publica o site após cada push em `main`. O site não usa rotas de servidor, então atualizar/acessar a URL do convite (`?invite=...`) funciona no Pages.
5. Em **Authentication → URL Configuration**, adicione o endereço de produção em **Site URL / Redirect URLs**, incluindo a rota usada na recuperação de senha.

A chave anon é pública por definição; a proteção dos dados depende de RLS e funções SQL, nunca de esconder essa chave. O workflow usa GitHub Actions **Variables**, não registra segredos de servidor no bundle.

## Banco e permissões implementados

- `profiles`: perfil da identidade autenticada; a coluna `is_master` é preenchida por trigger.
- `campaigns`, `campaign_invites`, `campaign_members`: propriedade da campanha, convites com validade/limite de uso e identidades independentes por participação.
- `campaign_settings`, `campaign_sessions`: configurações essenciais e estado de sessão/indicadores.
- `send_campaign_email`, `reply_to_campaign_email`, `end_campaign_session`: RPCs validam propriedade/destinatários, permissão para respostas e exclusão seletiva de dados temporários.
- `save_campaign_note`, `delete_campaign_note`, `send_campaign_event`: validam cadernos, visibilidade e destinatários; publicações e notificações são aplicadas atomicamente.
- `distribute_campaign_file`: valida que todos os destinatários ativos pertencem à campanha do arquivo; impede associações entre campanhas e cria notificações apenas para novas distribuições.
- `global_messages`, `local_messages`: mensagens com vínculo opcional à sessão. O contexto Comando usa o chat global; o contexto Tripulação usa os canais da participação ativa. RLS do chat local nega acesso ao proprietário, mesmo que seja mestre em outra campanha.
- CHAT.SYS dispõe de canais separados: o jogador pode alternar entre global e local; ambos permitem responder, editar/excluir mensagens próprias, emojis e atualização Realtime; o chat local também permite apelido e indicação temporária de digitação. Há histórico paginado, aviso de novas mensagens e rótulo de sessão. Mensagens são vinculadas à sessão ativa e podem ser removidas pelo fluxo de encerramento seletivo.
- `character_sheets`, `saved_senders`, `campaign_emails`/destinatários/imagens e `campaign_folders`/`campaign_files`/destinatários: estrutura de ficha, comunicação e distribuição de arquivos privados.
- `campaign_notebooks`, `campaign_notes`, destinatários, estados de leitura e anotações privadas: publicação seletiva e dados privados do jogador.
- `campaign_events`, destinatários, comunicados, notificações, histórico de atividades, preferências de interface, indicadores de digitação e pedidos de recuperação de identidade.
- A ficha do personagem fica vinculada à participação da campanha e contém somente nome do personagem, cargo, função e descrição. `202611030007_character_sheet_name.sql` adiciona o nome próprio do personagem sem alterar a identidade de jogador nem permitir que o mestre renomeie a participação.
- LOG.SYS lista atividades permanentes e temporárias, permite filtrar/buscar/paginar e recebe atualizações em tempo real. A migração `202611030006_activity_log.sql` registra entrada, bloqueio/desbloqueio e remoção de jogadores; operações de e-mail, notas, eventos, arquivos e encerramento de sessão também geram registros.
- A recuperação exige nova sessão anônima e convite ativo. O jogador informa o e-mail fictício da participação, mas isso apenas abre uma solicitação pendente: não concede acesso. O mestre deve confirmar com a pessoa e aprovar; a função SQL transfere o vínculo existente sem apagar dados e a identidade anterior perde acesso. A tabela de solicitações não permite alterações diretas pelo cliente; solicitações e decisões ficam no LOG.SYS.
- SETTINGS.SYS permite alterar nome, descrição e URL da capa, personalizar a mensagem de boas-vindas, controlar respostas a e-mails e indicadores visíveis, e gerar convites com validade e limite de usos. A revogação de convites usa RPC validada pelo proprietário e registra a ação no LOG.SYS.
- A restauração de backup usa a RPC `restore_campaign_email` para preservar a segurança da tabela de e-mails; clientes autenticados continuam sem permissão de inserção direta nessa tabela.
- INTERFACE.SYS salva por participação a posição/recolhimento da lista de e-mails e a ordem dos painéis informativos; chat e notificações permanecem fixos.
- MAIL.SYS organiza respostas pelo campo `reply_to_id`. O mestre pode responder a um fio e direcionar a resposta aos participantes; jogadores veem as respostas recebidas no contexto da conversa.
- Todas as tabelas das migrações usam RLS. Convites e transferência de identidade possuem funções SQL com checagens de validade, identidade, propriedade e unicidade.
- Contas de mestre confirmadas podem aceitar convites de campanhas que não possuem usando o mesmo login; a participação do jogador e as permissões permanecem específicas para cada campanha. Alterne entre Comando e Tripulação sem encerrar a sessão.
- A leitura de `local_messages` e dos indicadores `local` requer participação ativa; a política não concede acesso ao proprietário, mesmo que a conta do jogador também seja mestre em outra campanha. Anotações privadas de jogadores não possuem política de leitura para o mestre.
- As políticas Storage permitem leitura apenas ao proprietário ou aos destinatários cadastrados; jogadores não podem inserir arquivos. A exclusão do registro de arquivo é bloqueada enquanto o objeto correspondente ainda existir no bucket.
- A exclusão de campanha é permitida apenas ao mestre proprietário; FKs `ON DELETE CASCADE` removem os registros dependentes dessas tabelas.

## Backup, dados pessoais e Storage

MAIL.SYS possui envio transacional, destinatários selecionados, remetentes salvos, anexos privados, fios de respostas e configuração mestre para respostas; NOTES.SYS permite organizar notas por cadernos e publicar seletivamente; EVENTS.SYS dispara eventos com destinatários, notificações e marcação temporária; FILES.SYS permite upload, pastas, acesso seletivo, substituição e visualização privada; SESSION.SYS controla cronômetro, indicadores, limpeza seletiva e exibe as 25 sessões encerradas mais recentes; CHAT.SYS separa o canal global do canal local protegido por RLS; SETTINGS.SYS configura campanha, convites, comunicação e indicadores; INTERFACE.SYS persiste preferências por participação. Backup `.muthr` preserva os dados e arquivos da campanha e restaura como uma nova campanha, remapeando IDs e relações. Por segurança, a restauração não transfere identidades, jogadores, destinatários, dados privados do jogador nem chat local; conteúdos restaurados não são distribuídos automaticamente. O navegador limita o conjunto de arquivos a 500 MB. Testes contra um projeto Supabase real ainda estão pendentes. As telas e funções implementadas não foram validadas contra credenciais de um projeto real. O bucket privado `campaign-files` já existente não é recriado nem tornado público. Consulte o estado detalhado e as limitações conhecidas em [DEVELOPMENT_STATUS.md](./DEVELOPMENT_STATUS.md).
