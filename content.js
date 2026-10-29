(() => {
  const DEFAULTS = {
    showDouban: true, showImdb: true, showNeodb: true, showTmdb: true, showOnList: true, hideNotFound: false,
    translate: true, lang: "zh-cn",
    showComments: true, commentDouban: true, commentNeodb: true, commentTmdb: true, commentCount: "8", autoTranslate: true,
    omdbKey: "", tmdbKey: "",
  };
  let settings = { ...DEFAULTS };
  const views = new Map(); // 页面元素(标题链接 / h1) -> view,轮播切换时复用同一个元素

  const ALIASES = { "zh-cn": ["zh-cn", "zh-hans", "zh"], "zh-tw": ["zh-tw", "zh-hant", "zh-hk", "zh"] };
  const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const isZh = () => settings.lang.startsWith("zh");
  // 按页面当前语言版本取数据(英文版和荷兰语版的简介可能不同)
  const locale = /^\/([a-z]{2}-[A-Z]{2})\//.exec(location.pathname)?.[1] || "nl-NL";
  const slugOf = (href) => new URL(href, location.href).pathname.match(/\/films\/([^/?#]+)/)?.[1];

  const h = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

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

  // ---- 评分标签 ----
  function chip(cls, label, d) {
    const e = h(d?.url ? "a" : "span", `cvr-chip ${cls}`);
    if (d?.url) Object.assign(e, { href: d.url, target: "_blank", rel: "noopener" });
    e.append(h("i", null, label), h("b", null, d?.rating ? d.rating.toFixed(1) : "–"));
    if (d?.count) e.title = `${d.count.toLocaleString()} ratings`;
    else if (d?.blocked) e.title = "豆瓣拒绝了请求,请先在此浏览器登录豆瓣";
    else if (d?.error === "nokey") e.title = "在设置里填写 OMDb key 才能显示 IMDb 评分";
    else if (d?.error) e.title = d.error;
    else if (d?.url && !d.rating) e.title = "暂无评分";
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
    if (settings.showNeodb && res.neodb) b.append(chip("cvr-neodb", "NeoDB", res.neodb));
    if (settings.showTmdb && res.tmdb) b.append(chip("cvr-tmdb", "TMDB", res.tmdb));
    return b.children.length ? b : null;
  }

  // ---- 简介 ----
  // 返回要显示的简介,或 null。Cineville 没有简介时补一个;开了翻译时用目标语言简介替换原简介。
  function synopsis(res) {
    const lang = settings.lang;
    const want = isZh() ? "zh" : lang;
    const cands = [];
    for (const code of ALIASES[lang] || [lang]) {
      const d = (res.descriptions || []).find((x) => x.lang === code);
      if (d) cands.push({ lang, text: d.text, src: d.src || "NeoDB" });
    }
    if (res.douban?.summary) cands.push({ lang: "zh", text: res.douban.summary, src: "豆瓣" });
    if (res.imdb?.plot) cands.push({ lang: "en", text: res.imdb.plot, src: "IMDb" });
    const en = (res.descriptions || []).find((x) => x.lang === "en");
    if (en) cands.push({ lang: "en", text: en.text, src: en.src || "NeoDB" });
    cands.sort((a, b) => (b.lang.startsWith(want) ? 1 : 0) - (a.lang.startsWith(want) ? 1 : 0));

    if (!res.meta.description) return cands[0] || null;
    // 已有简介:只有开了翻译、页面语言不同、且有目标语言的简介时才替换
    if (!settings.translate || want === locale.split("-")[0]) return null;
    return cands.find((c) => c.lang.startsWith(want)) || null;
  }

  function synopsisBlock(s) {
    const sec = h("section", "cvr-sec");
    sec.append(h("h3", null, "简介"));
    const cls = document.querySelector('p[class*="variant-body"]')?.className;
    for (const para of s.text.split(/\n+/).filter(Boolean)) sec.append(h("p", cls, para));
    sec.append(h("span", "cvr-src", `来源:${s.src}`));
    return sec;
  }

  // 隐藏 / 恢复 Cineville 自己的简介
  function setOriginalHidden(main, hide) {
    const orig = [...main.children].find((el) => el.tagName === "DIV" && !el.classList.contains("cvr-extra") && el.querySelector(":scope > p"));
    if (orig) orig.style.display = hide ? "none" : "";
  }

  // ---- 短评(豆瓣样式) ----
  function stars(n) {
    const s = h("span", "cvr-stars");
    s.append("★".repeat(n));
    s.append(h("s", null, "☆".repeat(5 - n)));
    return s;
  }

  // ---- 外语短评翻译(Chrome 内置 Translator API,本机运行,不需要 key) ----
  const targetCode = () => (settings.lang.startsWith("zh") ? (settings.lang === "zh-cn" ? "zh" : "zh-Hant") : settings.lang);
  const translators = new Map();
  // 返回译文;"click" 表示需要用户点一下才能下载语言包;null 表示不可用
  async function translate(text, src, userInitiated) {
    if (!("Translator" in self)) return null;
    const target = targetCode();
    if (src === target.split("-")[0]) return null;
    const key = `${src}>${target}`;
    try {
      let t = translators.get(key);
      if (!t) {
        const opts = { sourceLanguage: src, targetLanguage: target };
        const avail = await Translator.availability(opts);
        if (avail === "unavailable") return null;
        if (avail !== "available" && !userInitiated) return "click";
        t = await Translator.create(opts);
        translators.set(key, t);
      }
      return await t.translate(text);
    } catch {
      return null;
    }
  }

  function commentRow(c, autoTranslate) {
    const row = h("div", "cvr-cmt");
    const head = h("div", "cvr-head");
    const u = h(c.url ? "a" : "span", null, c.user);
    if (c.url) Object.assign(u, { href: c.url, target: "_blank", rel: "noopener" });
    head.append(u);
    if (isZh()) head.append("看过");
    if (c.stars) head.append(stars(Math.round(c.stars)));
    head.append(h("span", "cvr-from", { douban: "豆瓣", neodb: "NeoDB", tmdb: "TMDB" }[c.src]));
    if (c.likes) head.append(h("span", "cvr-vote", `${c.likes} ${c.src === "douban" ? "有用" : "赞"}`));
    const original = c.text;
    const body = h("p", null, original);
    row.append(head, body);
    // 长评先折叠成几行,点"展开"看全文
    if (original.length > 180) {
      body.classList.add("cvr-clamp");
      const more = h("a", "cvr-tr", "展开");
      more.addEventListener("click", () => {
        const open = body.classList.toggle("cvr-clamp");
        more.textContent = open ? "展开" : "收起";
      });
      row.append(more);
    }

    // 外语短评:提供"翻译"链接;豆瓣短评不可用时自动翻译
    if (c.lang && c.lang !== targetCode().split("-")[0] && "Translator" in self) {
      const link = h("a", "cvr-tr", "翻译");
      let translated = null, showing = false;
      const apply = async (userInitiated) => {
        if (showing) { body.textContent = original; link.textContent = "翻译"; showing = false; return; }
        translated ||= await translate(original, c.lang, userInitiated);
        if (translated && translated !== "click") {
          body.textContent = translated;
          link.textContent = "显示原文";
          showing = true;
        } else if (translated === "click") {
          link.textContent = "翻译(首次需下载语言包)";
          translated = null;
        }
      };
      link.addEventListener("click", () => apply(true));
      head.append(link);
      if (autoTranslate) apply(false);
    }
    return row;
  }

  // 多个来源轮流取,避免全被一个来源占满
  function interleave(lists, n) {
    const out = [];
    for (let i = 0; out.length < n && lists.some((l) => i < l.length); i++)
      for (const l of lists) if (i < l.length && out.length < n) out.push(l[i]);
    return out;
  }

  async function commentsBlock(res) {
    const lists = [];
    if (settings.commentDouban) lists.push(res.douban?.comments || []);
    if (settings.commentNeodb) {
      const neo = await request({ type: "comments", uuid: res.uuid, lang: settings.lang });
      lists.push(Array.isArray(neo) ? neo : []);
    }
    if (settings.commentTmdb) lists.push(res.tmdb?.reviews || []);
    const items = interleave(lists, +settings.commentCount || 8);
    if (!items.length) return null;
    const sec = h("section", "cvr-sec");
    sec.append(h("h3", null, "短评"));
    const doubanMissing = !res.douban?.comments?.length;
    for (const c of items) sec.append(commentRow(c, settings.autoTranslate && doubanMissing));
    return sec;
  }

  // ---- 渲染 ----
  async function render(v) {
    const listHidden = !v.detail && !settings.showOnList;
    const b = listHidden ? null : badge(v);
    // 深色横幅等位置:文字颜色跟随旁边的标题,避免看不清
    if (v.ref?.isConnected) v.holder.style.color = getComputedStyle(v.ref).color;
    v.holder.replaceChildren(...(b ? [b] : []));
    if (!v.detail) return;

    const main = v.extra.parentElement;
    if (!v.res?.found) { v.extra.replaceChildren(); main && setOriginalHidden(main, false); return; }
    const token = (v.token = {});
    const syn = synopsis(v.res);
    const cm = settings.showComments ? await commentsBlock(v.res) : null;
    if (v.token !== token) return;
    v.extra.replaceChildren(...[syn && synopsisBlock(syn), cm].filter(Boolean));
    if (main) setOriginalHidden(main, !!syn && !!v.res.meta.description);
  }

  function load(v) {
    const slug = v.slug;
    v.res = null;
    request({ type: "film", slug, locale }).then((res) => {
      if (v.slug !== slug) return; // 轮播已经切到别的电影
      v.res = res;
      render(v);
    });
  }

  // ---- 扫描页面 ----
  function scan() {
    if (settings.showOnList) {
      for (const a of document.querySelectorAll('h3 a[href*="/films/"]')) {
        const slug = slugOf(a.href);
        if (!slug) continue;
        let v = views.get(a);
        if (v && v.slug === slug && v.holder.isConnected) { v.title = a.textContent.trim(); continue; }
        if (!v) { v = { ref: a, detail: false }; views.set(a, v); }
        // 横幅轮播会复用同一个链接元素,换电影时重新取数据
        v.holder?.remove();
        v.holder = h("div");
        a.closest("h3").after(v.holder);
        Object.assign(v, { slug, title: a.textContent.trim() });
        load(v);
      }
    }
    const slug = /\/films\/[^/]+\/?$/.test(location.pathname) && slugOf(location.href);
    const h1 = slug && document.querySelector("h1");
    if (h1) {
      let v = views.get(h1);
      if (v && v.slug === slug && v.holder.isConnected && v.extra.isConnected) return;
      if (!v) { v = { ref: h1, detail: true }; views.set(h1, v); }
      v.holder?.remove();
      v.extra?.remove();
      v.holder = h("div");
      h1.after(v.holder);
      // 简介和短评放在正文末尾,即 Cineville 自己的简介下方
      v.extra = h("div", "cvr-extra");
      (h1.closest("main") || h1.parentElement).append(v.extra);
      Object.assign(v, { slug, title: h1.textContent.trim() });
      load(v);
    }
  }

  // ---- 页面内设置面板 ----
  const SCHEMA = [
    { head: "评分来源" },
    { k: "showDouban", l: "豆瓣" },
    { k: "showImdb", l: "IMDb" },
    { k: "showNeodb", l: "NeoDB" },
    { k: "showTmdb", l: "TMDB(需要填写 key)" },
    { k: "showOnList", l: "在列表页和横幅上也显示" },
    { k: "hideNotFound", l: "找不到时不显示“未找到”" },
    { head: "翻译" },
    { k: "translate", l: "显示官方译名,并用目标语言简介替换原简介" },
    { k: "lang", l: "目标语言", opts: [["zh-cn", "简体中文"], ["zh-tw", "繁體中文"], ["en", "English"], ["ja", "日本語"], ["ko", "한국어"], ["fr", "Français"], ["de", "Deutsch"], ["es", "Español"], ["nl", "Nederlands"]] },
    { head: "短评" },
    { k: "showComments", l: "在详情页显示短评" },
    { k: "commentDouban", l: "来自豆瓣" },
    { k: "commentNeodb", l: "来自 NeoDB" },
    { k: "commentTmdb", l: "来自 TMDB(英文为主)" },
    { k: "autoTranslate", l: "豆瓣短评拿不到时,自动翻译外语短评(Chrome 内置翻译)" },
    { k: "commentCount", l: "最多显示条数", opts: [["3", "3"], ["5", "5"], ["8", "8"], ["12", "12"]] },
    { head: "API Key(免费申请,只保存在本浏览器)" },
    { k: "tmdbKey", l: "TMDB(themoviedb.org):匹配、译名、简介、评论", text: true, link: "https://www.themoviedb.org/settings/api" },
    { k: "omdbKey", l: "OMDb(omdbapi.com):IMDb 评分", text: true, link: "https://www.omdbapi.com/apikey.aspx" },
  ];

  function buildPanel() {
    const host = h("div");
    host.id = "cvr-settings";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      *{box-sizing:border-box}
      .fab{position:fixed;right:16px;bottom:16px;width:40px;height:40px;border:0;border-radius:50%;background:#101a3d;color:#fff;font-size:20px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3);z-index:2147483000}
      .panel{position:fixed;right:16px;bottom:64px;width:320px;max-height:70vh;overflow:auto;padding:14px 16px;background:#fff;color:#1a1a1a;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.28);font:14px/1.5 var(--fonts-averta,system-ui,sans-serif);z-index:2147483000;text-align:left}
      .panel[hidden]{display:none}
      h4{margin:14px 0 4px;font-size:12px;color:#777;font-weight:600}h4:first-child{margin-top:0}
      label{display:flex;gap:8px;align-items:flex-start;margin:4px 0}
      .col{display:block}select,input[type=text]{width:100%;margin-top:3px;padding:4px;font:inherit}
      a.getkey{display:inline-block;margin-top:4px;padding:3px 10px;border:1px solid #101a3d;border-radius:999px;color:#101a3d;font-size:12px;text-decoration:none;align-self:flex-start}a.getkey:hover{background:#101a3d;color:#fff}
      button.clear{margin-top:12px;padding:4px 10px;font:inherit}
      .credit{display:block;margin-top:10px;color:#888;font-size:11px;line-height:1.4}.msg{color:#2e963d;font-size:12px;min-height:1em;margin-top:6px}
    </style>
    <button class="fab" title="Cineville Ratings 设置">⚙</button><div class="panel" hidden></div>`;
    const panel = root.querySelector(".panel");
    const msg = h("div", "msg");
    const flash = (t) => { msg.textContent = t; setTimeout(() => (msg.textContent = ""), 1500); };
    for (const f of SCHEMA) {
      if (f.head) { panel.append(h("h4", null, f.head)); continue; }
      const lab = h("label", f.opts || f.text ? "col" : "");
      let input;
      if (f.opts) {
        input = h("select");
        for (const [v, t] of f.opts) input.append(Object.assign(h("option", null, t), { value: v }));
        input.value = settings[f.k];
        lab.append(h("span", null, f.l), input);
      } else if (f.text) {
        input = Object.assign(h("input"), { type: "text", value: settings[f.k] });
        lab.append(h("span", null, f.l), input);
        if (f.link) {
          const a = h("a", "getkey", "免费申请 Key ↗");
          Object.assign(a, { href: f.link, target: "_blank", rel: "noopener" });
          lab.append(a);
        }
      } else {
        input = Object.assign(h("input"), { type: "checkbox", checked: !!settings[f.k] });
        lab.append(input, h("span", null, f.l));
      }
      input.addEventListener("change", () => {
        const val = input.type === "checkbox" ? input.checked : input.value.trim();
        chrome.storage.sync.set({ [f.k]: val });
        flash("已保存");
      });
      panel.append(lab);
    }
    const clear = h("button", "clear", "清除缓存");
    clear.addEventListener("click", () => chrome.runtime.sendMessage({ type: "clearCache" }).then(() => flash("缓存已清除,刷新页面生效")));
    const credit = h("small", "credit", "This product uses the TMDB API but is not endorsed or certified by TMDB. 数据来源:TMDB、NeoDB、OMDb、豆瓣。");
    panel.append(clear, msg, credit);
    root.querySelector(".fab").addEventListener("click", () => (panel.hidden = !panel.hidden));
    document.documentElement.append(host);
    return panel;
  }

  let panel;
  const togglePanel = () => {
    panel ||= buildPanel();
    panel.hidden = !panel.hidden;
  };
  chrome.runtime.onMessage.addListener((m) => m?.type === "togglePanel" && togglePanel());

  const loadSettings = () => chrome.storage.sync.get(DEFAULTS).then((s) => (settings = { ...DEFAULTS, ...s }));
  loadSettings().then(() => { buildPanelOnce(); scan(); });
  function buildPanelOnce() { panel ||= buildPanel(); }

  chrome.storage.onChanged.addListener((_c, area) => {
    if (area !== "sync") return;
    loadSettings().then(() => {
      for (const v of views.values()) if (v.res && v.holder.isConnected) render(v);
      scan();
    });
  });

  let t;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(scan, 300); })
    .observe(document.body, { childList: true, subtree: true });
})();
