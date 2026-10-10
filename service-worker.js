// もぐらたたき Service Worker
// ・初回に必要なファイルを保存（キャッシュ）し、オフラインでも遊べるようにする
// ・ネットにつながる時は常に最新のファイルを取りに行き、キャッシュも更新する
// ・新しいバージョンは、ページ（pwa.js）から「切り替えてOK」と言われるまで待機する
//   （プレイ中に突然切り替わらないように）
// ・ゲームを更新して公開する時は、必ず CACHE_VERSION の数字を上げる（古いキャッシュは自動で削除）
const CACHE_VERSION = 'v11';
const CACHE_PREFIX = 'mogura-';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;
const NETWORK_TIMEOUT_MS = 3000; // 電波が弱い時は3秒でキャッシュに切り替える

// 場所は service-worker.js から見た相対パス（GitHub Pages の /mogura/ でも、そのまま動く）
const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './pwa.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  // ここでは skipWaiting しない。古いバージョンで遊んでいる人がいれば、pwa.js の合図を待つ
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_FILES.map((url) => new Request(url, { cache: 'reload' }))))
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    // cache: 'no-cache' … ブラウザに残っている古いファイルを使わず、サーバーに最新か確認する
    const res = await withTimeout(fetch(req, { cache: 'no-cache' }), NETWORK_TIMEOUT_MS);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    // オフライン・タイムアウト時はキャッシュから返す（ページ移動は index.html で代用）
    const cached = await cache.match(req, { ignoreSearch: true })
      || (req.mode === 'navigate' ? await cache.match('./index.html') : undefined);
    if (cached) return cached;
    throw e;
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}
