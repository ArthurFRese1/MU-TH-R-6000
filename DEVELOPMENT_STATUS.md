# Acompanhamento do desenvolvimento

Atualizado em 2026-11-05.

## Diagnóstico inicial

A pasta de trabalho estava vazia, sem aplicação anterior, banco/migrações, dependências ou documentação de projeto. O repositório foi inicializado como aplicação estática React + TypeScript + Vite. Não havia comportamento existente para remover ou substituir.

## Concluído e verificado

- [x] Esqueleto React + TypeScript + Vite e configuração de build com caminho-base variável.
- [x] Identidade visual inicial MU/TH/R em português, adaptada a desktop e dispositivos móveis.
- [x] Cliente Supabase opcional por variáveis de ambiente públicas; nenhuma credencial real foi inventada.
- [x] Cadastro de mestre, login, recuperação de senha e encerramento de sessão pela API Supabase.
- [x] Migração inicial com perfis, campanhas, convites, participações, configurações, sessões e mensagens globais/locais.
- [x] Segunda migração com estrutura de dados RLS para fichas, MAIL.SYS, FILES.SYS, NOTES.SYS, EVENTS.SYS, comunicados, notificações, registros, preferências, digitação e pedidos de recuperação.
- [x] Terceira migração aditiva com RPCs de envio/resposta de e-mail e encerramento seletivo de sessão, sem recriar Storage nem apagar dados.
- [x] Quarta migração com RPCs transacionais para salvar/publicar/excluir notas e disparar eventos.
- [x] Quinta migração com distribuição de arquivos validada na campanha e limpeza das notificações ao remover/substituir arquivos.
- [x] Políticas Storage de acesso restrito e proteção contra apagar metadados de arquivos enquanto o objeto ainda existe.
- [x] Workflow de exclusão de campanha remove primeiro os objetos Storage, depois metadados e por fim os registros da campanha.
- [x] RLS nas tabelas da migração, funções para criar campanha, validar convite e ingresso anônimo, com uso/expiração verificados no banco.
- [x] Isolamento de leitura do chat local: participação ativa em campanha onde o usuário não é proprietário; a identidade mestre não recebe acesso por papel global.
- [x] Interface para criar, listar, selecionar e excluir campanhas; geração/renovação do link de convite e preview/entrada de jogadores.
- [x] Confirmação de exclusão, avisos de erro/sucesso e estados sem dados/configuração.
- [x] Mesa inicial do jogador: entrada com boas-vindas, conteúdos enviados, notificações, leitura/arquivo de notas, anotações privadas e abertura de arquivos autorizados.
- [x] SESSION.SYS inicial: iniciar sessão, cronômetro persistente com pausa/retomada, relógio da nave, indicadores manuais, controles de visibilidade e encerramento com limpeza seletiva.
- [x] SESSION.SYS exibe as 25 sessões encerradas mais recentes com datas e duração calculada inclusive quando o cronômetro estava ativo no encerramento.
- [x] Indicadores de sessão visíveis ao jogador e sincronizados por Supabase Realtime.
- [x] MAIL.SYS inicial: remetentes salvos, composição, seleção de destinatários, envio transacional, anexos de imagem privados e respostas autorizadas de jogadores.
- [x] MAIL.SYS com visualização encadeada de mensagens e respostas por `reply_to_id`; respostas do mestre preservam o fio e podem ser direcionadas aos participantes ativos.
- [x] Configuração do mestre em MAIL.SYS para habilitar/desabilitar respostas, validada no RPC e sincronizada para a mesa do jogador.
- [x] NOTES.SYS inicial: cadernos, notas privadas, publicação e edição por destinatário, notificações, histórico, e remoção coordenada das publicações.
- [x] EVENTS.SYS inicial: disparo manual tipado/apresentado a jogadores escolhidos, histórico e classificação de eventos temporários vinculados à sessão.
- [x] FILES.SYS inicial: pastas, upload de imagens/PDFs dentro do limite, distribuição seletiva, visualização por URL assinada, substituição de objetos e remoção com limpeza de Storage/metadados.
- [x] RPC de distribuição de arquivos verifica no banco a campanha, estado ativo e unicidade de cada participação destinatária.
- [x] RPCs de envio/resposta de e-mail e encerramento de sessão com validação de campanha no banco.
- [x] CHAT.SYS: canal global para mestre/jogadores e canal local exclusivo de jogadores, histórico paginado com sessão, respostas, edição/exclusão próprias com confirmação, apelidos, emojis, indicador de digitação, notificações de mensagens não lidas e atualização/reconexão Realtime.
- [x] LOG.SYS: histórico de atividades permanente/temporário com pesquisa, filtros, paginação e Realtime; eventos de entrada, bloqueio, desbloqueio e remoção de jogador passam a ser registrados.
- [x] Ficha do personagem na mesa do jogador: nome do personagem, cargo, função e descrição independentes por campanha, sem alterar o nome da identidade de acesso.
- [x] Recuperação de identidade: solicitação sem concessão automática, revisão do mestre, transferência da participação via RPC protegida e auditoria no LOG.SYS.
- [x] SETTINGS.SYS: edição de dados da campanha, exibição segura da capa no convite/mesa/cartões do mestre, boas-vindas, permissão de resposta, visibilidade de indicadores e geração/revogação de convites com validade e limite de usos.
- [x] Preferências INTERFACE.SYS salvas por participação: posição/recolhimento da lista de e-mails e ordenação dos painéis de informações.
- [x] Backup `.muthr`: exportação local e restauração como nova campanha, incluindo Storage privado e remapeamento de sessões, mensagens, pastas, arquivos, imagens, respostas, cadernos, notas, eventos e registros permanentes.
- [x] Importação com validação de estrutura/relações, confirmação explícita, limite de 500 MB de objetos e limpeza da campanha parcial em caso de falha.
- [x] A importação de e-mails utiliza uma RPC de proprietário; o cliente não recebe permissão de escrita direta em `campaign_emails`. Consultas do backup são paginadas para não parar no limite padrão de linhas do PostgREST.
- [x] Conta autenticada de mestre pode participar como jogador em outra campanha, mantendo o mesmo login; a participação usa nome e e-mail fictício próprios e o papel é alternado entre Comando e Tripulação.
- [x] A migration aditiva 012 permite entrada por convite de conta mestre confirmada e autoriza chat local, aliases, indicadores locais e respostas de e-mail por participação ativa, sem conceder acesso de jogador ao proprietário da campanha ou ampliar recuperação de identidade.
- [x] EVENTS.SYS exibe alertas em tela cheia, com fila individual por destinatário e fechamento persistido em `campaign_event_recipients`; migration aditiva 013 limita o fechamento à participação autenticada e preserva o evento no histórico.
- [x] Recuperação de participação não depende mais de o convite continuar ativo ou ter usos disponíveis: a migration aditiva 014 valida a participação e o e-mail fictício dentro do ID da campanha, mantém a exigência de identidade anônima e aguarda aprovação do mestre.
- [x] O painel Comando consulta apenas campanhas próprias; campanhas em que a conta é jogadora aparecem no contexto Tripulação.
- [x] O contexto Comando só monta o canal global; o contexto Tripulação monta o canal local por participação ativa. RLS nega acesso ao proprietário da campanha.
- [x] Assinaturas Realtime removidas ao sair dos painéis de e-mail/sessão e da mesa do jogador.
- [x] Workflow de GitHub Pages, exemplo de variáveis, instruções de configuração do painel e da migração.
- [x] Build TypeScript/Vite e lint aprovados; pacotes de terceiros são separados em chunk `vendor`, sem chunks acima de 500 kB.
- [x] Bloqueio de build quando uma chave de `service_role`/secret é fornecida como chave do navegador.
- [x] Build com caminho-base de GitHub Pages conferido no HTML gerado.
- [x] URL de capa validada para HTTP/HTTPS e exibida nas telas públicas, do mestre e do jogador.
- [x] Convite gerado ou invalidado em SETTINGS.SYS sincroniza o link disponível em CAMPAIGN.SYS.
- [x] URL local do Supabase corrigida para a raiz do projeto; validação rejeita caminhos de API, query e fragmentos.
- [x] Favicon SVG declarado com caminho relativo para funcionar no servidor Vite e no GitHub Pages sob subcaminho.
- [x] Tarefa do VS Code para iniciar o servidor Vite com um clique; configuração incluída no Git e documentada para evitar abrir TSX pelo Live Server.
- [x] Página de entrada mostra instruções de inicialização se React não carregar (ex.: Live Server na porta 5500); tarefa Vite abre o navegador e reconhece o endereço com subcaminho.
- [x] Botão e modo temporário de visualização local removidos a pedido; configuração local e código demonstrativo também removidos.
- [x] Auditoria estática confirmou RLS e políticas nas 9 tabelas da migração-base e nas 22 tabelas dos módulos; ausência de política de leitura do chat local para o proprietário.
- [x] Smoke test visual da tela de configuração no navegador a 390 px, sem overflow horizontal.

