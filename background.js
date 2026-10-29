const TTL = 7 * 24 * 3600 * 1000;

const norm = (s) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

async function cached(key, fn) {
  const hit = (await chrome.storage.local.get(key))[key];
  if (hit && Date.now() - hit.t < TTL) return hit.v;
  const v = await fn();
  await chrome.storage.local.set({ [key]: { t: Date.now(), v } });
  return v;
}

function score(item, { title, year, director }) {
  const want = norm(title);
  const names = [item.title, item.display_title, ...(item.localized_title || []).map((l) => l.text)].map(norm);
  let s = 0;
  if (names.includes(want)) s += 3;
  else if (names.some((n) => n && (n.includes(want) || want.includes(n)))) s += 1;
  if (year && (item.tags || []).includes(String(year))) s += 2;
  if (director) {
    const d = norm(director);
    if ((item.credits || []).some((c) => c.role === "director" && norm(c.name) === d)) s += 2;
  }
  return s;
}

async function neodbLookup(q) {
  const url = `https://neodb.social/api/catalog/search?category=movie&query=${encodeURIComponent(q.title)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("NeoDB " + r.status);
  const { data } = await r.json();
  let best = null, bestScore = 0;
  for (const it of data || []) {
    const s = score(it, q);
    if (s > bestScore) (best = it), (bestScore = s);
  }
  // 没有年份/导演佐证时,至少要标题完全匹配
  return bestScore >= 3 ? best : null;
}

async function doubanInfo(id) {
  const r = await fetch(`https://movie.douban.com/subject/${id}/`, { credentials: "include" });
  if (!r.ok) throw new Error("Douban " + r.status);
  const html = await r.text();
  const rating = html.match(/<strong[^>]*class="ll rating_num"[^>]*>([\d.]+)<\/strong>/)?.[1];
  const count = html.match(/<span property="v:votes">(\d+)<\/span>/)?.[1];
  const comments = [];
  const re = /<div class="comment">[\s\S]*?<span class="comment-info">\s*<a[^>]*>([^<]+)<\/a>[\s\S]*?<span class="short">([\s\S]*?)<\/span>/g;
  let m;
  while ((m = re.exec(html)) && comments.length < 5)
    comments.push({ user: m[1].trim(), text: m[2].replace(/<[^>]+>/g, "").trim() });
  return { rating: rating ? +rating : null, count: count ? +count : null, comments };
}

async function imdbInfo(id) {
  const r = await fetch(`https://www.imdb.com/title/${id}/`, { headers: { "Accept-Language": "en" } });
  if (!r.ok) throw new Error("IMDb " + r.status);
  const html = await r.text();
  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  const ar = ld ? JSON.parse(ld).aggregateRating : null;
  return ar ? { rating: +ar.ratingValue, count: ar.ratingCount } : null;
}

async function lookup(q) {
  const item = await neodbLookup(q);
  if (!item) return { found: false };
  const ext = (item.external_resources || []).map((e) => e.url);
  const doubanId = ext.map((u) => u.match(/movie\.douban\.com\/subject\/(\d+)/)?.[1]).find(Boolean);
  const imdbId = ext.map((u) => u.match(/imdb\.com\/title\/(tt\d+)/)?.[1]).find(Boolean);

  const [douban, imdb] = await Promise.all([
    doubanId ? doubanInfo(doubanId).catch(() => null) : null,
    imdbId ? imdbInfo(imdbId).catch(() => null) : null,
  ]);

  return {
    found: true,
    neodb: item.rating
      ? { rating: item.rating, count: item.rating_count, url: "https://neodb.social" + item.url }
      : { rating: null, url: "https://neodb.social" + item.url },
    douban: douban && { ...douban, url: `https://movie.douban.com/subject/${doubanId}/` },
    doubanUrl: doubanId ? `https://movie.douban.com/subject/${doubanId}/` : null,
    imdb: imdb && { ...imdb, url: `https://www.imdb.com/title/${imdbId}/` },
  };
}

chrome.runtime.onMessage.addListener((msg, _s, send) => {
  if (msg?.type !== "lookup") return;
  const key = "v1:" + [msg.title, msg.year, msg.director].map(norm).join("|");
  cached(key, () => lookup(msg)).then(send, (e) => send({ error: String(e) }));
  return true;
});
