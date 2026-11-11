// 花彘醺 Playlist：把歌存在手機裡，網路斷一下也不會停
// 只處理 .mp3；網頁本身照常從網路拿，改版馬上生效
const CACHE = 'hzx-audio-v2';
const MAX_SONGS = 8; // 最多存 8 首（約 40MB），舊的自動刪

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  // 刪掉舊版留下的快取，不佔手機空間
  for (const k of await caches.keys()) if (k.startsWith('hzx-audio-') && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

// 網址含 ?v= 版本號：換新音檔、版本 +1，就會當成新的一首重新下載
const keyOf = u => { const x = new URL(u); x.searchParams.delete('sw'); return x.origin + x.pathname + x.search; };
const filling = new Map();

// 整首下載進快取（同一首同時只下載一次）
function fill(url, keep) {
  const key = keyOf(url);
  if (filling.has(key)) return filling.get(key);
  const job = (async () => {
    const cache = await caches.open(CACHE);
    if (await cache.match(key)) return;
    const res = await fetch(key, { cache: 'no-store' });
    if (!res.ok || res.status !== 200) return;
    await cache.put(key, res);
    await trim(cache, (keep || []).map(keyOf).concat(key));
  })().catch(() => {}).finally(() => filling.delete(key));
  filling.set(key, job);
  return job;
}

async function trim(cache, keep) {
  const reqs = await cache.keys();
  let extra = reqs.length - MAX_SONGS;
  for (const r of reqs) {
    if (extra <= 0) break;
    if (keep.includes(keyOf(r.url))) continue;
    await cache.delete(r);
    extra--;
  }
}

self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'prefetch' && d.url) e.waitUntil(fill(d.url, d.keep));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !/\.mp3$/i.test(url.pathname)) return;
  if (url.searchParams.get('sw') === '0') return; // 重連第 2 次起：直接走網路，不用手機裡的
  e.respondWith(serve(req));
});

async function serve(req) {
  try {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(keyOf(req.url));
    if (hit) return await slice(hit, req.headers.get('range'));
  } catch (err) {}
  return fetch(req); // 還沒存到的歌：照常串流
}

// 播放器會要「第幾 byte 到第幾 byte」，從存好的整首切給它
async function slice(res, range) {
  const blob = await res.blob();
  const size = blob.size;
  const type = res.headers.get('content-type') || 'audio/mpeg';
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes' };
  if (!range) {
    return new Response(blob, { status: 200, headers: { ...base, 'Content-Length': String(size) } });
  }
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start = 0, end = size - 1;
  if (m) {
    if (m[1] === '' && m[2] !== '') { start = Math.max(0, size - Number(m[2])); }
    else {
      start = Number(m[1] || 0);
      if (m[2] !== '') end = Math.min(Number(m[2]), size - 1);
    }
  }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  return new Response(blob.slice(start, end + 1, type), {
    status: 206,
    headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
  });
}
