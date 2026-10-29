# Cineville Ratings

**English** · [中文](README.zh-CN.md)

A Chrome extension (Manifest V3) that adds ratings, localized titles, synopses and short reviews to [cineville.nl](https://cineville.nl).

## Features

- **Ratings** from TMDB, IMDb, NeoDB and Douban, on film lists, banners and detail pages
- **Localized titles**: e.g. *Léon* → *这个杀手不太冷* (pick any target language)
- **Synopsis**: filled in when Cineville has none; with translation on, replaced by the target-language synopsis
- **Short reviews** on detail pages, mixed from Douban, NeoDB and TMDB, in a Douban-like layout (long reviews fold, with "Show more")
- **Review translation**: foreign-language reviews can be translated with Chrome's built-in on-device Translator (automatic when Douban reviews are unavailable)
- **In-page settings**: click the ⚙ button at the bottom right of any Cineville page (or the toolbar icon). The interface language follows your browser and can be changed there

## Install

1. `git clone https://github.com/junnigan/cineville-ratings.git`
2. Open `chrome://extensions` and turn on **Developer mode**
3. Click **Load unpacked** and select the cloned folder

### Firefox (desktop and Android)

Run `./scripts/package-firefox.sh`, then in Firefox open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on** and pick `dist/firefox-build/manifest.json`. (A signed release will be published on addons.mozilla.org.) After installing, make sure the extension is allowed to access the sites it lists. On Firefox for Android, install it from the add-ons menu once it is published.
Firefox has no built-in translator, so the review "Translate" link is not shown there.

Review translation needs Chrome 138 or newer. The first translation for a language pair downloads a small language pack.

## Data sources and API keys

| Source | Used for | Key needed |
|---|---|---|
| [TMDB](https://www.themoviedb.org/settings/api) | Matching, localized titles and synopses, rating, reviews | Yes (free) |
| [NeoDB](https://neodb.social) | Rating, short reviews, Chinese titles | No |
| [OMDb](https://www.omdbapi.com/apikey.aspx) | IMDb rating | Yes (free, 1,000 requests/day) |
| Douban | Rating, synopsis, short reviews | No, but needs you to be logged in to Douban in the same browser |

Open the ⚙ panel on a Cineville page and use the **Get a free key** buttons to sign up. Keys are stored only in your browser (`chrome.storage.sync`) and are never part of this repository. Without keys the extension still works with NeoDB.

Douban has no public API. The extension only reads pages with your own logged-in session; when it is blocked the Douban badge shows "–". It may stop working at any time.

IMDb blocks direct page scraping, so IMDb ratings require an OMDb key. OMDb does not provide reviews.

## Privacy

When you open a film page, its title, year, directors and cast are sent to TMDB, NeoDB, OMDb (and Douban/IMDb) to look up ratings. Results are cached locally in your browser. Nothing is sent to any other server and no usage data is collected. Review translation runs on-device in Chrome.

## Non-commercial use

This project is free and open source. TMDB's API terms do not allow commercial use without a separate agreement, so please do not add paid tiers, ads or affiliate links, and do not share a single API key between users.

## Privacy policy

See [PRIVACY.md](PRIVACY.md).

## Attribution

This product uses the TMDB API but is not endorsed or certified by TMDB.
Ratings and reviews belong to their respective platforms and authors. This project is not affiliated with Cineville, TMDB, IMDb, Douban or NeoDB.

## License

[MIT](LICENSE)
