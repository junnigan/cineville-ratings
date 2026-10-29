const TTL = 7 * 24 * 3600 * 1000;
const cvUrl = (locale, slug) => `https://cineville.nl/${locale}/films/${slug}`;

const norm = (s) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

async function cached(key, fn, ttl = TTL) {
  const hit = (await chrome.storage.local.get(key))[key];
  // 部分失败的结果(豆瓣被拦、IMDb 没拿到)只缓存 10 分钟,方便登录/填 key 后重试
  const life = hit?.v?.partial ? 10 * 60 * 1000 : ttl;
  if (hit && Date.now() - hit.t < life) return hit.v;
  const v = await fn();
  await chrome.storage.local.set({ [key]: { t: Date.now(), v } });
  return v;
}

const getSettings = () => chrome.storage.sync.get({ omdbKey: "" });

// ---- Cineville ----

async function cinevilleMeta(slug, locale) {
  const r = await fetch(cvUrl(locale, slug));
  if (!r.ok) throw new Error("Cineville " + r.status);
  const html = await r.text();
  const raw = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  const f = JSON.parse(raw).props.pageProps.film;
  return {
    title: f.title,
    year: f.releaseYear,
    directors: f.directors || [],
    description: (f.description || "").trim(), // 页面只显示 description,不含 shortDescription
  };
}

// "Akira (re-release)" -> "Akira"
function titleCandidates(title) {
  const t = title.replace(/&#0?39;|&#x27;/g, "'");
  const out = [t];
  const stripped = t
    .replace(/\s*[\(\[][^)\]]*[\)\]]/g, "")
    .replace(/\s+[-–:]\s+(4k|restored|restoration|director'?s cut|re-?release|remaster).*$/i, "")
    .trim();
  if (stripped && stripped !== t) out.unshift(stripped);
  return out;
}

// ---- NeoDB matching ----

function score(item, title, year) {
  const want = norm(title);
  const names = [item.title, item.display_title, ...(item.localized_title || []).map((l) => l.text)].map(norm);
  let s = 0;
  if (names.includes(want)) s += 3;
  else if (names.some((n) => n && want.length > 3 && (n.includes(want) || want.includes(n)))) s += 1;
  const years = (item.tags || []).filter((t) => /^(19|20)\d\d$/.test(t)).map(Number);
  if (year && years.length) s += years.some((y) => Math.abs(y - year) <= 1) ? 2 : -3;
  return s;
}

async function neodbLookup(meta) {
  for (const q of titleCandidates(meta.title)) {
    const r = await fetch(
      `https://neodb.social/api/catalog/search?category=movie&query=${encodeURIComponent(q)}`
    );
    if (!r.ok) throw new Error("NeoDB " + r.status);
    const { data } = await r.json();
    const ranked = (data || [])
      .map((it) => ({ it, s: score(it, q, meta.year) }))
      .filter((x) => x.s >= 3)
      .sort((a, b) => b.s - a.s || (b.it.rating_count || 0) - (a.it.rating_count || 0));
    if (ranked.length) return ranked[0].it;
  }
  return null;
}

// ---- external ratings ----

async function doubanInfo(id) {
  const r = await fetch(`https://movie.douban.com/subject/${id}/`, { credentials: "include" });
  if (!r.ok || r.url.includes("sec.douban.com")) return { blocked: true };
  const html = await r.text();
  const rating = html.match(/<strong[^>]*class="ll rating_num"[^>]*>([\d.]+)<\/strong>/)?.[1];
  if (!rating) return { blocked: true };
  const count = html.match(/<span property="v:votes">(\d+)<\/span>/)?.[1];
  const strip = (h) => h.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
  const summary = strip(
    html.match(/<span class="all hidden">([\s\S]*?)<\/span>/)?.[1] ||
      html.match(/<span property="v:summary"[^>]*>([\s\S]*?)<\/span>/)?.[1] ||
      ""
  );
  const comments = [];
  for (const blk of html.split('class="comment-item').slice(1, 11)) {
    const u = blk.match(/<span class="comment-info">\s*<a[^>]*href="([^"]*)"[^>]*>([^<]+)<\/a>/);
    const text = blk.match(/<span class="short">([\s\S]*?)<\/span>/)?.[1];
    if (!u || !text) continue;
    comments.push({
      user: u[2].trim(),
      url: u[1],
      text: strip(text),
      stars: +(blk.match(/class="allstar(\d)0 rating"/)?.[1] || 0) || null,
      likes: +(blk.match(/class="votes vote-count">(\d+)</)?.[1] || 0),
      src: "douban",
    });
  }
  return { rating: +rating, count: count ? +count : null, summary, comments };
}

