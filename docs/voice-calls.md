# Chamadas de voz

A primeira versão oferece chamadas individuais de áudio e vídeo entre contas conectadas. A sinalização usa a sessão autenticada do Prosa e só é encaminhada para a outra pessoa da conversa direta. Os controles incluem receber, aceitar, recusar, silenciar, ligar ou desligar a câmera, compartilhar a tela e encerrar. Se a conexão entre as contas for removida, o aplicativo encerra a chamada e libera o microfone e a câmera.

As chamadas usam conexão ponto a ponto WebRTC e o serviço STUN público `stun:stun.l.google.com:19302`. Em produção, o endpoint autenticado `/api/calls/ice-servers` também entrega credenciais TURN Coturn com validade de uma hora; o segredo compartilhado fica apenas no servidor. O TURN retransmite mídia quando as duas pontas não conseguem conectar diretamente.

O compartilhamento de tela depende do suporte do navegador a `getDisplayMedia`, portanto não aparece em todos os dispositivos, incluindo a versão Android atual. Chamadas em grupo e seleção de dispositivos de áudio não estão disponíveis. A conectividade e a qualidade de mídia precisam ser validadas em aparelhos físicos e redes reais. Não trate o Prosa como serviço de emergência.
