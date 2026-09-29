'use strict';

/* ================================================================
 * SERVICE WORKER — Cache offline-first
 *
 * Estratégia:
 *   1. Na instalação, baixa e guarda TUDO em cache.
 *   2. Em qualquer requisição, tenta o cache primeiro.
 *   3. Se não tiver no cache, tenta a rede.
 *   4. Se nada funcionar, devolve o index.html (fallback SPA).
 * ================================================================ */

const CACHE_VERSION = 'v2';
const CACHE_NAME = `datalogger-${CACHE_VERSION}`;

// Arquivos essenciais (a base do app)
const ARQUIVOS = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './manifest.json'
];

/* ---- INSTALL: pré-cacheia tudo ---- */
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(ARQUIVOS))
            .then(() => self.skipWaiting())
            .catch((err) => console.warn('[SW] Falha ao pré-cachear:', err))
    );
});

/* ---- ACTIVATE: limpa caches antigos ---- */
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys
                    .filter((key) => key.startsWith('datalogger-') && key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

/* ---- FETCH: cache-first com fallback para rede ---- */
self.addEventListener('fetch', (event) => {
    const req = event.request;

    // Só lida com GET
    if (req.method !== 'GET') return;

    // Ignora requisições não-http (chrome-extension, etc.)
    if (!req.url.startsWith('http')) return;

    event.respondWith(
        caches.match(req).then((cached) => {
            if (cached) return cached;

            return fetch(req).then((res) => {
                // Guarda cópia no cache se for sucesso
                if (res && res.status === 200 && res.type === 'basic') {
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
                }
                return res;
            }).catch(() => {
                // Se falhar e for navegação, devolve index.html
                if (req.mode === 'navigate') {
                    return caches.match('./index.html');
                }
                // Senão, devolve uma resposta vazia
                return new Response('', { status: 408, statusText: 'Offline' });
            });
        })
    );
});

/* ---- MESSAGE: força atualização quando pedido ---- */
self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});