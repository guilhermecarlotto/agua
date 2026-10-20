// Service Worker - Gota (Água, Chimarrão e Sono)
// Estratégia: network-first. Com internet, busca sempre a versão mais nova (o app
// atualiza sozinho a cada deploy no GitHub Pages); sem internet, usa o cache.
//
// IMPORTANTE: o Service Worker só guarda os ARQUIVOS DO APP (HTML/JS/ícones).
// Os dados pessoais ficam em localStorage/IndexedDB, que este arquivo nunca toca.
// Ao subir uma versão nova, troque CACHE_NAME (ex.: gota-v6) para forçar a renovação do cache.
const CACHE_PREFIX = 'gota-';
const CACHE_NAME = 'gota-v5';
const ASSETS = [
  './',
  './index.html',
  './gota-core.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // cada arquivo é pedido sem usar o cache HTTP do navegador
      Promise.all(ASSETS.map((url) =>
        fetch(new Request(url, { cache: 'reload' })).then((res) => { if (res.ok) return cache.put(url, res); })
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        // remove apenas caches antigos do próprio app (gota-agua-v2, gota-v1...); nunca mexe em dados
        keys.filter((k) => (k.startsWith(CACHE_PREFIX) || k.startsWith('gota-agua-')) && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // chave do cache sem ?query, para não acumular variações da mesma página
  const key = new Request(url.origin + url.pathname);
  event.respondWith(
    // 'no-cache' = revalida com o servidor (ETag) em vez de aceitar cópia do cache HTTP (GitHub Pages usa 10 min)
    fetch(req, { cache: 'no-cache' })
      .then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(key, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(key).then((hit) =>
          hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)
        )
      )
  );
});
