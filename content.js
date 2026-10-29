(() => {
  const ext = typeof browser !== "undefined" ? browser : chrome; // Firefox 用 browser(保证返回 Promise),Chrome 用 chrome
  const browserLang = (navigator.language || "en").toLowerCase();
  const DEFAULTS = {
    showDouban: true, showImdb: true, showNeodb: true, showTmdb: true, showOnList: true, hideNotFound: false,
    translate: true, lang: detectTarget(), uiLang: "auto",
    showComments: true, commentDouban: true, commentNeodb: true, commentTmdb: true, commentCount: "8", autoTranslate: true,
    omdbKey: "", tmdbKey: "",
  };
  let settings = { ...DEFAULTS };

  // ---- 界面语言(自动检测浏览器语言,也可在设置里手动选) ----
  const STR = {
    zh: {
      douban: "豆瓣", blocked: "豆瓣拒绝了请求,请先在此浏览器登录豆瓣", nokey: "在设置里填写 OMDb key 才能显示 IMDb 评分",
      noRating: "暂无评分", failed: "加载失败", notFound: "未找到", synopsis: "简介", source: "来源:", comments: "短评",
      watched: "看过", helpful: "有用", likes: "赞", translateLink: "翻译", showOriginal: "显示原文",
      translateFirst: "翻译(首次需下载语言包)", expand: "展开", collapse: "收起",
      fabTitle: "Cineville Ratings 设置", hLang: "语言 / Language", uiLang: "界面语言", hRatings: "评分来源",
      tmdbNeedsKey: "TMDB(需要填写 key)", showOnList: "在列表页和横幅上也显示", hideNotFound: "找不到时不显示“未找到”",
      hTranslate: "翻译", translate: "显示官方译名,并用目标语言简介替换原简介", lang: "目标语言",
      hComments: "短评", showComments: "在详情页显示短评", commentDouban: "来自豆瓣", commentNeodb: "来自 NeoDB",
      commentTmdb: "来自 TMDB(英文为主)", autoTranslate: "豆瓣短评拿不到时,自动翻译外语短评(Chrome 内置翻译)",
      commentCount: "最多显示条数", hKeys: "API Key(免费申请,只保存在本浏览器)",
      tmdbKey: "TMDB(themoviedb.org):匹配、译名、简介、评论", omdbKey: "OMDb(omdbapi.com):IMDb 评分",
      getKey: "免费申请 Key ↗", saved: "已保存", clear: "清除缓存", cleared: "缓存已清除,刷新页面生效",
      credit: "This product uses the TMDB API but is not endorsed or certified by TMDB. 数据来源:TMDB、NeoDB、OMDb、豆瓣。",
    },
    en: {
      douban: "Douban", blocked: "Douban refused the request. Log in to Douban in this browser first.", nokey: "Add an OMDb key in settings to show IMDb ratings",
      noRating: "No rating yet", failed: "Failed to load", notFound: "Not found", synopsis: "Synopsis", source: "Source: ", comments: "Reviews",
      watched: "", helpful: "helpful", likes: "likes", translateLink: "Translate", showOriginal: "Show original",
      translateFirst: "Translate (downloads language pack first)", expand: "Show more", collapse: "Show less",
      fabTitle: "Cineville Ratings settings", hLang: "Language / 语言", uiLang: "Interface language", hRatings: "Rating sources",
      tmdbNeedsKey: "TMDB (needs a key)", showOnList: "Also show on film lists and banners", hideNotFound: "Hide “Not found” badges",
      hTranslate: "Translation", translate: "Show localized titles and replace the synopsis with the target language", lang: "Target language",
      hComments: "Reviews", showComments: "Show reviews on film pages", commentDouban: "From Douban", commentNeodb: "From NeoDB",
      commentTmdb: "From TMDB (mostly English)", autoTranslate: "Auto-translate foreign reviews when Douban reviews are unavailable (Chrome built-in)",
      commentCount: "Max reviews shown", hKeys: "API keys (free, stored only in this browser)",
      tmdbKey: "TMDB (themoviedb.org): matching, titles, synopses, reviews", omdbKey: "OMDb (omdbapi.com): IMDb ratings",
      getKey: "Get a free key ↗", saved: "Saved", clear: "Clear cache", cleared: "Cache cleared. Reload the page to apply.",
      credit: "This product uses the TMDB API but is not endorsed or certified by TMDB. Data from TMDB, NeoDB, OMDb and Douban.",
    },
  };
  const autoUi = (ext.i18n?.getUILanguage?.() || browserLang).toLowerCase().startsWith("zh") ? "zh" : "en";
  const uiLang = () => (settings.uiLang === "zh" || settings.uiLang === "en" ? settings.uiLang : autoUi);
  const t = (k) => STR[uiLang()][k];

  // 首次使用时,目标语言默认取浏览器语言
  function detectTarget() {
    if (/^zh-(tw|hk|mo|hant)/.test(browserLang)) return "zh-tw";
    const base = browserLang.split("-")[0];
    return ["zh", "en", "ja", "ko", "fr", "de", "es", "nl"].includes(base) ? (base === "zh" ? "zh-cn" : base) : "en";
  }
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
      ext.runtime.sendMessage(msg).then(resolve, () => resolve({ error: "x" })).finally(() => { active--; pump(); });
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
    const hint = d?.blocked ? t("blocked") : d?.error === "nokey" ? t("nokey") : d?.error || null;
    // 有提示的标签做成可点击(手机上没有悬停),点一下展开说明,说明里再给原链接
    const e = h(d?.url && !hint ? "a" : "span", `cvr-chip ${cls}`);
    if (d?.url && !hint) Object.assign(e, { href: d.url, target: "_blank", rel: "noopener" });
    e.append(h("i", null, label), h("b", null, d?.rating ? d.rating.toFixed(1) : "–"));
    if (d?.count) e.title = `${d.count.toLocaleString()} ratings`;
    else if (d?.url && !d.rating && !hint) e.title = t("noRating");
    if (hint) {
      e.title = hint;
      e.classList.add("cvr-tap");
      e.addEventListener("click", () => {
        const next = e.nextElementSibling;
        if (next?.classList.contains("cvr-hint")) return next.remove();
        const note = h("div", "cvr-hint", hint);
        if (d.url) {
          const a = h("a", null, " ↗");
          Object.assign(a, { href: d.url, target: "_blank", rel: "noopener" });
          note.append(a);
        }
        e.after(note);
      });
    }
    return e;
  }

  function badge(v) {
    const { res, title } = v;
    const b = h("div", "cvr-badge");
    if (!res || res.error || !res.found) {
      if (settings.hideNotFound && !res?.error) return null;
      b.append(h("span", "cvr-chip cvr-muted", res?.error ? t("failed") : t("notFound")));
      return b;
    }
    if (settings.translate) {
      const local = pick(res.titles, settings.lang);
      if (local && norm(local) !== norm(title)) b.append(h("div", "cvr-title", local));
    }
    if (settings.showDouban) b.append(chip("cvr-douban", t("douban"), res.douban));
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
    if (res.douban?.summary) cands.push({ lang: "zh", text: res.douban.summary, src: t("douban") });
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
    sec.append(h("h3", null, t("synopsis")));
    const cls = document.querySelector('p[class*="variant-body"]')?.className;
    for (const para of s.text.split(/\n+/).filter(Boolean)) sec.append(h("p", cls, para));
    sec.append(h("span", "cvr-src", `${t("source")}${s.src}`));
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
      let tr = translators.get(key);
      if (!tr) {
        const opts = { sourceLanguage: src, targetLanguage: target };
        const avail = await Translator.availability(opts);
        if (avail === "unavailable") return null;
        if (avail !== "available" && !userInitiated) return "click";
        tr = await Translator.create(opts);
        translators.set(key, tr);
      }
      return await tr.translate(text);
    } catch {
      return null;
    }
  }

  function commentRow(c, autoTranslate) {
    const row = h("div", "cvr-cmt");
    const head = h("div", "cvr-head");
    const u = h(c.url ? "a" : "span", null, c.user);
    // 评论链接来自第三方数据,只允许 http(s),避免 javascript: 之类的链接
    if (/^https?:\/\//i.test(c.url || "")) Object.assign(u, { href: c.url, target: "_blank", rel: "noopener" });
    head.append(u);
    if (t("watched")) head.append(t("watched"));
    if (c.stars) head.append(stars(Math.round(c.stars)));
    head.append(h("span", "cvr-from", { douban: t("douban"), neodb: "NeoDB", tmdb: "TMDB" }[c.src]));
    if (c.likes) head.append(h("span", "cvr-vote", `${c.likes} ${c.src === "douban" ? t("helpful") : t("likes")}`));
    const original = c.text;
    const body = h("p", null, original);
    row.append(head, body);
    // 长评先折叠成几行,点"展开"看全文
    if (original.length > 180) {
      body.classList.add("cvr-clamp");
      const more = h("a", "cvr-tr", t("expand"));
      more.addEventListener("click", () => {
        const open = body.classList.toggle("cvr-clamp");
        more.textContent = open ? t("expand") : t("collapse");
      });
      row.append(more);
    }

    // 外语短评:提供"翻译"链接;豆瓣短评不可用时自动翻译
    if (c.lang && c.lang !== targetCode().split("-")[0] && "Translator" in self) {
      const link = h("a", "cvr-tr", t("translateLink"));
      let translated = null, showing = false;
      const apply = async (userInitiated) => {
        if (showing) { body.textContent = original; link.textContent = t("translateLink"); showing = false; return; }
        translated ||= await translate(original, c.lang, userInitiated);
        if (translated && translated !== "click") {
          body.textContent = translated;
          link.textContent = t("showOriginal");
          showing = true;
        } else if (translated === "click") {
          link.textContent = t("translateFirst");
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
    sec.append(h("h3", null, t("comments")));
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
    // 标题元素已被站点换掉(站内跳转、轮播刷新)时,清掉它留下的评分标签和简介
    for (const [ref, v] of views) {
      if (ref.isConnected) continue;
      v.holder?.remove();
      v.extra?.remove();
      views.delete(ref);
    }
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
      // 站内跳转时 <main> 可能被复用,清掉上一部电影遗留的简介/短评
      document.querySelectorAll(".cvr-extra").forEach((e) => e.remove());
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
  const schema = () => [
    { head: t("hLang") },
    { k: "uiLang", l: t("uiLang"), opts: [["auto", "Auto / 自动"], ["zh", "中文"], ["en", "English"]] },
    { head: t("hRatings") },
    { k: "showDouban", l: t("douban") },
    { k: "showImdb", l: "IMDb" },
    { k: "showNeodb", l: "NeoDB" },
    { k: "showTmdb", l: t("tmdbNeedsKey") },
    { k: "showOnList", l: t("showOnList") },
    { k: "hideNotFound", l: t("hideNotFound") },
    { head: t("hTranslate") },
    { k: "translate", l: t("translate") },
    { k: "lang", l: t("lang"), opts: [["zh-cn", "简体中文"], ["zh-tw", "繁體中文"], ["en", "English"], ["ja", "日本語"], ["ko", "한국어"], ["fr", "Français"], ["de", "Deutsch"], ["es", "Español"], ["nl", "Nederlands"]] },
    { head: t("hComments") },
    { k: "showComments", l: t("showComments") },
    { k: "commentDouban", l: t("commentDouban") },
    { k: "commentNeodb", l: t("commentNeodb") },
    { k: "commentTmdb", l: t("commentTmdb") },
    { k: "autoTranslate", l: t("autoTranslate") },
    { k: "commentCount", l: t("commentCount"), opts: [["3", "3"], ["5", "5"], ["8", "8"], ["12", "12"]] },
    { head: t("hKeys") },
    { k: "tmdbKey", l: t("tmdbKey"), text: true, link: "https://www.themoviedb.org/settings/api" },
    { k: "omdbKey", l: t("omdbKey"), text: true, link: "https://www.omdbapi.com/apikey.aspx" },
  ];

  function buildPanel() {
    builtUi = uiLang();
    const host = h("div");
    host.id = "cvr-settings";
    const root = host.attachShadow({ mode: "open" });
    const style = h("style");
    style.textContent = `
      *{box-sizing:border-box}
      .fab{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));width:44px;height:44px;border:0;border-radius:50%;background:#101a3d;color:#fff;font-size:20px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3);z-index:2147483000}
      .panel{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:calc(max(16px,env(safe-area-inset-bottom)) + 52px);width:320px;max-width:calc(100vw - 24px);max-height:70vh;overflow:auto;padding:14px 16px;background:#fff;color:#1a1a1a;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.28);font:14px/1.5 var(--fonts-averta,system-ui,sans-serif);z-index:2147483000;text-align:left}
      .panel[hidden]{display:none}
      h4{margin:14px 0 4px;font-size:12px;color:#777;font-weight:600}h4:first-child{margin-top:0}
      label{display:flex;gap:8px;align-items:flex-start;margin:4px 0}
      .col{display:block}select,input[type=text]{width:100%;margin-top:3px;padding:4px;font:inherit}
      a.getkey{display:inline-block;margin-top:4px;padding:3px 10px;border:1px solid #101a3d;border-radius:999px;color:#101a3d;font-size:12px;text-decoration:none;align-self:flex-start}a.getkey:hover{background:#101a3d;color:#fff}
      button.clear{margin-top:12px;padding:4px 10px;font:inherit}
      input[type=checkbox]{width:18px;height:18px;flex:none;margin:2px 0 0}
      @media (max-width:600px){.panel{left:12px;right:12px;width:auto;max-height:75vh;max-height:75dvh;font-size:15px}select,input[type=text]{font-size:16px;padding:8px}label{margin:9px 0}button.clear,a.getkey{padding:8px 14px;font-size:14px}}
      .credit{display:block;margin-top:10px;color:#888;font-size:11px;line-height:1.4}.msg{color:#2e963d;font-size:12px;min-height:1em;margin-top:6px}
    `;
    const fab = Object.assign(h("button", "fab", "⚙"), { title: t("fabTitle") });
    const panel = h("div", "panel");
    panel.hidden = true;
    root.append(style, fab, panel);
    const msg = h("div", "msg");
    const flash = (text) => { msg.textContent = text; setTimeout(() => (msg.textContent = ""), 1500); };
    for (const f of schema()) {
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
          const a = h("a", "getkey", t("getKey"));
          Object.assign(a, { href: f.link, target: "_blank", rel: "noopener" });
          lab.append(a);
        }
      } else {
        input = Object.assign(h("input"), { type: "checkbox", checked: !!settings[f.k] });
        lab.append(input, h("span", null, f.l));
      }
      input.addEventListener("change", () => {
        const val = input.type === "checkbox" ? input.checked : input.value.trim();
        ext.storage.sync.set({ [f.k]: val });
        flash(t("saved"));
      });
      panel.append(lab);
    }
    const clear = h("button", "clear", t("clear"));
    clear.addEventListener("click", () => ext.runtime.sendMessage({ type: "clearCache" }).then(() => flash(t("cleared"))));
    const credit = h("small", "credit", t("credit"));
    panel.append(clear, msg, credit);
    fab.addEventListener("click", () => (panel.hidden = !panel.hidden));
    document.documentElement.append(host);
    return panel;
  }

  let panel, builtUi;
  const togglePanel = () => {
    panel ||= buildPanel();
    panel.hidden = !panel.hidden;
  };
  ext.runtime.onMessage.addListener((m) => m?.type === "togglePanel" && togglePanel());

  const loadSettings = () => ext.storage.sync.get(DEFAULTS).then((s) => (settings = { ...DEFAULTS, ...s }));
  loadSettings().then(() => { buildPanelOnce(); scan(); });
  function buildPanelOnce() { panel ||= buildPanel(); }

  ext.storage.onChanged.addListener((_c, area) => {
    if (area !== "sync") return;
    loadSettings().then(() => {
      if (panel && builtUi !== uiLang()) {
        const open = !panel.hidden;
        document.getElementById("cvr-settings")?.remove();
        panel = buildPanel();
        panel.hidden = !open;
      }
      for (const v of views.values()) if (v.res && v.holder.isConnected) render(v);
      scan();
    });
  });

  let timer;
  new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(scan, 300); })
    .observe(document.body, { childList: true, subtree: true });
})();
