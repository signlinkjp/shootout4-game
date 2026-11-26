# SHOOTOUT 4 — IPKSF World Penalty Championship

iPhone 縦持ちのPK対決ゲーム（v1.0.0 / Build 3）。
`クイック対戦`・`CPU対戦`・`フレンド対戦`・`世界ランキング`・`ロッカー（キャラクター＋4部位）`・
`IPKSF 公式加盟（PRO・買い切り ¥300）` を、Capacitor 8 + 素の HTML/CSS/JS（ES Modules）で実装しています。

```
7秒で決める、4択の心理戦。
ゴールの4コース（左上・右上・左下・右下）を、蹴る側と止める側が同時に選ぶ。
同じ方向ならセーブ、違えばゴール。5本ずつ＋サドンデス。
```

## すぐ動かす

```bash
node tools/serve.mjs        # → http://127.0.0.1:4173
# または
python3 -m http.server 4173
```

`index.html` を直接開く（file://）と、ES Modules の制約で動きません。必ず http 経由で。

## テスト

```bash
npm test                                  # 単体テスト 80件（node --test）
node tools/verify-ios-project.mjs         # iOS プロジェクトの契約チェック 44項目
bash tools/preflight-local.sh             # CI の preflight と同じガード
node tools/shots-prod.mjs                 # 実ブラウザ E2E 69項目＋スクリーンショット
```

E2E は Chromium（Playwright）で、実際の画面を操作して次を確認します。

| 区分 | 内容 |
| --- | --- |
| A | 日本語端末で日本語起動・オープニング（3秒・スキップ） |
| B | 3Dスタジアムの描画（WebGL・観客3,000人以上・キッカー5人） |
| C | 7秒カウントダウン・4択・決定で即結果・時間切れの自動選択 |
| D | PK進行（5本ずつ → 0-0 → サドンデス → 6本目で決着）、PKボードの○×、戦績保存 |
| E | ロッカー（PRO解錠 → キット＆スパイク保存 → 3Dに反映）、ゴール演出 |
| F | ナイター、文字サイズ特大、12言語、幅320/360/393pxで破綻なし |
| H | 通信ロビー（クイック/フレンド/国内・世界）、未設定時のエラー表示、ランキング画面 |
| G | コンソールエラー 0 |

スクリーンショットは `downloads/shootout4-prod-*.png` に保存されます。

## 構成

```
index.html            画面の器（#app に描画）
styles.css            全UI（セーフエリア・文字サイズ 標準/大/特大）
src/
  config.js           名前・Bundle ID・IAP ID・Supabase・ラウンド秒数（7）
  main.js             画面遷移・試合進行・通信・課金の取りまとめ
  i18n.js             12言語の切替と端末言語の判定（英語フォールバック）
  locales.js          日本語 / English / 中文 / 한국어
  locales-extra.js    Español / Português / Français / Deutsch / Italiano / ไทย / Indonesia
  audio.js            Web Audio で合成（歓声・ホイッスル・キック・ネット・BGM・国別チャント）
  storage.js          設定・戦績・PROの控え（localStorage、使えなければメモリ）
  core/
    rules.js          PKの進行（純粋関数・乱数なし）・早期決着・スコアボード
    cpu.js            CPUの心理戦AI（4段階。能力は変えず「読み」だけ変える）
    skins.js          4部位（ユニフォーム16・パンツ10・靴下10・スパイク12）と2種キャラ（能力値は持たない）
    countries.js      32か国（無料16 + PRO16・国旗・国名・歓声の性格・チームカラー）
    registration.js   IPKSF 公式選手登録（代表国・名前・利き足・チームメイト2〜5番）
  net/
    realtime.js       Supabase Realtime の最小クライアント（再接続つき）
    online.js         クイック/フレンド対戦・スタンプ・ランキング
  platform/iap.js     StoreKit 2 ブリッジ（PRO・復元・プレビューのテスト解錠）
  three/
    characters.js     2種のキャラクター（3️⃣ブロック / 1️⃣スタイリッシュ）と利き足の蹴りモーション
    stadium.js        3Dスタジアム・4部位の見た目・ゴールネット・カメラワーク・紙吹雪
    textures.js       芝・ネット・ユニフォーム柄・ボール・広告を canvas で生成
  ui/                 画面ごとの markup（home/country/match/locker/register/pro/online/misc/layout）
vendor/three.module.min.js   Three.js r160（CDNではなく同梱・完全オフライン）
assets/               アイコン全サイズ・エンブレム・国旗・スプラッシュ
ios/                  Capacitor 8 iOS プロジェクト（StoreKit 2 / 音のブリッジ）
tools/                serve / make-www / make-icons / verify-ios-project / preflight / E2E
tests/                単体テスト
docs/                 TestFlight 手順書・ワークフロー・プライバシー・App Store 下書き
```

## ゲームルール（実装の正）

- 4方向（TL/TR/BL/BR）。蹴る側＝狙い、止める側＝飛ぶ方向。**同じならセーブ**。
- **7秒**＋決定ボタン。押した瞬間に両者の手がそろっていれば即結果。
- **時間切れ**は自動選択ではなく**枠外へ蹴る（MISS KICK）**。キーパーが時間切れなら動けず失点。
- キッカー↔キーパーの交代時に**1.3秒の説明付きワンクッション**。キーパーは3D上を左右ドラッグで揺さぶれる。
- キーパー視点は**ゴール全体・相手キッカー・ボールが見える引いた斜め後ろ**（キッカー視点と別カメラ）。
- 5本ずつ。同点なら6本目からサドンデス（両者が同数を蹴って差がつけば決着）。
- **早期決着**: 残りの本数で追いつけなくなった時点で試合終了（例 3-0）。
- CPUはラウンド開始時に方向を確定（後出ししない）。材料は終わった本の履歴だけ。
- 課金・キット・4部位・キャラクターで能力や勝率は変わらない（`src/core/skins.js` に強さの値を持たせない）。
- PRO は **4部位の全種＋2種キャラ（切替可）＋32か国＋世界戦/フレンド戦**。CPU戦・フリー対戦は登録なしで0秒。

