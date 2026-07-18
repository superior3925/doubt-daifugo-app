// オフラインプレイ用のService Worker。Cache First戦略で、一度キャッシュした
// ものは明示的にCACHE_NAMEを変更するかブラウザのサイトデータを消さない限り
// 消えない（日数経過による自動失効はしない）。
// デザインやコードを更新して配信し直した場合は、このCACHE_NAMEの値を
// 変更してください。変更すると古いキャッシュはactivate時に破棄され、
// 次回オンライン時に新しい内容が取り込まれる。
const CACHE_NAME = 'doubt-daifugo-v5';
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/pwa-icon-192.png',
  './assets/pwa-icon-512.png',
  './assets/favicon-32.png',
  './assets/bgm/貴族のお部屋.mp3',
  './assets/bgm/メンタルヘルス.mp3'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request).then((response) => {
        if (response && response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
      // キャッシュがあれば即座に返して体感速度を優先しつつ、裏でネットワークから
      // 更新を取得してキャッシュを最新化する（オフライン時はネットワーク取得が
      // 失敗するのでキャッシュのみで応答する）。
      return cached || network;
    })
  );
});
