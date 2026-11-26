# SHOOTOUT 4 — プライバシーポリシー / Privacy Policy

最終更新: 2026年11月26日 · Last updated: 26 November 2026

## 日本語

**SHOOTOUT 4**（以下「本アプリ」）は、IPKSF（架空の国際PK戦連盟）の世界大会を題材にした
PK対決ゲームです。本アプリにおける情報の扱いは次のとおりです。

### 1. 端末内に保存する情報
- ニックネーム（任意・未入力なら「PLAYER」）
- 選んだ国、CPUの強さ、文字サイズ、言語、音・BGM・バイブ・昼夜の設定
- 戦績（試合数・勝敗・ゴール数・セーブ数・連勝・サドンデス数）
- ロッカーで選んだユニフォームとスパイク
- PRO（IPKSF 公式加盟）の購入状態の控え

これらは**お使いの端末内（アプリの localStorage）にのみ**保存され、当方のサーバーには送信しません。
アプリを削除すると消えます（設定 → データをリセット でも消せます）。

### 2. 通信対戦で相手に送る情報
通信対戦（クイックマッチ・フレンド対戦）では、対戦の成立と進行のために次の情報だけを
同じチャンネルにいる相手へ送ります。

- ニックネーム（12文字まで）
- 国コード（例: JP）
- PRO かどうか
- 各キックで選んだ方向（左上・右上・左下・右下）とラウンド番号
- 定型スタンプ（6種類のうち1つ。自由入力のチャットはありません）

送信先は Supabase Realtime の公開チャンネル（`games-realtime`）です。
データベースへの保存は行わず、対戦が終わると端末側からも破棄します。
世界ランキングは、ニックネーム・国・ポイント・勝敗数をチャンネル上で配り合い、
端末に最大10分間キャッシュします。

### 3. 取得しない情報
氏名・メールアドレス・電話番号・位置情報・連絡先・写真・広告ID・解析SDKのデータは
**一切取得しません**。広告も解析ツールも入っていません。

### 4. 課金
PRO（IPKSF 公式加盟・買い切り ¥300・非消費型）の購入は Apple の App Store を通じて処理されます。
クレジットカード情報が本アプリに渡ることはありません。購入状態の確認には StoreKit 2 を使用し、
Apple が返した「購入済みかどうか」だけを端末に控えます。

### 5. 子ども
本アプリは13歳未満の子どもから個人情報を集めることを意図していません。

### 6. 変更
本方針を変更する場合は、このページを更新し、アプリの更新情報に記載します。

### 7. お問い合わせ
- 提供者: Sign Link（個人開発）
- 連絡先: アプリの App Store ページに記載のサポート窓口

---

## English

**SHOOTOUT 4** ("the app") is a penalty-shootout game set in the fictional IPKSF World Championship.
This policy explains what the app does with information.

### 1. Stored on your device only
Nickname (optional), chosen nation, CPU level, text size, language, sound/music/vibration
and day/night settings, your match record, your selected kit and boots, and a cache of your
PRO membership state. Everything is kept in the app's local storage and is never sent to our
servers. Deleting the app (or Settings → Reset data) removes it.

### 2. Sent to your opponent in online matches
Nickname (max 12 characters), country code, PRO status, the corner you choose for each kick,
the round number, and one of six fixed stamps. There is no free-text chat. Messages travel over
public Supabase Realtime channels; nothing is written to a database, and the data is discarded
when the match ends. Ranking rows (nickname, country, points, wins, losses) are exchanged the
same way and cached on the device for up to 10 minutes.

### 3. Never collected
Name, email, phone number, location, contacts, photos, advertising identifiers, or analytics
data. The app contains no ads and no analytics SDK.

### 4. Purchases
The PRO membership (one-time ¥300, non-consumable) is processed by Apple's App Store.
Card details never reach the app. StoreKit 2 is used only to ask Apple whether the product is owned.

### 5. Children
The app is not intended to collect personal information from children under 13.

### 6. Contact
Provider: Sign Link. Support contact: as listed on the App Store product page.
