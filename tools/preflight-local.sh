#!/usr/bin/env bash
# docs/ios-testflight.yml の preflight ガードをローカルで再現する（CIと同じ確認）
set -euo pipefail
cd "$(dirname "$0")/.."

test -f vendor/three.module.min.js
test "$(wc -c < vendor/three.module.min.js)" -gt 300000
if grep -rqE "unpkg\.com|cdn\.jsdelivr|three@[0-9]" src/ index.html; then
  echo "NG: CDN reference found"; exit 1
fi
echo "3d-vendor-ok"
grep -q "vendor/three.module.min.js" src/three/stadium.js
for token in InstancedMesh netWave confetti floodlights; do
  grep -q "$token" src/three/stadium.js
done
echo "3d-scene-ok"

python3 - <<'PY'
import pathlib, re
countries = pathlib.Path('src/core/countries.js').read_text()
codes = re.findall(r"code: '([A-Z]{2})'", countries)
assert len(codes) == 32, codes   # 無料16 + PRO16（ワールドカップ風）
assert len(set(codes)) == 32
print('countries:', ' '.join(codes))
PY

grep -q "pro: 'jp.signlink.Shootout4.pro'" src/config.js
grep -q "proPrice: '¥300'" src/config.js
grep -q "PRODUCT_ID" src/platform/iap.js
grep -q "zh-Hant" src/i18n.js
grep -q "Bahasa Indonesia" src/i18n.js
grep -q "CFBundleDevelopmentRegion" ios/App/App/Info.plist
grep -q "https://siivncidktbuyqwsjeqd.supabase.co" src/config.js
grep -q "shootout-quick" src/net/online.js
! grep -qi "<textarea" index.html
grep -q -- "-webkit-touch-callout" styles.css
grep -q "env(safe-area-inset-top" styles.css
grep -q "data-size=\"standard\"" index.html
echo "pro-i18n-ok"

python3 - <<'PY'
import pathlib, struct
for path in ['assets/icon-1024.png', 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png']:
    data = pathlib.Path(path).read_bytes()
    assert data[:4] == b'\x89PNG', path
    width, height = struct.unpack('>II', data[16:24])
    depth, color = data[24], data[25]
    assert (width, height) == (1024, 1024), (path, width, height)
    assert (depth, color) == (8, 2), (path, depth, color)
print('icons-ok')
PY

node tools/verify-ios-project.mjs > /dev/null
echo "ios-contract-ok"

node tools/make-www.mjs > /dev/null
test -f www/index.html
test -f www/src/main.js
test -f www/src/net/online.js
test -f www/vendor/three.module.min.js
test -f www/assets/icon-1024.png
# Build 8: 効果音ラボの MP3（6本・1MB 未満）が必ずバンドルに入る
for name in people-stadium-cheer1 air-horn1 trumpet1 mens-yeah1 people-shout-oo1 people-performance-uwaa1; do
  test -f "www/assets/sfx/${name}.mp3"
  test "$(wc -c < "www/assets/sfx/${name}.mp3")" -gt 10000
done
test "$(du -cb www/assets/sfx/*.mp3 | tail -1 | cut -f1)" -lt 512000
echo "www-ok"
echo "ALL PREFLIGHT GUARDS PASSED"