## 3D について

- Three.js r160 を `vendor/` に同梱（CDN・外部アセットなし）。
- スタジアム: 傾斜した3段の観客席・観客3,000人以上（InstancedMesh）・広告ボード・
  フラッドライト4基・デイ/ナイター（星・光の滲み）。
- ゴール: ポスト・クロスバー・3面ネット。被弾点でネットが揺れ、紙吹雪と衝撃波が出ます。
- カメラ: 蹴る側は背後から、守る側はゴール際から。ゴール/セーブで寄りと揺れ。
- WebGL が無い環境では 2D の簡易ピッチに自動で切り替えます（ゲームは止まりません）。

## 通信

- Supabase Realtime の **broadcast / presence のみ**（テーブル・認証・Edge Function なし）。
- クイック: `shootout-quick:{国|world}:{domestic|world}`、フレンド: `shootout-room:{code}`、
  対戦: `shootout-match:{id1-id2}`、ランキング: `shootout-rank:{scope}`。
- 1本ごとに自分の方向を送り、両者そろった瞬間に両端末で同じ判定。
- 7秒＋猶予で片方が来ないときはホストが欠けた分を決めて配ります（結果がずれない）。
- 自由入力チャットはありません（定型スタンプ6種・4秒あき）。受信は必ず検証します。

## 課金（PRO）

- 商品ID: `jp.signlink.Shootout4.pro`（非消費型・¥300）。
- `src/platform/iap.js` が StoreKit 2 の `getProducts / entitlement / purchase / restore` を呼びます。
- ネイティブでは `ios/App/App/AppDelegate.swift` の `StoreKitPlugin` を **明示登録**（NSClassFromString に頼らない）。
- Web プレビューではテスト解錠（請求なし）。失敗は `SK: …` の短い理由を残します。

## iOS

```bash
node tools/make-www.mjs     # 配布用 www/
npx cap sync ios            # www → ios/App/App/public
```

- Bundle ID `jp.signlink.Shootout4` / `CFBundleDevelopmentRegion = ja` / 縦持ちのみ。
- アイコンは `assets/icon-1024.png`（1024・RGB・アルファなし）と全サイズ（`assets/icons/`）。
- TestFlight の手順は **`docs/testflight-setup.md`**、貼り付けるワークフローは **`docs/ios-testflight.yml`**。

## 既知の制約

- 実機（iPhone）での最終確認は未実施です。E2E はヘッドレス Chromium（SwiftShader の WebGL2）で確認しています。
- 3Dはプリミズムを組み合わせたオリジナルモデルで、写真のようなリアルさではありません。
- 通信は Supabase の公開キーを使うため、同じチャンネル名を知っていれば誰でも入室できます
  （対戦結果は端末側の判定・自由入力なし・個人情報はニックネームと国だけ）。
- 翻訳は母語話者のレビューを受けていません（英語フォールバックあり）。
- 「IPKSF」は架空の団体です。実在の連盟・大会とは関係ありません。

## バージョン

- v1.0.0 / Build 3（2026-11-27）
  - ホーム上部のエンブレム枠が文字「特大」で押し潰されて見切れる問題を修正（ヒーロー枠を縮めない）
  - バックグラウンド移行で BGM・歓声・AudioContext を停止（iOS は `applicationWillResignActive` で Audio Session を解放）。戻ると再開、ラウンドの時計も止まる
  - プレイ中画面の右上にスピーカー ON/OFF と設定（試合を中断しない簡易設定）を追加
  - 結果画面の凡例を `⚽ シュート vs 🧤 セーブ` に寄せて表示
  - ロッカーに先攻/後攻（攻撃順）を追加。PK表は上段=先攻・下段=後攻、左=あなた・右=相手で固定
  - 戦績を「CPU戦績（リセット可）」と「PRO 通信対戦 通算（リセット対象外）」の2枠に分離
  - キーパーのダイビングを選んだコース側へ頭と手から飛ぶよう修正（画面の左右反転・倒れる向き・カメラの揺れ・動けないときは飛ばない）
  - 国えらぶの各横列に「← 横にスクロール →」の案内（12言語）
  - ロッカー上部を3Dキャラクタープレビュー（斜め正面アップ）に。キャラ名バッジと切り替え時の回転ジャンプ
- v1.0.0 / Build 2（2026-11-26）
  - アイコンを IPKSF 公式エンブレム（`downloads/shootout4-icon-2-flatball.png`）へ統一（iOS AppIcon 含む）
  - キャラクター2種（無料=3️⃣ブロック / PRO=1️⃣スタイリッシュ・いつでも切替）と利き足の自然な蹴り
  - 4部位着せ替え（ユニフォーム/パンツ/靴下/スパイク・無料はホーム/アウェイの2セット）
  - 32か国（無料16 + PRO16）・IPKSF 公式選手登録（代表国・名前・利き足・チームメイト）
  - ターン表示の大型化・交代ワンクッション・キーパー視点/左右ドラッグ（通信は100msスロットル）
  - 時間切れ=MISS KICK（枠外）・結果表記 ⚽ vs 🧤・国えらび下部の見切れ修正・音の底上げと「音をテスト」
- v1.0.0 / Build 1（2026-11-26）