async function imdbInfo(id, omdbKey) {
  if (omdbKey) {
    const r = await fetch(`https://www.omdbapi.com/?i=${id}&plot=full&apikey=${encodeURIComponent(omdbKey)}`);
    const j = await r.json();
    if (j.Response === "False") return { error: "OMDb: " + j.Error };
    const rating = j.imdbRating && j.imdbRating !== "N/A" ? +j.imdbRating : null;
    return {
      rating,
      count: +(j.imdbVotes || "0").replace(/,/g, "") || null,
      plot: j.Plot && j.Plot !== "N/A" ? j.Plot : "",
      error: rating ? null : "OMDb 暂无评分",
    };
  }
  // 没有 key:IMDb 页面通常会返回验证页,拿不到就提示去填 key
  try {
    const r = await fetch(`https://www.imdb.com/title/${id}/`, { headers: { "Accept-Language": "en" } });
    const ld = r.ok ? (await r.text()).match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] : null;
    const ar = ld ? JSON.parse(ld).aggregateRating : null;
    if (ar) return { rating: +ar.ratingValue, count: ar.ratingCount };
  } catch {}
  return { error: "nokey" };
}

// ---- main lookup ----

async function lookup(slug, locale) {
  const meta = await cinevilleMeta(slug, locale);
  const item = await neodbLookup(meta);
  if (!item) return { found: false, meta };

  const ext = (item.external_resources || []).map((e) => e.url);
  const doubanId = ext.map((u) => u.match(/movie\.douban\.com\/subject\/(\d+)/)?.[1]).find(Boolean);
  const imdbId = ext.map((u) => u.match(/imdb\.com\/title\/(tt\d+)/)?.[1]).find(Boolean);
  const { omdbKey } = await getSettings();

  const [douban, imdb] = await Promise.all([
    doubanId ? doubanInfo(doubanId).catch(() => ({ blocked: true })) : null,
    imdbId ? imdbInfo(imdbId, omdbKey).catch((e) => ({ error: String(e) })) : null,
  ]);

  const seen = new Set();
  const titles = [];
  for (const l of item.localized_title || []) {
    const k = l.lang + "|" + l.text;
    if (!seen.has(k)) (seen.add(k), titles.push({ lang: l.lang, text: l.text }));
  }
  const descriptions = (item.localized_description || [])
    .filter((l) => l.text.length > 80)
    .slice(0, 12)
    .map((l) => ({ lang: l.lang, text: l.text.trim() }));

  return {
    found: true,
    partial: !!(douban?.blocked || (imdbId && !imdb?.rating)),
    meta,
    uuid: item.uuid,
    titles: titles.slice(0, 60),
    descriptions,
    neodb: { rating: item.rating || null, count: item.rating_count, url: "https://neodb.social" + item.url },
    douban: {
      ...(douban || {}),
      url: doubanId ? `https://movie.douban.com/subject/${doubanId}/` : null,
    },
    imdb: { ...(imdb || {}), url: imdbId ? `https://www.imdb.com/title/${imdbId}/` : null },
  };
}

// ---- NeoDB short reviews ----

async function neodbComments(uuid, lang) {
  const r = await fetch(`https://neodb.social/api/item/${uuid}/posts/`);
  if (!r.ok) return [];
  const { data } = await r.json();
  const base = lang.split("-")[0];
  return (data || [])
    .filter((p) => p.visibility === "public" && !p.sensitive && !p.spoiler_text)
    .map((p) => {
      // 内容形如 "看过 <片名> 🌕🌕🌗🌑🌑<br>正文",去掉首行
      const html = p.content.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n");
      const lines = html.replace(/<[^>]+>/g, "").split("\n").map((s) => s.trim()).filter(Boolean);
      const stars = (lines[0]?.match(/🌕/g) || []).length + (lines[0]?.match(/🌗/g) || []).length * 0.5;
      const text = lines.slice(1).join(" ");
      return {
        user: p.account.display_name || p.account.username,
        url: p.url || p.uri,
        text,
        stars: stars || null,
        likes: p.favourites_count || 0,
        sameLang: (p.language || "").split("-")[0] === base,
        src: "neodb",
      };
    })
    .filter((c) => c.text.length >= 30)
    .sort((a, b) => b.sameLang - a.sameLang || b.likes - a.likes || b.text.length - a.text.length)
    .slice(0, 10);
}

chrome.runtime.onMessage.addListener((msg, _s, send) => {
  if (msg?.type === "film") {
    cached(`v5:${msg.locale}:${msg.slug}`, () => lookup(msg.slug, msg.locale)).then(send, (e) => send({ error: String(e) }));
    return true;
  }
  if (msg?.type === "comments") {
    cached(`c2:${msg.uuid}:${msg.lang}`, () => neodbComments(msg.uuid, msg.lang), 24 * 3600 * 1000).then(
      send,
      () => send([])
    );
    return true;
  }
});

chrome.storage.onChanged.addListener(async (_c, area) => {
  if (area !== "sync" || !_c.omdbKey) return;
  const all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith("v5:")));
});
