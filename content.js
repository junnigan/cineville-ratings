(() => {
  const DEFAULTS = { translate: true, lang: "zh-cn", showComments: true };
  let settings = { ...DEFAULTS };
  const done = new WeakSet();
  const views = []; // { holder, slug, res, detail } 用于设置变更后重绘

  const ALIASES = {
    "zh-cn": ["zh-cn", "zh-hans", "zh"],
    "zh-tw": ["zh-tw", "zh-hant", "zh-hk", "zh"],
  };
  const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

  // ---- 请求队列(列表页卡片多,限制并发) ----
  let active = 0;
  const queue = [];
  function request(msg) {
    return new Promise((resolve) => {
      queue.push({ msg, resolve });
      pump();
    });
  }
  function pump() {
    while (active < 4 && queue.length) {
      const { msg, resolve } = queue.shift();
      active++;
      chrome.runtime.sendMessage(msg).then(resolve, () => resolve({ error: "x" })).finally(() => { active--; pump(); });
    }
  }

  // ---- 取译名 / 简介 ----
  function pick(list, lang) {
    for (const code of ALIASES[lang] || [lang]) {
      const hit = (list || []).find((l) => l.lang === code);
      if (hit) return hit.text;
    }
    return null;
  }

  // ---- 渲染 ----
  function chip(cls, label, d) {
    const el = document.createElement(d?.url ? "a" : "span");
    el.className = `cvr-chip ${cls}`;
    if (d?.url) Object.assign(el, { href: d.url, target: "_blank", rel: "noopener" });
    el.textContent = `${label} ${d?.rating ? d.rating.toFixed(1) : "–"}`;
    if (d?.count) el.title = `${d.count} ratings`;
    else if (d?.blocked) el.title = "豆瓣拒绝了请求,请先在此浏览器登录豆瓣";
    return el;
  }

  function badge(res, originalTitle) {
    const b = document.createElement("div");
    b.className = "cvr-badge";
    if (!res || res.error || !res.found) {
      const s = document.createElement("span");
      s.className = "cvr-chip cvr-muted";
      s.textContent = res?.error ? "加载失败" : "未找到";
      b.append(s);
      return b;
    }
    if (settings.translate) {
      const t = pick(res.titles, settings.lang);
      if (t && norm(t) !== norm(originalTitle)) {
        const d = document.createElement("div");
        d.className = "cvr-title";
        d.textContent = t;
        b.append(d);
      }
    }
    b.append(chip("cvr-douban", "豆瓣", res.douban));
    b.append(chip("cvr-imdb", "IMDb", res.imdb));
    b.append(chip("cvr-neodb", "NeoDB", res.neodb));
    return b;
  }

  function block(title) {
    const box = document.createElement("div");
    box.className = "cvr-block";
    const h = document.createElement("h4");
    h.textContent = title;
    box.append(h);
    return box;
  }

  function synopsisBlock(res) {
    if (res.meta.description) return null; // Cineville 自己有简介
    const text = pick(res.descriptions, settings.lang) || pick(res.descriptions, "en") || res.descriptions?.[0]?.text;
    if (!text) return null;
    const box = block("简介");
    const p = document.createElement("p");
    p.textContent = text;
    const s = document.createElement("small");
    s.textContent = "来源:NeoDB";
    box.append(p, s);
    return box;
  }

  async function commentsBlock(res) {
    const doubanC = res.douban?.comments || [];
    const neo = await request({ type: "comments", uuid: res.uuid, lang: settings.lang });
    if (!doubanC.length && !neo?.length) return null;
    const frag = document.createDocumentFragment();
    const add = (title, items, src) => {
      if (!items.length) return;
      const box = block(title);
      for (const c of items) {
        const p = document.createElement("p");
        const u = document.createElement("b");
        u.textContent = c.user + (c.stars ? ` ${"★".repeat(Math.round(c.stars))}` : "") + " ";
        p.append(u, c.text.length > 220 ? c.text.slice(0, 220) + "…" : c.text);
        if (c.url) {
          const a = document.createElement("a");
          Object.assign(a, { href: c.url, target: "_blank", rel: "noopener", textContent: "原文" });
          p.append(a);
        }
        box.append(p);
      }
      frag.append(box);
    };
    add("豆瓣短评", doubanC, "douban");
    add("NeoDB 短评", neo || [], "neodb");
    return frag;
  }

  async function render(v) {
    const b = badge(v.res, v.title);
    v.holder.replaceChildren(b);
    if (!v.detail || !v.res?.found) return;
    const syn = synopsisBlock(v.res);
    if (syn) v.holder.append(syn);
    if (settings.showComments) {
      const token = (v.token = {});
      const c = await commentsBlock(v.res);
      if (c && v.token === token) v.holder.append(c);
    }
  }

  // ---- 扫描页面 ----
  const slugOf = (href) => new URL(href, location.href).pathname.match(/\/films\/([^/?#]+)/)?.[1];

  function scan() {
    for (const a of document.querySelectorAll('h3 a[href*="/films/"]')) {
      if (done.has(a)) continue;
      done.add(a);
      const slug = slugOf(a.href);
      if (!slug) continue;
      const holder = document.createElement("div");
      a.closest("h3").after(holder);
      const v = { holder, slug, title: a.textContent.trim(), detail: false };
      views.push(v);
      request({ type: "film", slug }).then((res) => { v.res = res; render(v); });
    }
    const slug = /\/films\/[^/]+\/?$/.test(location.pathname) && slugOf(location.href);
    const h1 = slug && document.querySelector("h1");
    if (h1 && !done.has(h1)) {
      done.add(h1);
      const holder = document.createElement("div");
      h1.after(holder);
      const v = { holder, slug, title: h1.textContent.trim(), detail: true };
      views.push(v);
      request({ type: "film", slug }).then((res) => { v.res = res; render(v); });
    }
  }

  chrome.storage.sync.get(DEFAULTS).then((s) => {
    settings = { ...DEFAULTS, ...s };
    scan();
  });
  chrome.storage.onChanged.addListener((_c, area) => {
    if (area !== "sync") return;
    chrome.storage.sync.get(DEFAULTS).then((s) => {
      settings = { ...DEFAULTS, ...s };
      for (const v of views) if (v.res && v.holder.isConnected) render(v);
    });
  });

  let t;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(scan, 300); })
    .observe(document.body, { childList: true, subtree: true });
})();
