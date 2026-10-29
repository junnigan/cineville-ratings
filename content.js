(() => {
  const done = new WeakSet();

  const send = (q) => chrome.runtime.sendMessage({ type: "lookup", ...q });

  function chip(cls, label, d) {
    const el = document.createElement(d?.url ? "a" : "span");
    el.className = `cvr-chip ${cls}`;
    if (d?.url) Object.assign(el, { href: d.url, target: "_blank", rel: "noopener" });
    el.textContent = `${label} ${d?.rating ? d.rating.toFixed(1) : "–"}`;
    if (d?.count) el.title = `${d.count} ratings`;
    return el;
  }

  function badge(res) {
    const b = document.createElement("div");
    b.className = "cvr-badge";
    if (!res || res.error || !res.found) {
      const s = document.createElement("span");
      s.className = "cvr-chip cvr-muted";
      s.textContent = "无评分";
      b.append(s);
      return b;
    }
    b.append(chip("cvr-douban", "豆瓣", res.douban || (res.doubanUrl && { url: res.doubanUrl })));
    b.append(chip("cvr-imdb", "IMDb", res.imdb));
    b.append(chip("cvr-neodb", "NeoDB", res.neodb));
    return b;
  }

  function comments(res) {
    const list = res?.douban?.comments;
    if (!list?.length) return null;
    const box = document.createElement("div");
    box.className = "cvr-comments";
    box.innerHTML = "<h4>豆瓣短评</h4>";
    for (const c of list) {
      const p = document.createElement("p");
      const u = document.createElement("b");
      u.textContent = c.user;
      p.append(u, c.text);
      box.append(p);
    }
    return box;
  }

  // 详情页:从内嵌的 __NEXT_DATA__ 读年份和导演
  function detailMeta() {
    try {
      const d = JSON.parse(document.getElementById("__NEXT_DATA__").textContent);
      const f = d.props.pageProps.film;
      return { title: f.title, year: f.releaseYear, director: f.directors?.[0] };
    } catch {
      return null;
    }
  }

  async function scan() {
    // 列表卡片
    for (const a of document.querySelectorAll('h3 a[href*="/films/"]')) {
      if (done.has(a)) continue;
      done.add(a);
      const holder = document.createElement("div");
      a.closest("h3").after(holder);
      send({ title: a.textContent.trim() }).then((r) => holder.replaceWith(badge(r)));
    }
    // 详情页
    if (/\/films\/[^/]+\/?$/.test(location.pathname)) {
      const h1 = document.querySelector("h1");
      if (h1 && !done.has(h1)) {
        done.add(h1);
        const meta = detailMeta() || { title: h1.textContent.trim() };
        const holder = document.createElement("div");
        h1.after(holder);
        const r = await send(meta);
        holder.replaceWith(badge(r));
        const c = comments(r);
        if (c) h1.closest("main, article, div")?.append(c);
      }
    }
  }

  let t;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(scan, 300); })
    .observe(document.body, { childList: true, subtree: true });
  scan();
})();