## Pendente — não declarar pronto

- [x] Validar SETTINGS.SYS, preferências e MAIL.SYS encadeado com telas autenticadas e sessões Supabase reais.
- [x] Validar ficha do personagem com Supabase real e duas campanhas para confirmar persistência independente por participação.
- [x] Validar FILES.SYS com projeto Supabase real: pastas, distribuição, URLs privadas, substituição de objetos e restrições do Storage.
- [x] Validar NOTES.SYS com projeto Supabase real: cadernos, destinatários, estados de leitura/arquivo e privacidade das anotações.
- [x] Validar EVENTS.SYS, comunicados, notificações e LOG.SYS com campanha Supabase real, incluindo os novos gatilhos de auditoria.
- [x] Validar CHAT.SYS com projeto Supabase real: duas identidades de jogador, mestre, Realtime/RLS, edição/exclusão, indicador de digitação e expurgo seletivo por sessão.
- [x] Validar SESSION.SYS em dispositivos móveis e Supabase real: encerramento/limpeza seletiva e atualização sincronizada dos indicadores.
- [ ] Validar backup/restauração com Supabase real, incluindo limpeza após falha de Storage/RLS; identidades, destinatários e dados privados não são importados por segurança.
- [x] Aplicar no Supabase as migrations 011 (qualificação de `pgcrypto`, se ainda não aplicada) e 012 (participação de conta autenticada) e validar a criação de campanha e entrada como jogador com contas reais.
- [x] Testes de isolamento por dois jogadores/mestre e testes de abuso de RPC/RLS em projeto Supabase real.
- [x] Testes de integração com Supabase e execução manual dos cenários funcionais/security/mobile.
- [x] Testes unitários locais para validação de arquivos `.muthr` (10 casos); a cobertura ainda não abrange o restante dos módulos.
- [ ] Publicar no GitHub e testar deploy real no GitHub Pages/navegação autenticada; esta pasta não tem metadados Git nem remote configurado.

