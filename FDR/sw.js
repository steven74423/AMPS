const CACHE_NAME = 'fdr-alpha-v1';
const ASSETS = [
  'recorder.html',
  'analysis.html',
  'css/tactical.css',
  'js/recorder.js',
  'js/analysis.js',
  'js/filter.js',
  'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((res) => res || fetch(e.request))
  );
});
