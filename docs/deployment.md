# Publicação própria do serviço

Este projeto oferece uma configuração inicial de implantação para um único servidor. Ela executa a API em contêiner, guarda o SQLite em um volume persistente e usa Caddy para obter e renovar certificados HTTPS. O repositório não provisiona uma máquina, um domínio ou credenciais de nuvem.

## Requisitos

- Uma máquina Linux com Docker Engine e o plugin Docker Compose.
- Um domínio ou subdomínio apontado por registros DNS A/AAAA para essa máquina.
- As portas TCP 80 e 443 acessíveis pela internet. A porta UDP 443 é opcional e habilita HTTP/3.
- Um cliente web publicado em HTTPS, se for usar o cliente web.

## Configuração e início

Na raiz do repositório, crie `.env.production` a partir de `.env.example`. Edite `PROSA_DOMAIN` com o nome DNS da API e `CLIENT_ORIGIN` com origens exatas, separadas por vírgulas. Para o cliente Android, inclua `https://localhost`; acrescente a origem exata do cliente web se houver. Não inclua caminhos como `/api` nesses valores.

```sh
cp .env.example .env.production
```

Adicione ao `.env.production`:

```dotenv
PROSA_DOMAIN=api.seudominio.com
CLIENT_ORIGIN=https://localhost,https://app.seudominio.com
```

Confira a configuração e inicie os serviços:

```sh
docker compose --env-file .env.production -f deploy/compose.yaml config --quiet
docker compose --env-file .env.production -f deploy/compose.yaml up -d --build
docker compose --env-file .env.production -f deploy/compose.yaml ps
```

Confirme a resposta saudável em `https://api.seudominio.com/api/health`. No Android, informe `https://api.seudominio.com` no campo do endereço do serviço. Caddy precisa alcançar o domínio nas portas públicas para emitir o certificado. O volume `prosa-data` mantém o arquivo do SQLite entre reinícios e atualizações do contêiner.

## Operação e limites

Faça cópias de segurança cifradas do volume de dados para outro sistema e teste a restauração antes de armazenar contas reais. O SQLite foi configurado para uma única instância da API: não aumente o número de réplicas nem compartilhe o mesmo arquivo entre vários servidores. Planeje atualizações com cópia de segurança anterior e monitore a disponibilidade do endereço de saúde.

Esse arquivo não confirma que algum serviço foi publicado. O operador precisa fornecer servidor, DNS, regras de rede e rotina de cópias de segurança. Para um ambiente com muitas contas, disponibilidade elevada ou execução em várias máquinas, migre para banco de dados e armazenamento desenhados para esse perfil antes de escalar.
