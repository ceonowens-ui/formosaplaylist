// 花彘醺：讓歌不中斷，也讓網站沒網路時打得開
// 1. 歌：播到的那首和下一首整首存在手機裡，網路斷一下也不會停
// 2. 網頁本身：每次都先拿最新版；沒網路才用上次存的
// 3. 圖片、字型：先用手機裡存的（馬上出現），背後再悄悄更新
const AUDIO = 'hzx-audio-v2';
const SHELL = 'hzx-shell-v1';
const MAX_SONGS = 8; // 最多存 8 首（約 40MB），舊的自動刪
const PAGE = new URL('./', self.registration.scope).href;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  // 刪掉舊版留下的快取，不佔手機空間
  for (const k of await caches.keys()) {
    if ((k.startsWith('hzx-audio-') && k !== AUDIO) || (k.startsWith('hzx-shell-') && k !== SHELL)) await caches.delete(k);
  }
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
    const cache = await caches.open(AUDIO);
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
  if (url.origin !== location.origin) return;
  if (req.mode === 'navigate') { e.respondWith(page(req)); return; }
  if (/\.mp3$/i.test(url.pathname)) {
    if (url.searchParams.get('sw') === '0') return; // 重連第 2 次起：直接走網路，不用手機裡的
    e.respondWith(song(req));
    return;
  }
  if (/sw\.js$/.test(url.pathname) || req.headers.has('range')) return;
  e.respondWith(asset(e, req));
});

// 網頁：先拿最新版（GitHub 會把舊頁面留 10 分鐘，所以不用瀏覽器存的）；沒網路才用上次的
async function page(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req, { cache: 'no-store' });
    if (res.ok && res.type === 'basic') cache.put(PAGE, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const hit = await cache.match(PAGE);
    if (hit) return hit;
    throw err;
  }
}

// 圖片、字型、設定檔：有存就先給，背後再更新；沒存過就上網拿
async function asset(e, req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req, { ignoreSearch: false });
  const fresh = fetch(req).then(res => {
    if (res.ok && res.status === 200 && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
    return res;
  });
  if (hit) { e.waitUntil(fresh.catch(() => {})); return hit; }
  return fresh;
}

async function song(req) {
  try {
    const cache = await caches.open(AUDIO);
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
