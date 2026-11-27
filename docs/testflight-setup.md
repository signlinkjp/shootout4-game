# SHOOTOUT 4 — TestFlight 配布までの手順（トモアキさん向け）

このアプリは **Capacitor 8 + 素の HTML/CSS/JS** で、`ios/` に Xcode プロジェクトまで入っています。
ここに書いた順番で進めれば、GitHub Actions が **署名 → IPA → TestFlight** まで自動でやります。
所要時間の目安は、はじめてでも **40〜60分**（Apple 側の反映待ちを除く）。

> すでに JANKeN PoN / ICE WOLF / CODE DUEL / DOROKEI で使っている Secrets と
> App Store Connect の API キーは **そのまま流用できます**。新しく作るのは
> 「GitHub リポジトリ」「Bundle ID」「App Store Connect のアプリ」「PRO の商品」だけです。

---

## 0. 先に決まっていること（このリポジトリの値）

| 項目 | 値 |
| --- | --- |
| アプリ名（表示） | **SHOOTOUT 4** |
| Bundle ID | `jp.signlink.Shootout4` |
| PRO の商品 ID（非消費型・買い切り） | `jp.signlink.Shootout4.pro` |
| 価格 | ¥300（App Store Connect で設定） |
| 対応 | iPhone 縦持ちのみ / iOS 15 以上 |
| ビルド番号 | `ios/App/App.xcodeproj/project.pbxproj` の `CURRENT_PROJECT_VERSION`（いま **7**） |
| バージョン | `MARKETING_VERSION`（いま **1.0.0**） |

ビルド番号はワークフローに書いてありません。**pbxproj の数字を上げるだけ**で Build 6, 7…になります。

---

## 1. GitHub に新しいリポジトリを作る

1. Safari で https://github.com/new を開く
2. Repository name: `shootout4`（なんでもOK）
3. Public / Private はどちらでも可（Actions は無料枠あり。Private の場合も同じ手順）
4. **Create repository**

このフォルダ（`work/shootout4`）の中身を、そのリポジトリの直下に置きます。
（相方に「このリポジトリへ push して」と伝えれば、ここは任せられます）

置くべきもの（抜粋）:

```
index.html  styles.css  package.json  capacitor.config.ts  README.md
src/  vendor/  assets/  tools/  tests/  ios/  docs/
```

**入れなくてよいもの**: `node_modules/`、`www/`（配布用に毎回作る）、`ios/App/App/public/`（`cap sync` が作る）。

---

## 2. ワークフローを GitHub に貼る

GitHub の画面からしか追加できない（連携の権限のため）ので、ここだけ手作業です。

1. リポジトリ → **Add file → Create new file**
2. ファイル名: `.github/workflows/ios-testflight.yml`
3. `docs/ios-testflight.yml` の**中身を全部**コピーして貼る（1行目は `#` コメントのまま）
4. **Commit changes**

---

## 3. Secrets を登録する

リポジトリ → **Settings → Secrets and variables → Actions → New repository secret**

| Secret 名 | 中身 | 補足 |
| --- | --- | --- |
| `APPLE_TEAM_ID` | 例 `TGBNH8WJV6` | Apple Developer の Membership に表示 |
| `APPSTORE_CONNECT_KEY_ID` | 例 `ABCD123456` | App Store Connect → Users and Access → Integrations |
| `APPSTORE_CONNECT_ISSUER_ID` | UUID | 同上 |
| `APPSTORE_CONNECT_PRIVATE_KEY` | `AuthKey_XXXX.p8` の中身 | `-----BEGIN PRIVATE KEY-----` から最後まで丸ごと |

> 既存アプリと同じ値でOK。`ASC_API_KEY_ID` などの別名でも動くようにしてあります。

---

## 4. Apple 側の登録（2つ）

### 4-1. Bundle ID を作る

1. https://developer.apple.com/account → **Certificates, Identifiers & Profiles → Identifiers**
2. **＋** → App IDs → App
3. Description: `SHOOTOUT 4`
4. Bundle ID: **Explicit** で `jp.signlink.Shootout4`
5. Capabilities は追加なし（In-App Purchase は自動で有効）
6. **Continue → Register**

### 4-2. App Store Connect にアプリを作る

1. https://appstoreconnect.apple.com → **My Apps → ＋ → New App**
2. Platform: iOS
3. Name: **SHOOTOUT 4**（すでに使われていたら `SHOOTOUT 4 - PK DUEL` などに変更）
4. Primary Language: **Japanese**
5. Bundle ID: `jp.signlink.Shootout4`
6. SKU: `shootout4-001`（任意の一意な文字列）
7. User Access: Full Access

### 4-3. PRO（買い切り ¥300）の商品を作る

