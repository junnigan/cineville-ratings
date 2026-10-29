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

const getSettings = () => chrome.storage.sync.get({ omdbKey: "", tmdbKey: "" });

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
    cast: (f.cast || []).map((c) => c.replace(/&#0?39;|&#x27;/g, "'")),
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

// 片名对不上时(Cineville 用本地片名,NeoDB 用英文名),改用导演 + 演员 + 年份匹配
function personScore(item, meta) {
  const dirs = (meta.directors || []).map(norm);
  const names = (item.credits || []).map((c) => ({ role: c.role, n: norm(c.name) }));
  let s = 0;
  if (names.some((c) => c.role === "director" && dirs.includes(c.n))) s += 2;
  const cast = new Set((meta.cast || []).map(norm));
  s += Math.min(2, names.filter((c) => c.role !== "director" && cast.has(c.n)).length) * 2;
  const years = (item.tags || []).filter((t) => /^(19|20)\d\d$/.test(t)).map(Number);
  if (meta.year && years.length) s += years.some((y) => Math.abs(y - meta.year) <= 1) ? 2 : -3;
  return s;
}

async function neodbByPeople(meta) {
  for (const d of (meta.directors || []).slice(0, 2)) {
    const r = await fetch(`https://neodb.social/api/catalog/search?category=movie&query=${encodeURIComponent(d)}`);
    if (!r.ok) continue;
    const { data } = await r.json();
    const ranked = (data || [])
      .map((it) => ({ it, s: personScore(it, meta) }))
      .filter((x) => x.s >= 4)
      .sort((a, b) => b.s - a.s || (b.it.rating_count || 0) - (a.it.rating_count || 0));
    if (ranked.length) return ranked[0].it;
  }
  return null;
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
  return neodbByPeople(meta);
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

// ---- TMDB(需要用户自己的 key) ----

async function tmdbFetch(path, params, key) {
  const url = new URL("https://api.themoviedb.org/3" + path);
  for (const [k, v] of Object.entries(params || {})) if (v != null) url.searchParams.set(k, v);
  const init = {};
  // v4 读取令牌(eyJ 开头)走 Bearer,v3 key 走 api_key 参数
  if (key.startsWith("eyJ")) init.headers = { Authorization: `Bearer ${key}` };
  else url.searchParams.set("api_key", key);
  const r = await fetch(url, init);
  if (!r.ok) throw new Error("TMDB " + r.status);
  return r.json();
}

const tmdbYear = (m) => +(m.release_date || "").slice(0, 4) || null;

function tmdbScore(m, q, year) {
  const want = norm(q);
  const names = [m.title, m.original_title].map(norm);
  let s = 0;
  if (names.includes(want)) s += 3;
  else if (names.some((n) => n && want.length > 3 && (n.includes(want) || want.includes(n)))) s += 1;
  const y = tmdbYear(m);
  if (year && y) s += Math.abs(y - year) <= 1 ? 2 : -3;
  return s;
}

// 备用匹配用:导演或演员至少有一个对得上
function tmdbVerify(d, meta) {
  const dirs = new Set((meta.directors || []).map(norm));
  const cast = new Set((meta.cast || []).map(norm));
  const crew = d.credits?.crew || [];
  const actors = d.credits?.cast || [];
  return (
    crew.some((c) => c.job === "Director" && dirs.has(norm(c.name))) ||
    actors.some((c) => cast.has(norm(c.name)))
  );
}

const DETAIL = "translations,external_ids,reviews,credits";

async function tmdbLookup(meta, key) {
  const tried = new Set();
  for (const q of titleCandidates(meta.title)) {
    for (const year of [meta.year, null]) {
      const { results } = await tmdbFetch("/search/movie", { query: q, year, include_adult: "false" }, key);
      const ranked = (results || [])
        .slice(0, 5)
        .map((m) => ({ m, s: tmdbScore(m, q, meta.year) }))
        .sort((a, b) => b.s - a.s || b.m.vote_count - a.m.vote_count);
      for (const { m, s } of ranked.slice(0, 3)) {
        if (tried.has(m.id)) continue;
        const yearOk = !meta.year || !tmdbYear(m) || Math.abs(tmdbYear(m) - meta.year) <= 1;
        if (s < 3 && !yearOk) continue;
        tried.add(m.id);
        const d = await tmdbFetch(`/movie/${m.id}`, { language: "en-US", append_to_response: DETAIL }, key);
        // 片名一致直接接受;靠别名搜到的,要导演/演员对得上才接受
        if (s >= 3 || tmdbVerify(d, meta)) return d;
      }
    }
  }
  return null;
}

// TMDB 的语言标记转成 NeoDB 风格:zh-CN -> zh-cn
const tmdbLang = (t) =>
  t.iso_639_1 === "zh" ? `zh-${(t.iso_3166_1 || "cn").toLowerCase()}` : t.iso_639_1;

function tmdbTexts(d) {
  const titles = [], descriptions = [];
  for (const t of d.translations?.translations || []) {
    const lang = tmdbLang(t);
    if (t.data?.title) titles.push({ lang, text: t.data.title });
    if (t.data?.overview?.length > 40) descriptions.push({ lang, text: t.data.overview.trim(), src: "TMDB" });
  }
  if (d.overview) descriptions.push({ lang: "en", text: d.overview.trim(), src: "TMDB" });
  return { titles, descriptions };
}

function tmdbReviews(d) {
  return (d.reviews?.results || [])
    .map((r) => ({
      user: r.author_details?.name || r.author,
      url: r.url,
      text: r.content.replace(/\r/g, "").replace(/[*_#>`]/g, "").replace(/\s+/g, " ").trim(),
      stars: r.author_details?.rating ? r.author_details.rating / 2 : null,
      likes: 0,
      src: "tmdb",
    }))
    .filter((c) => c.text.length >= 30)
    .slice(0, 10);
}

// ---- main lookup ----

async function lookup(slug, locale) {
  const meta = await cinevilleMeta(slug, locale);
  const { omdbKey, tmdbKey } = await getSettings();

  const tmdb = tmdbKey ? await tmdbLookup(meta, tmdbKey).catch((e) => ({ error: String(e) })) : null;
  const tm = tmdb && !tmdb.error ? tmdb : null;

  // 有 TMDB 结果时,用它的英文原名和年份去查 NeoDB,比 Cineville 的本地片名准
  let item = null;
  if (tm) item = await neodbLookup({ ...meta, title: tm.original_title || tm.title, year: tmdbYear(tm) || meta.year });
  if (!item) item = await neodbLookup(meta);
  if (!item && !tm) return { found: false, meta, tmdbError: tmdb?.error || null };

  const ext = (item?.external_resources || []).map((e) => e.url);
  const doubanId = ext.map((u) => u.match(/movie\.douban\.com\/subject\/(\d+)/)?.[1]).find(Boolean);
  const imdbId = tm?.external_ids?.imdb_id || ext.map((u) => u.match(/imdb\.com\/title\/(tt\d+)/)?.[1]).find(Boolean);

  const [douban, imdb] = await Promise.all([
    doubanId ? doubanInfo(doubanId).catch(() => ({ blocked: true })) : null,
    imdbId ? imdbInfo(imdbId, omdbKey).catch((e) => ({ error: String(e) })) : null,
  ]);

  // TMDB 的译名放前面:同一语言有多个译名时优先取它
  const t = tm ? tmdbTexts(tm) : { titles: [], descriptions: [] };
  const seen = new Set();
  const titles = [];
  for (const l of [...t.titles, ...(item?.localized_title || [])]) {
    const k = l.lang + "|" + l.text;
    if (!seen.has(k)) (seen.add(k), titles.push({ lang: l.lang, text: l.text }));
  }
  const descriptions = [
    ...t.descriptions,
    ...(item?.localized_description || [])
      .filter((l) => l.text.length > 80)
      .map((l) => ({ lang: l.lang, text: l.text.trim(), src: "NeoDB" })),
  ].slice(0, 24);

  return {
    found: true,
    partial: !!(douban?.blocked || (imdbId && !imdb?.rating)),
    meta,
    uuid: item?.uuid || null,
    titles: titles.slice(0, 80),
    descriptions,
    tmdb: tm
      ? { rating: tm.vote_count ? tm.vote_average : null, count: tm.vote_count, url: `https://www.themoviedb.org/movie/${tm.id}`, reviews: tmdbReviews(tm) }
      : tmdb?.error
        ? { error: tmdb.error }
        : null,
    neodb: item
      ? { rating: item.rating || null, count: item.rating_count, url: "https://neodb.social" + item.url }
      : null,
    douban: {
      ...(douban || {}),
      url: doubanId ? `https://movie.douban.com/subject/${doubanId}/` : null,
    },
    imdb: { ...(imdb || {}), url: imdbId ? `https://www.imdb.com/title/${imdbId}/` : null },
  };
}

// ---- NeoDB short reviews ----

async function neodbComments(uuid, lang) {
  if (!uuid) return [];
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
    cached(`v6:${msg.locale}:${msg.slug}`, () => lookup(msg.slug, msg.locale)).then(send, (e) => send({ error: String(e) }));
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
  if (area !== "sync" || !(_c.omdbKey || _c.tmdbKey)) return;
  const all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith("v6:")));
});

chrome.runtime.onMessage.addListener((msg, _s, send) => {
  if (msg?.type !== "clearCache") return;
  chrome.storage.local.clear().then(() => send(true));
  return true;
});

// 点工具栏图标:在当前 Cineville 页面打开设置面板
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { type: "togglePanel" }).catch(() => {});
});
