#!/usr/bin/env bash
set -euo pipefail

root_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root_dir"

swift build -c release

app_dir="$root_dir/build/TabStatusBar.app"
mkdir -p "$app_dir/Contents/MacOS"
mkdir -p "$app_dir/Contents/Resources"

cp "$root_dir/.build/release/tab-status-bar" "$app_dir/Contents/MacOS/tab-status-bar"
cp "$root_dir/Resources/Info.plist" "$app_dir/Contents/Info.plist"

echo "Built $app_dir"