1. アプリのページ → **Monetization → In-App Purchases → ＋**
2. Type: **Non-Consumable**（非消費型）
3. Product ID: **`jp.signlink.Shootout4.pro`**（この文字列を変えない）
4. Reference Name: `IPKSF PRO Membership`
5. Price: **¥300**（Japan の Tier から選ぶ）
6. ローカライズ（日本語）
   - Display Name: `IPKSF 公式加盟（PRO）`
   - Description: `世界ランキング戦・フレンド対戦・全ユニフォーム＆スパイクが解放されます。選手能力や勝敗確率は変わりません。`
7. スクリーンショット（PRO の説明画面）を1枚添付
8. **Save** → ステータスが「提出準備完了」になることを確認

> ⚠️ 商品が「提出準備完了」になっていないと、アプリ側は購入画面で
> `SK: empty` を出します（PRO シートの下に小さく理由が出ます）。
> 課金の有料アプリ契約（Paid Applications Agreement）が有効かも確認してください。

---

## 5. ビルドを流す

1. GitHub → **Actions** → 「SHOOTOUT 4 iOS TestFlight」→ **Run workflow**
2. `confirm_bundle_id` に `jp.signlink.Shootout4` を入力
3. `upload_to_testflight` は **true**
4. **Run workflow**

流れ（所要 15〜25分）:

1. **preflight**（Ubuntu・約3分）
   - 単体テスト（47件）と実ブラウザE2E（34項目）
   - 7秒・4択・5本・サドンデスのルール検査
   - 3DがCDNではなく同梱のThree.jsで動くこと
   - 32か国・12言語・PRO商品ID・アイコン（1024 RGB）
   - iOS プロジェクトの契約チェック（`tools/verify-ios-project.mjs`）
2. **testflight**（macOS）
   - 署名 → `.xcarchive` → IPA → 検証 → TestFlight へアップロード
   - バイナリに商品IDと音のブリッジが入っていることを `strings` で確認

成功すると Actions の Artifacts に `shootout4-testflight-build1-evidence`（ログ・IPAのSHA256）が残ります。

---

## 6. TestFlight で試す

1. App Store Connect → アプリ → **TestFlight**
2. 「内部テスト」に自分（と奥様）を追加 → ビルドを選択
3. iPhone の TestFlight アプリからインストール

### 見てほしいところ（実機チェックリスト）

- [ ] **日本語で起動**（設定 → 言語 が「日本語」、`日本語` の文言）
- [ ] オープニングが3秒で、タップでスキップできる
- [ ] 国えらびで **自分の国** と **相手の国**、CPUの強さ（初級〜最強）
- [ ] 試合: **7秒**のカウントダウン、4択、**決定**で即シュート
- [ ] ゴールで **ネットが揺れ・紙吹雪・歓声**、セーブでキーパーのアップ
- [ ] PKボードの ○× が増える／6本目から **サドンデス**
- [ ] スコアボードの「先攻 / 後攻」「キッカー1〜5」
- [ ] ロッカーで **PRO キット（ROYAL STRIPE 等）** が着られる（購入後）
- [ ] **PRO 購入**（サンドボックス）と **購入を復元**
- [ ] 設定: 効果音 / BGM / バイブ / **文字サイズ 特大** / ナイター
- [ ] 12言語に切り替えて崩れない（特に 特大 + 中国語/タイ語）
- [ ] 通信対戦（クイックマッチ）で相手が見つかると試合が始まる
- [ ] 音が出る（マナーモードでも鳴る設定: `AVAudioSession .playback`）

---

## 7. つまずいたとき

| 症状 | 原因 | 直し方 |
| --- | --- | --- |
| preflight が `NG` で落ちる | ルールや文言の検査に引っかかった | ログの `NG` 行を見る（`tools/preflight-local.sh` を手元で実行すると同じ確認ができます） |
| `SK: empty` | 商品が「提出準備完了」でない / 有料アプリ契約が無効 | App Store Connect の In-App Purchases と Agreements を確認 |
| 署名で `No profiles` | Team ID 違い / Bundle ID 未登録 | Secret `APPLE_TEAM_ID` と Identifiers を確認 |
| アップロードで `Invalid image` | アイコンにアルファが残っている | `python3 tools/make-icons.py` で作り直す（RGB で出力します） |
| TestFlight に「輸出コンプライアンス」の確認 | 初回のみ | Info.plist で `ITSAppUsesNonExemptEncryption=false` 済み。質問には「いいえ」 |
| 音が出ない（実機） | WKWebView の自動再生制限 | 画面をタップしてから始めると鳴ります（OPの「音ありで開始」） |

---

## 8. 審査に出す前に

- **プライバシーポリシー**のURLが必要です。`docs/privacy.md` の本文をそのまま
  GitHub Pages か Notion の公開ページに置いて、その URL を登録してください。
- 年齢区分は **4+**（暴力・ギャンブル表現なし。PK戦はスポーツ競技）。
- スクリーンショットは `downloads/shootout4-prod-*.png` が使えます
  （6.7インチ 1290×2796 にリサイズして登録）。
- アプリ説明文の下書きは `docs/app-store.md` にあります。
- 「IPKSF」は架空の団体です。実在の連盟・大会とは無関係である旨を説明文に入れています。
