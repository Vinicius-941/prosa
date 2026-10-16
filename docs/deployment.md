# Publicar o Prosa em um servidor próprio

O Compose publica o cliente web e a API sob o mesmo domínio, usa Caddy para HTTPS e executa Coturn para chamadas em redes restritas. A API confia em um único proxy, Caddy, para identificar o IP real dos usuários nos limites de requisições. Ele mantém um único servidor de API com SQLite.

## Requisitos

- Uma máquina Linux com Docker Engine e o plugin Docker Compose.
- Um endereço IPv4 público fixo e um domínio com registro DNS A apontado para esse endereço.
- Portas TCP 80 e 443 para HTTPS; UDP e TCP 3478 para TURN; UDP 49160–49200 para o tráfego de mídia retransmitido.
- O navegador exige HTTPS para acessar microfone, câmera e compartilhamento de tela.

## Configurar

Na raiz do repositório, copie `.env.example` para `.env.production`. Troque os exemplos pelo domínio e endereço IPv4 do servidor. Gere um segredo privado com `openssl rand -hex 32` e mantenha-o igual somente no arquivo `.env.production`:

```dotenv
PROSA_DOMAIN=prosa.seudominio.com
CLIENT_ORIGIN=https://prosa.seudominio.com,https://localhost
TURN_URL=turn:prosa.seudominio.com:3478?transport=udp,turn:prosa.seudominio.com:3478?transport=tcp
TURN_EXTERNAL_IP=IPV4_PUBLICO_DO_SERVIDOR
TURN_SHARED_SECRET=SEGREDO_ALEATORIO_COM_64_CARACTERES_HEXADECIMAIS
```

`https://localhost` permite que a prévia Android use a API hospedada. Acrescente aqui cada origem web adicional exatamente como é aberta no navegador. O cliente web e a API publicados pelo Compose compartilham `PROSA_DOMAIN` e a mesma origem HTTPS.

## Iniciar

```sh
docker compose --env-file .env.production -f deploy/compose.yaml config --quiet
docker compose --env-file .env.production -f deploy/compose.yaml up -d --build
docker compose --env-file .env.production -f deploy/compose.yaml ps
```

Abra `https://prosa.seudominio.com` para usar o aplicativo e confirme a API em `https://prosa.seudominio.com/api/health`. No Android, informe `https://prosa.seudominio.com` no campo do endereço do serviço.

Libere as portas no firewall do sistema e do provedor. Coturn usa a rede do host Linux para anunciar o IPv4 público e encaminhar os intervalos de mídia; o servidor precisa aceitar essas conexões diretamente. Uma faixa de 41 portas de retransmissão limita chamadas TURN simultâneas, então ajuste `--min-port`, `--max-port` e as regras de firewall juntos se precisar atender mais chamadas.

## Operação

Faça cópias de segurança cifradas do volume `prosa-data` para outro sistema e teste a restauração antes de armazenar contas reais. Não aumente o número de réplicas da API nem compartilhe o arquivo SQLite entre servidores. Planeje atualizações com cópia de segurança anterior e monitore `/api/health`.

Este arquivo descreve como publicar o serviço; ele não provisiona a máquina, o domínio nem o DNS. Para muitas contas, disponibilidade elevada ou várias máquinas, migre para banco de dados e armazenamento apropriados antes de escalar.
