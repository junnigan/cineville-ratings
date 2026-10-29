#!/usr/bin/env bash
# Build the Firefox (AMO) zip. Same code as Chrome; only the manifest differs.
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
build="dist/firefox-build"
out="dist/cineville-ratings-firefox-${version}.zip"
rm -rf "$build" "$out"
mkdir -p "$build/icons"
cp background.js content.js content.css "$build/"
cp icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png "$build/icons/"
python3 - <<'PY'
import json
m = json.load(open("manifest.json"))
# Firefox has no MV3 service workers: use a background script (event page) instead
m["background"] = {"scripts": ["background.js"]}
m["browser_specific_settings"] = {
    "gecko": {
        "id": "cineville-ratings@junnigan.github.io",
        "strict_min_version": "140.0",
        # film title/year/directors/cast are read from the page and sent to the lookup services
        "data_collection_permissions": {"required": ["websiteContent"]},
    },
    "gecko_android": {"strict_min_version": "142.0"},
}
json.dump(m, open("dist/firefox-build/manifest.json", "w"), indent=2, ensure_ascii=False)
PY
(cd "$build" && zip -q -r "../$(basename "$out")" .)
echo "Built $out"
unzip -l "$out"
