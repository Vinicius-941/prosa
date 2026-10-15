# Benchmarks reproduzíveis

## Escrita concorrente de mensagens

`service.mjs` inicia o serviço real com um banco SQLite temporário, cria duas contas, aceita uma conexão e grava mensagens por meio da API. Confere depois se todas estão no histórico. Cada execução mede o tempo de início, latência por escrita (p50/p95/p99) e vazão observada.

Execute na raiz do repositório com Node.js 22.12 ou posterior e dependências instaladas:

```sh
npm run benchmark:service -- --messages=300 --concurrency=10
```

Os parâmetros podem ser alterados; `--output=benchmarks/results/run.json` também salva uma cópia JSON. O resultado registra versão do Node, sistema, processador e memória total para ajudar a comparar execuções feitas em condições equivalentes. Faça ao menos cinco execuções após uma execução de aquecimento; compare medianas e preserve valores individuais, sem remover funcionalidades da carga.

Esse ensaio mede apenas escrita concorrente local com HTTP e SQLite temporário. Ele não mede interface gráfica, tráfego externo, TLS, mídia, áudio, vídeo, inicialização de janelas, RAM em repouso, consumo de bateria nem compara outros produtos. Os valores variam conforme máquina, sistema, carga concorrente e versão do runtime. Não use os números de uma execução como promessa de desempenho ou capacidade de produção.
