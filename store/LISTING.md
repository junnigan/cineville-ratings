# Store listing material

Privacy policy URL: https://github.com/junnigan/cineville-ratings/blob/main/PRIVACY.md

## Name
Cineville Ratings (unofficial)

## Short description (≤132 chars; this is the manifest `description`)
Shows TMDB / IMDb / NeoDB / Douban ratings, localized titles, synopses and short reviews on Cineville.

## Detailed description (EN)
Cineville Ratings adds the information you usually open another tab for, right on cineville.nl.

• Ratings from TMDB, IMDb, NeoDB and Douban on film lists, banners and film pages
• Localized titles, e.g. Léon → 这个杀手不太冷 (choose your target language)
• Synopsis filled in when Cineville has none, or replaced by your language
• Short reviews from Douban, NeoDB and TMDB in a clean list, with a built-in translate button for foreign-language reviews (Chrome's on-device translator)
• Settings live on the page itself (gear button, bottom right). The interface follows your browser language (English / 中文)

TMDB and OMDb features need a free API key that you create yourself; the settings panel has a button that takes you to the sign-up page. NeoDB works without any key. Douban data needs you to be logged in to Douban in the same browser.

Unofficial: not affiliated with Cineville, TMDB, IMDb, Douban or NeoDB. This product uses the TMDB API but is not endorsed or certified by TMDB.
Free and open source (MIT): https://github.com/junnigan/cineville-ratings

## 详细说明 (ZH)
Cineville Ratings 把你原本要另开标签页去查的信息,直接放到 cineville.nl 页面上。

• 在电影列表、横幅和详情页显示 TMDB、IMDb、NeoDB、豆瓣评分
• 官方译名,例如 Léon → 这个杀手不太冷(目标语言可选)
• Cineville 没有简介时自动补充,也可以替换成你的语言
• 豆瓣、NeoDB、TMDB 的短评混排展示,外语短评可用 Chrome 内置的本地翻译
• 设置就在页面右下角的齿轮按钮里,界面语言跟随浏览器(English / 中文)

TMDB 和 OMDb 功能需要你自己免费申请 API key,设置面板里有直达申请页的按钮。NeoDB 不需要 key。豆瓣数据需要你在同一个浏览器里登录豆瓣。

非官方项目,与 Cineville、TMDB、IMDb、豆瓣、NeoDB 无隶属关系。This product uses the TMDB API but is not endorsed or certified by TMDB.
免费开源(MIT):https://github.com/junnigan/cineville-ratings

## Category
Entertainment (or "Fun")

## Single purpose
Show film ratings, localized titles, synopses and short reviews on cineville.nl film pages.

## Permission justifications (paste into the developer dashboard)
- **storage**: saves the user's settings (shown sources, language, optional API keys) and caches lookup results locally for up to 7 days.
- **Host permission cineville.nl**: the content script reads the film title/year/directors on Cineville pages and inserts ratings, synopsis and reviews into the page. The background worker also reads Cineville film pages in the page's language to get the official synopsis.
- **api.themoviedb.org, neodb.social, www.omdbapi.com**: official APIs queried for ratings, localized titles, synopses and reviews.
- **movie.douban.com, www.imdb.com**: the extension reads the public film page of the matched film to get the rating, synopsis and short reviews. Douban uses the user's existing login session; the extension never handles credentials.
- No remote code is loaded. All JavaScript is bundled in the package.

## Data usage disclosure (Chrome "Privacy practices" tab)
- Collects user data: **No** developer-side collection. If the form insists on declaring data handled, select only "Website content" (film title/year/directors/cast are read from the page and sent to the lookup services listed above to provide the feature).
- Check all three certifications: not sold to third parties, not used for unrelated purposes, not used for creditworthiness/lending.

## Screenshots (1280×800 or 640×400, 1–5 images; you need to take these)
1. Film list with rating badges
2. Film page: badges + translated title
3. Reviews section (Douban-style list)
4. Settings panel (⚙), in English and in Chinese
5. A film with no Cineville synopsis that has been filled in

---

# Firefox (addons.mozilla.org)

- Build: `./scripts/package-firefox.sh` → `dist/cineville-ratings-firefox-<version>.zip`. Only the manifest differs from the Chrome build (background `scripts` instead of a service worker, plus `browser_specific_settings`).
- Add-on ID: `cineville-ratings@junnigan.github.io` (keep it stable across releases)
- Minimum versions: Firefox 140 desktop, 142 Android (needed for the data collection declaration)
- Data collection declaration: `websiteContent` (film title/year/directors/cast are read from the page and sent to the lookup services listed in PRIVACY.md). Nothing is sent to the developer.
- Source code: the package is not minified or bundled, so the uploaded zip is the source. Select "No" when asked for separate source code.
- Listing text, summary, categories (Entertainment) and permission justifications: reuse the Chrome text above. Add Firefox-specific note: "No built-in translator in Firefox, so the review translate link is hidden there."
- Reviewer notes: "Douban requests rely on the user's own logged-in session; the extension never reads credentials. TMDB/OMDb keys are entered by the user and stored in browser.storage.sync."
