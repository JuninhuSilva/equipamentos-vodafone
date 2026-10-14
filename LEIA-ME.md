# Equipamentos Vodafone (PWA)

App para registar equipamentos por WO (câmara + código de barras + foto) e enviar ao grupo do supervisor no Telegram. Tudo fica guardado só no telemóvel.

## Ficheiros
- `index.html`: ecrãs da app
- `styles.css`: visual (vermelho Vodafone)
- `app.js`: toda a lógica, com a **configuração no topo** (token, chat ID, regras de tipo)
- `sw.js`: faz a app abrir sem internet
- `manifest.webmanifest` + `icons/`: instalação no ecrã principal
- `vendor/zxing.min.js`: leitor de códigos de barras

## 1. Publicar no GitHub Pages
1. Em github.com, crie um repositório novo (ex.: `equipamentos`).
2. **Add file › Upload files**: arraste **o conteúdo** da pasta (não a pasta em si) e faça **Commit**.
3. **Settings › Pages**: em *Branch* escolha `main` e `/ (root)` › **Save**.
4. Passado 1 a 2 minutos, a app fica em `https://SEU-USUARIO.github.io/equipamentos/`.

## 2. Instalar no iPhone
1. Abra o endereço no **Safari**.
2. Toque em **Partilhar** › **Adicionar ao ecrã principal**.
3. Abra pelo ícone novo: a app abre em ecrã inteiro.
4. No primeiro "Escanear", permita o acesso à câmara.

## 3. Ligar ao Telegram (uma vez só)
1. No Telegram, fale com **@BotFather** › `/newbot` › copie o **token**.
2. Adicione o bot ao **grupo do supervisor** e escreva no grupo `/start@UsernameDoBot`.
3. Na app, toque na **roda dentada** › cole o token › **Procurar grupos** › toque no grupo › **Guardar**.
4. Toque em **Enviar mensagem de teste** para confirmar.

> Não escreva o token no `app.js` se o repositório for público: qualquer pessoa o poderia ver. Use o ecrã de Configurações.

## Atualizar a app
Depois de mudar ficheiros, aumente `VERSAO` em `sw.js` (ex.: `eqv-v2`) e envie de novo para o GitHub.

## Bom saber
- **Fotos:** não vão para a galeria. Ficam só dentro da app.
- **Se apagar os dados do Safari** ou desinstalar a app, o histórico perde-se.
- **WO a meio:** se a app fechar com uma WO a meio, os equipamentos continuam lá quando abrir de novo.
- **Envio interrompido:** se falhar (sem rede), ao tentar de novo só é enviado o que faltou.
- **Tipo automático:** se os códigos de cada tipo tiverem um início fixo, configure `REGRAS_TIPO` no `app.js` e o tipo passa a ser escolhido sozinho.
