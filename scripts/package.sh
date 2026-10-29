#!/usr/bin/env bash
# Build the store upload zip: only the files the extension needs.
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
out="dist/cineville-ratings-${version}.zip"
mkdir -p dist
rm -f "$out"
zip -q -r "$out" manifest.json background.js content.js content.css icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png
echo "Built $out"
unzip -l "$out"