## Testes executados

| Validação | Resultado |
|---|---|
| `npm run build` | Aprovado (incluindo base `/MU-TH-R-6000/`); chunks de aplicação (181 kB) e `vendor` (434 kB) sem aviso de tamanho |
| `npm run lint` | Aprovado |
| `npm test` | Aprovado: 22 testes — backup `.muthr`, transição Comando/Tripulação, sanitização do diagnóstico e sincronização/fila de alertas |
| Migração `202611050013_individual_event_alert_dismissal.sql` | Parser PostgreSQL aprovado; adiciona fechamento individual protegido por participação ativa. Aplicação e RPC no Supabase real ainda pendentes |
| Pop-up de EVENTS.SYS | Build, lint e teste visual local desktop/mobile aprovados; animação alterna vermelho/branco em 1 s total, prefere movimento reduzido estático e não gera rolagem horizontal |
| Diagnóstico da sincronização da Tripulação | Build/lint/testes aprovados; falha de carga agora exibe erro com botão de nova tentativa e alerta específico se faltar a migration 013; estado do canal Realtime deixa de indicar conexão falsa |
| Diagnóstico de erro no terminal Vite | Aprovado em smoke test HTTP (204 e log dos campos permitidos); ativo somente no servidor de desenvolvimento, limite de 8 KB e redação de tokens/chaves |
| Migração `202611030011_qualify_pgcrypto_functions.sql` | Parser PostgreSQL aprovado; descobre o schema da extensão `pgcrypto` e qualifica `gen_random_bytes` em `create_campaign` e `rotate_campaign_invite`; execução real ainda pendente |
| Migração `202611030012_registered_player_memberships.sql` | Parser PostgreSQL aprovado; permite participação de conta mestre por convite sem alterar privilégios do proprietário |
| Capa e sincronização de convites | Build e lint aprovados; URLs de capa limitadas a HTTP/HTTPS na renderização |
| Validação da URL do Supabase | Build e lint aprovados; URLs REST com `/rest/v1` agora geram erro de configuração explícito |
| MIME e favicon local/produção | Vite serve `main.tsx` transformado como `text/javascript`; favicon como `image/svg+xml` com HTTP 200 no dev e preview; assets de produção como `text/javascript` |
| Remoção da visualização temporária | Confirmado sem referências no código/documentação nem strings no bundle; `VITE_ENABLE_LOCAL_DEMO` removida de `.env.local` |
| Tarefa local do VS Code | Configuração JSON validada; comando Vite equivalente serviu app, TSX e favicon com HTTP 200 e MIME correto |
| Abertura por Live Server | Página fonte de produção compila com fallback de instruções; matcher da tarefa reconhece a saída real do Vite e abre o URL automaticamente |
| SETTINGS.SYS e INTERFACE.SYS `npm run build` / `npm run lint` | Aprovados |
| MAIL.SYS com fios de respostas `npm run build` / `npm run lint` | Aprovados |
| Backup/restauração `.muthr` `npm run build` / `npm run lint` | Aprovados; RLS/Storage ainda não testados com Supabase real |
| Auditoria estática da migração | Aprovada: 9/9 tabelas base e 22/22 tabelas de módulos com RLS e políticas; chat local sem caminho do proprietário |
| Build com `service_role` de teste | Aprovado: build recusado antes de gerar o bundle |
| Smoke test responsivo | Aprovado em produção: interface pública sem overflow em 375 px e 1280 px; telas autenticadas dependem de Supabase |
| Parser PostgreSQL `pglast` | Aprovado: as doze migrações parseadas |
| Smoke test HTTP local | Aprovado: Vite respondeu HTTP 200 |
| CHAT.SYS `npm run build` e `npm run lint` | Aprovados, sem avisos |
| LOG.SYS `npm run build` e `npm run lint` | Build e lint aprovados na implementação inicial; o aviso histórico de tamanho foi resolvido pela divisão do chunk `vendor` |
| Ficha do personagem `npm run build` e `npm run lint` | Aprovados; migração aditiva parseada |
| Migração `202611030006_activity_log.sql` | Aprovada no parser SQL; ainda não executada em projeto Supabase real |
| Revisão estática do chat local | Aprovada: cliente Comando não consulta/assina `local_messages`; RLS autoriza somente participação ativa em campanha onde usuário não é proprietário |
| Checagem responsiva da tela de acesso | Aprovada em 375 px e 1280 px sem overflow; o login do mestre foi confirmado pelo usuário, mas os novos fluxos autenticados não foram testados neste ambiente |
| Preview de produção em `/MU-TH-R-6000/` e `?invite=...` | HTTP 200; asset URLs contêm o caminho base do repositório; sem overflow público em 375 px e 1280 px |
| Supabase configurado localmente | Corrigido `/rest/v1/` para a URL raiz; Auth health respondeu HTTP 200 |
| Diagnóstico RPC informado pelo usuário | `42883`: `function gen_random_bytes(integer) does not exist`; `search_path` da função não inclui o schema da extensão |
| Fluxo misto mestre/jogador | Implementado localmente; login único, seletor Comando/Tripulação e regras RLS por participação; Supabase real ainda não validado |
| Schema Supabase | Dez migrações originais executadas conforme informado pelo usuário; confirmar/aplicar 011 e aplicar 012 antes de validar o novo fluxo |
| Testes de RPC/RLS com sessão autenticada real | Não executados — dependem de aplicar a migração e testar com uma conta de mestre no Supabase |
| Fluxo visual autenticado em celular e deploy Pages real | Pendente |

## Decisões técnicas

- Frontend estático, sem servidor próprio; Supabase é o backend para autenticação e dados.
- Chave anon/publishable fica configurável no ambiente de build; `service_role` jamais entra no frontend.
- RPCs no PostgreSQL realizam operações que exigem atomicidade (criar campanha/convite, consumir convite, enviar/responder e-mail e encerrar sessão seletivamente).
- Jogadores sem conta usam identidade anônima; contas de mestre confirmadas também podem criar participações independentes por campanha via convite, com nome e e-mail fictício que não autenticam sozinhos.
- O chat local tem políticas RLS próprias por participação ativa e nega acesso ao proprietário da campanha.
- Não recriar o bucket existente nem torná-lo público; anexos de e-mail usam metadados temporários no bucket privado e ficam vinculados aos destinatários pela tabela de imagens.
- A configuração local contém URL e chave pública anon/publishable; a URL foi corrigida sem alterar a chave. Nenhuma chave `service_role` foi usada.
- O projeto Supabase responde no endpoint de autenticação, mas o schema das campanhas não está publicado; migrações não foram aplicadas automaticamente.
- Nenhum teste de interação com dados reais pode ser declarado aprovado sem executar as migrações em um projeto Supabase configurado.
