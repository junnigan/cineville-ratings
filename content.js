(() => {
  const DEFAULTS = {
    showDouban: true, showImdb: true, showNeodb: true, showOnList: true, hideNotFound: false,
    translate: true, lang: "zh-cn",
    showComments: true, commentDouban: true, commentNeodb: true, commentCount: "5",
  };
  let settings = { ...DEFAULTS };
  const done = new WeakSet();
  const views = []; // { holder, extra, slug, res, title, detail } 设置变更后重绘用

  const ALIASES = { "zh-cn": ["zh-cn", "zh-hans", "zh"], "zh-tw": ["zh-tw", "zh-hant", "zh-hk", "zh"] };
  const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const isZh = () => settings.lang.startsWith("zh");

  // ---- 请求队列(列表页卡片多,限制并发) ----
  let active = 0;
  const queue = [];
  function request(msg) {
    return new Promise((resolve) => { queue.push({ msg, resolve }); pump(); });
  }
  function pump() {
    while (active < 4 && queue.length) {
      const { msg, resolve } = queue.shift();
      active++;
      chrome.runtime.sendMessage(msg).then(resolve, () => resolve({ error: "x" })).finally(() => { active--; pump(); });
    }
  }

  const pick = (list, lang) => {
    for (const code of ALIASES[lang] || [lang]) {
      const hit = (list || []).find((l) => l.lang === code);
      if (hit) return hit.text;
    }
    return null;
  };

  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  // ---- 评分标签 ----
  function chip(cls, label, d) {
    const e = h(d?.url ? "a" : "span", `cvr-chip ${cls}`);
    if (d?.url) Object.assign(e, { href: d.url, target: "_blank", rel: "noopener" });
    e.append(h("i", null, label), h("b", null, d?.rating ? d.rating.toFixed(1) : "–"));
    if (d?.count) e.title = `${d.count.toLocaleString()} ratings`;
    else if (d?.blocked) e.title = "豆瓣拒绝了请求,请先在此浏览器登录豆瓣";
    else if (d?.error === "nokey") e.title = "在插件设置里填写 OMDb key 才能显示 IMDb 评分";
    else if (d?.error) e.title = d.error;
    return e;
  }

  function badge(v) {
    const { res, title } = v;
    const b = h("div", "cvr-badge");
    if (!res || res.error || !res.found) {
      if (settings.hideNotFound && !res?.error) return null;
      b.append(h("span", "cvr-chip cvr-muted", res?.error ? "加载失败" : "未找到"));
      return b;
    }
    if (settings.translate) {
      const t = pick(res.titles, settings.lang);
      if (t && norm(t) !== norm(title)) b.append(h("div", "cvr-title", t));
    }
    if (settings.showDouban) b.append(chip("cvr-douban", "豆瓣", res.douban));
    if (settings.showImdb) b.append(chip("cvr-imdb", "IMDb", res.imdb));
    if (settings.showNeodb) b.append(chip("cvr-neodb", "NeoDB", res.neodb));
    return b.children.length ? b : null;
  }

  // ---- 简介(Cineville 没有时,从豆瓣 / IMDb / NeoDB 取) ----
  function synopsis(res) {
    if (res.meta.description) return null;
    const cands = [];
    const lang = settings.lang;
    for (const code of ALIASES[lang] || [lang]) {
      const d = (res.descriptions || []).find((x) => x.lang === code);
      if (d) cands.push({ lang, text: d.text, src: "NeoDB" });
    }
    if (res.douban?.summary) cands.push({ lang: "zh", text: res.douban.summary, src: "豆瓣" });
    if (res.imdb?.plot) cands.push({ lang: "en", text: res.imdb.plot, src: "IMDb" });
    const en = (res.descriptions || []).find((x) => x.lang === "en");
    if (en) cands.push({ lang: "en", text: en.text, src: "NeoDB" });
    // 目标语言优先:中文优先豆瓣
    const want = isZh() ? "zh" : lang;
    cands.sort((a, b) => (b.lang.startsWith(want) ? 1 : 0) - (a.lang.startsWith(want) ? 1 : 0));
    return cands[0] || null;
  }

  function synopsisBlock(s) {
    const sec = h("section", "cvr-sec");
    sec.append(h("h3", null, "简介"));
    const cls = document.querySelector('p[class*="variant-body"]')?.className;
    for (const para of s.text.split(/\n+/).filter(Boolean)) sec.append(h("p", cls, para));
    sec.append(h("span", "cvr-src", `来源:${s.src}`));
    return sec;
  }

  // ---- 短评(豆瓣样式) ----
  function stars(n) {
    const s = h("span", "cvr-stars");
    s.append("★".repeat(n));
    s.append(h("s", null, "☆".repeat(5 - n)));
    return s;
  }

  function commentRow(c) {
    const row = h("div", "cvr-cmt");
    const head = h("div", "cvr-head");
    const u = h(c.url ? "a" : "span", null, c.user);
    if (c.url) Object.assign(u, { href: c.url, target: "_blank", rel: "noopener" });
    head.append(u);
    if (isZh()) head.append("看过");
    if (c.stars) head.append(stars(Math.round(c.stars)));
    head.append(h("span", "cvr-from", c.src === "douban" ? "豆瓣" : "NeoDB"));
    if (c.likes) head.append(h("span", "cvr-vote", `${c.likes} ${c.src === "douban" ? "有用" : "赞"}`));
    row.append(head, h("p", null, c.text.length > 240 ? c.text.slice(0, 240) + "…" : c.text));
    return row;
  }

  async function commentsBlock(res) {
    let items = [];
    if (settings.commentDouban) items.push(...(res.douban?.comments || []));
    if (settings.commentNeodb) {
      const neo = await request({ type: "comments", uuid: res.uuid, lang: settings.lang });
      if (Array.isArray(neo)) items.push(...neo);
    }
    items = items.slice(0, +settings.commentCount || 5);
    if (!items.length) return null;
    const sec = h("section", "cvr-sec");
    sec.append(h("h3", null, "短评"));
    for (const c of items) sec.append(commentRow(c));
    return sec;
  }

  // ---- 渲染 ----
  async function render(v) {
    const listHidden = !v.detail && !settings.showOnList;
    const b = listHidden ? null : badge(v);
    b ? v.holder.replaceChildren(b) : v.holder.replaceChildren();
    if (!v.detail || !v.res?.found) return;

    const token = (v.token = {});
    const syn = synopsis(v.res);
    const cm = settings.showComments ? await commentsBlock(v.res) : null;
    if (v.token !== token) return;
    v.extra.replaceChildren(...[syn && synopsisBlock(syn), cm].filter(Boolean));
  }

  // ---- 扫描页面 ----
  const slugOf = (href) => new URL(href, location.href).pathname.match(/\/films\/([^/?#]+)/)?.[1];

  function track(v) {
    views.push(v);
    request({ type: "film", slug: v.slug }).then((res) => { v.res = res; render(v); });
  }

  function scan() {
    if (settings.showOnList) {
      for (const a of document.querySelectorAll('h3 a[href*="/films/"]')) {
        if (done.has(a)) continue;
        done.add(a);
        const slug = slugOf(a.href);
        if (!slug) continue;
        const holder = h("div");
        a.closest("h3").after(holder);
        track({ holder, slug, title: a.textContent.trim(), detail: false });
      }
    }
    const slug = /\/films\/[^/]+\/?$/.test(location.pathname) && slugOf(location.href);
    const h1 = slug && document.querySelector("h1");
    if (h1 && !done.has(h1)) {
      done.add(h1);
      const holder = h("div");
      h1.after(holder);
      // 简介和短评放在正文末尾,即 Cineville 自己的简介下方
      const extra = h("div", "cvr-extra");
      (h1.closest("main") || h1.parentElement).append(extra);
      track({ holder, extra, slug, title: h1.textContent.trim(), detail: true });
    }
  }

  const load = () => chrome.storage.sync.get(DEFAULTS).then((s) => (settings = { ...DEFAULTS, ...s }));
  load().then(scan);
  chrome.storage.onChanged.addListener((_c, area) => {
    if (area !== "sync") return;
    load().then(() => {
      for (const v of views) if (v.res && v.holder.isConnected) render(v);
      scan();
    });
  });

  let t;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(scan, 300); })
    .observe(document.body, { childList: true, subtree: true });
})();
