# Chamadas de voz

A primeira versão oferece chamadas de áudio individuais entre contas conectadas. A sinalização usa a sessão autenticada do Prosa e só é encaminhada para a outra pessoa da conversa direta. Os controles disponíveis incluem receber, aceitar, recusar, silenciar e encerrar. Se a conexão entre as contas for removida, o aplicativo encerra a chamada e libera o microfone.

O áudio usa conexão ponto a ponto WebRTC e o serviço público STUN `stun:stun.l.google.com:19302`. STUN ajuda pares atrás de roteadores a se encontrarem, mas não retransmite áudio. Algumas redes corporativas, móveis ou com NAT restritivo podem impedir a conexão. Um serviço TURN próprio ou contratado é necessário para cobertura confiável nesses casos; ele ainda não está configurado.

Esta entrega não inclui vídeo, chamadas em grupo, compartilhamento de tela, seleção de dispositivos de áudio nem teste em aparelhos físicos. Os testes automatizados verificam autorização e encaminhamento dos sinais, não a qualidade de áudio ou conectividade entre redes reais. Não trate a versão atual como serviço de emergência.
