const DEFAULTS = {
  showDouban: true, showImdb: true, showNeodb: true, showOnList: true, hideNotFound: false,
  translate: true, lang: "zh-cn",
  showComments: true, commentDouban: true, commentNeodb: true, commentCount: "5",
  omdbKey: "",
};
const el = (id) => document.getElementById(id);
const flash = (t) => { el("saved").textContent = t; setTimeout(() => (el("saved").textContent = ""), 1200); };

chrome.storage.sync.get(DEFAULTS).then((s) => {
  for (const id in DEFAULTS) {
    if (typeof DEFAULTS[id] === "boolean") el(id).checked = s[id];
    else el(id).value = s[id];
  }
});

for (const id in DEFAULTS) {
  el(id).addEventListener("change", async () => {
    const v = typeof DEFAULTS[id] === "boolean" ? el(id).checked : el(id).value.trim();
    await chrome.storage.sync.set({ [id]: v });
    flash("已保存");
  });
}

el("clear").addEventListener("click", async () => {
  const all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all));
  flash("缓存已清除,刷新 Cineville 页面生效");
});
