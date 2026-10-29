const DEFAULTS = { translate: true, lang: "zh-cn", showComments: true, omdbKey: "" };
const ids = Object.keys(DEFAULTS);
const el = (id) => document.getElementById(id);

chrome.storage.sync.get(DEFAULTS).then((s) => {
  for (const id of ids) {
    if (typeof DEFAULTS[id] === "boolean") el(id).checked = s[id];
    else el(id).value = s[id];
  }
});

for (const id of ids) {
  el(id).addEventListener("change", async () => {
    const v = typeof DEFAULTS[id] === "boolean" ? el(id).checked : el(id).value.trim();
    await chrome.storage.sync.set({ [id]: v });
    el("saved").textContent = "已保存";
    setTimeout(() => (el("saved").textContent = ""), 1200);
  });
}
