/* =========================================================
   Service Worker — faz a app abrir mesmo sem internet.
   Guarda os ficheiros da app (HTML, CSS, JS, ícones) em cache.
   NUNCA guarda pedidos ao Telegram (esses precisam de rede).

   Quando mudar algum ficheiro da app, aumente a VERSAO abaixo
   para os telemóveis descarregarem a versão nova.
   ========================================================= */
const VERSAO = 'eqv-v2';

const FICHEIROS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './vendor/zxing.min.js',
  './manifest.webmanifest',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

// Instalação: guarda todos os ficheiros da app
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(FICHEIROS)).then(() => self.skipWaiting()));
});

// Ativação: apaga caches de versões antigas
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Pedidos: só trata ficheiros da própria app (mesma origem, GET)
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // Telegram passa direto

  // Rede primeiro (para apanhar atualizações), cache se estiver sem internet
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        const copia = resp.clone();
        caches.open(VERSAO).then((c) => c.put(e.request, copia));
        return resp;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});
