# Prosa 0.1.3 — pesquisa e auditoria de interface

## Pesquisa visual

Pesquisa no Refero tentada para identidade social violeta, interface escura de alto contraste, produto de comunidade e produto desktop; também foram consultadas telas de configurações/comunidades e fluxos de criação/perfil. Todos os oito pedidos retornaram `NO_SUBSCRIPTION`: `Your subscription is not active or has expired. Please visit https://refero.design/mcp/upgrade`. Não foi possível abrir estilos, telas ou fluxos. Nenhuma referência ou direção visual nova foi atribuída ao Refero. A direção visual permanece bloqueada até que a pesquisa possa ser concluída.

Enquanto isso, as mudanças funcionais mantêm o tema escuro e violeta existente. Foram adicionadas barras de rolagem visíveis, agrupamento de conversas, diálogos separados para criação/entrada de comunidades e opções limitadas de cor e moldura do avatar. Essas mudanças não são apresentadas como uma direção visual pesquisada.

## Achados reproduzidos

| Prioridade | Achado | Evidência | Estado |
| --- | --- | --- | --- |
| P1 | Conversas recentes não distinguiam espaço pessoal, conversas diretas e canais; canais podiam aparecer de novo ao combinar conversas e canais selecionados. | Renderização duplicada no cliente; fluxo móvel verificado com assert de um único canal. | Corrigido |
| P1 | Criar comunidade, entrar por convite e administrar estavam misturados em uma tela longa. | Fluxo Playwright cobrindo diálogo de criação, criação de canal e abertura de `geral`. | Parcialmente corrigido; administração continua na página de detalhes. |
| P1 | Erros de convite inválido ou falha de rede apareciam só como aviso global, longe do campo. | E2E envia convite inválido e confirma alerta inline, diálogo aberto e código preservado para correção. | Corrigido no diálogo de convite; mensagens de falha ficam próximas ao formulário e o fluxo pode ser tentado novamente. |
| P1 | Toast de sucesso sobrepunha o botão de remover na parte inferior da lista e capturava o clique. | E2E criava canal como administrador e tentava remover participante; Playwright registrou `.notice` interceptando o pointer. | Corrigido com toast não bloqueante; botão de fechar permanece interativo. E2E cobre a remoção após o sucesso da criação. |
| P1 | Áreas roláveis não tinham um tratamento consistente para a barra. | CSS de barra fina com thumb visível, foco por teclado nativo e rolagem de toque. | Corrigido no CSS; precisa de inspeção em Linux e dispositivos. |
| P1 | Espaço pessoal e canais sem mensagens mostravam só o separador de histórico, sem orientar o próximo passo. | Captura de conversa vazia e fluxo de canal recém-criado no Chromium. | Corrigido com instrução contextual na área de mensagens; E2E verifica os dois estados e axe não aponta violações. |
| P1 | Controles de edição e reação podiam se sobrepor à mensagem seguinte ao redimensionar da faixa móvel para 768 px. | A captura Chromium mostrou os controles durante a transição de opacidade depois de a altura já ter colapsado; um assert E2E mediu a colisão (21 px). | Corrigido removendo a transição que deixava os controles visíveis sem espaço no layout; ações reveladas reservam altura e o assert E2E mede que não colidem em 768 px. |
| P2 | Em viewport de 768 px, o contexto de canal na linha de Recentes podia encostar/cortar no divisor da sidebar. | Captura Chromium `chromium-viewport-768.png`; revisto o layout flex e adicionado assert de limite da linha no E2E. | Corrigido com largura flexível e truncamento por reticências; E2E passou. |
| P2 | O perfil não tinha edição ou personalização simples. | Coberto por endpoint `PATCH /api/me`, validação, migração aditiva, diálogo de perfil e testes de busca, contatos, membros, conversas e mensagens. | Corrigido para iniciais, cores e molduras; upload de imagem foi deixado fora por não haver validação e armazenamento seguro implementados. |
| P2 | Prévia de avatar no perfil mostrava apenas uma inicial, diferente dos avatares no restante do app. | Inspeção do componente e assert E2E com nome de duas palavras após escolher cor e moldura. | Corrigido reutilizando `ProfileAvatar`; o E2E confirma “QP” para “QA Prosa”. |
| P2 | O novo cartão da comunidade tinha contraste de 4,48:1 no texto secundário. | Falha axe reproduzível no E2E; cor do texto ajustada. | Corrigido; E2E axe passou. |
| P0 | Token de sessão fica em armazenamento acessível ao JavaScript no navegador. | Verificado em `src/api.ts`; requisições web usam cookies e E2E confere o cadastro e a migração de sessão antiga. | Corrigido para sessões web novas e migradas: cookie HttpOnly, CSRF e `Origin` exato. Risco de XSS ativo e bloqueio de cookie de terceiros permanecem documentados. |
| P0 | Socket já autenticado não era encerrado ao vencer a sessão, podendo continuar recebendo eventos da sala do usuário. | Integração cria sessão com vencimento em um segundo e verifica evento de expiração, desconexão e HTTP 401. | Corrigido: servidor encerra socket no vencimento, cliente limpa a sessão protegida e informa que deve entrar novamente. |
| P1 | Preferências de inicialização e acessibilidade faltavam; tema e fechamento não são suportados. | Inspeção de navegação e preload; E2E verifica opções por plataforma. | Parcial: inicialização real Windows/Linux e animações reduzidas estão disponíveis; tema e comportamento ao fechar continuam sem suporte. |

