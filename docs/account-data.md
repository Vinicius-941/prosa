# Dados da conta

## Exportação

Com a sessão ativa, use **Baixar meus dados** na área **Segurança e sessões**. O arquivo JSON reúne perfil, metadados das sessões (sem credenciais), conexões e solicitações, comunidades e canais dos quais a conta participa, e histórico das conversas às quais ela ainda tem acesso. A exportação exige autenticação e tem limite de duas solicitações por conta a cada dez minutos; as respostas não são armazenadas em cache.

Conversas diretas cujo acesso foi removido não são incluídas. O arquivo não contém hashes de senha, tokens de sessão ou segredos de autenticação.

## Exclusão

Use **Excluir minha conta**, informe a senha atual e digite o nome de usuário. A ação remove o perfil e encerra suas sessões. Mensagens escritas pela conta são removidas junto com os registros associados. Em uma comunidade com outros participantes, a propriedade passa para quem entrou há mais tempo; uma comunidade sem outros participantes é removida. A operação não pode ser desfeita pelo aplicativo.

O serviço não possui atualmente um ciclo de retenção para cópias externas, registros do operador ou cópias de segurança. O responsável pela implantação deve definir e comunicar prazos para esses dados. Esta descrição registra o comportamento do software; não substitui análise legal ou aviso de privacidade revisado.