## Escopo que falta para aceite visual e multiplataforma

- Selecionar e documentar referências do Refero após restabelecer acesso.
- Teclado aberto e rolagem até os campos finais foram conferidos no emulador Android 16/API 36; testar zoom real do navegador, DPI nativo de Windows/Linux, ampliação do texto do sistema e Android físico.
- Completar configurações de tema, notificações e comportamento ao fechar; inicialização Windows foi exercitada pelo smoke empacotado, inicialização Linux nativa ainda aguarda CI/hospedeiro Linux.
- Validar pessoalmente a identidade do avatar no Android e em escala ampliada do desktop; considerar imagem apenas se upload seguro vier a ser desenvolvido.
- Refinar a área administrativa contextual, que ainda fica dentro da página de detalhes; o E2E percorre permissões e mutações com confirmação para responsável, administrador e participante.
- Aguardar uma execução CI do novo smoke de inicialização Linux sob Xvfb e validar instalação/upgrade limpos; testar aparelho Android físico e login/chamadas autenticadas com API HTTPS.

## QA executado

- `npm test`: fluxo integrado, incluindo migração de banco legado, perfil, papéis de comunidade, mensagens e sockets.
- Expiração de sessão em socket: `npm test` força expiração curta e verifica aviso `session:expired`, desconexão e rejeição das próximas requisições.
- `npm run test:e2e`: Chromium, viewport móvel, estados vazios de espaço pessoal/canal/comunidades com axe, regressão de rolagem ao reabrir conversa, controles sem colisão em 768 px e edição acessível por toque em 320 px, reconexão após offline/online, fluxo comunitário, convite inválido com recuperação inline, ações de responsável/administrador/participante (inclui promoção e criação de canal pelo administrador), foco, teclado, rede e larguras 320–1440 px.
- E2E alterna para cores forçadas do sistema e confirma contorno de foco visível com largura mínima de 2 px.
- E2E salva a tela autenticada em `deviceScaleFactor` 1, 1.25 e 1.5, verificando corte horizontal e limites do texto. O pacote Windows também foi reaberto com dados temporários isolados e capturado via CDP nas três densidades; isso não altera nem comprova o DPI nativo do monitor.
- Para checar reflow ampliado, E2E combina viewport CSS 1440/1152/960 com densidade 1/1.25/1.5 e captura os três estados; é uma simulação de zoom e não envia/mede o zoom real do navegador.
- O harness de smoke desktop foi executado contra o pacote Windows atual: título, cadastro descartável, saúde da API HTTP 200, viewport sem overflow e leitura/alternância/restauração da preferência de inicialização passaram. A tela de Configurações foi inspecionada em `windows-settings-startup-0.1.3.png`; a execução Linux equivalente está configurada em CI, aguardando runner.
- Build Android `assembleDebug` passou para o código atual usando o JDK do Android Studio. APK instalado e aberto no emulador Android 16/API 36; formulário inicial visível, teclado aberto e rolagem até o botão de cadastro verificados em `android-registration-api36-current.png`, `android-registration-keyboard-api36.png` e `android-registration-keyboard-scroll-api36.png`. O bridge Keystore passou round-trip, rejeitou token inválido, não escreveu em `localStorage`, gravou valor cifrado e limpou a sessão.
- Executável Windows foi recompilado/empacotado, iniciado com perfil temporário isolado, API local e tela de cadastro conferidas; as capturas de densidade 100/125/150% estão em `windows-scale-*.png`. Tentativa de empacotamento Linux a partir do Windows parou no `node-gyp` por falta de suporte a cross-compilation de módulos nativos.
- QA adicional encontrou que empacotar diretamente depois do build web apontava arquivos para `C:\assets`, deixando o renderer vazio. O CI foi alinhado a `build:desktop`; `npm run package:desktop` foi executado e a tela Windows final foi inspecionada e salva.
- Capturas atuais de cadastro, estados vazios de conversa/comunidade, histórico com 24 mensagens nos sete viewports Chromium, densidades e reflow ampliado simulados em 100/125/150%, configurações e telas Windows/Android foram preservadas em `docs/research/screenshots/`; os recortes vazios e o de 768 px foram inspecionados visualmente após as correções.
- Não foram produzidas capturas finais com DPI nativo de Windows/Linux ou para cada plataforma e estado longo/vazio; a verificação visual cruzada permanece pendente.
