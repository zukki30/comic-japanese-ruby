# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## リポジトリの現状

拡張機能本体は未実装です。現状あるのは以下の2つで、どちらも Phase 1（認識精度の検証）のためのものです。

| 場所 | 役割 |
|---|---|
| `kindle-capture-test/` | 画面キャプチャの可否を確認した検証用拡張（MV3）。**検証済み・成功** |
| `tools/page-extract/` | 画像からセリフ・読み順・訳文を抽出し、正解データと比較して精度を評価する CLI |

作業を始める前に `docs/DEV_NOTES.md` を読むこと。これが唯一の仕様・計画ドキュメントであり、採用方式と未決事項の両方が記録されています。

**拡張機能本体を書き始めるときは、そのビルド・テスト・リンターのコマンドをこのファイルに追記すること。**

## コマンド

`tools/page-extract/` で実行します。Node 23.6 以上が必要（TypeScript をビルドなしで直接実行するため）。画像の縮小に macOS の `sips` を使います。

```bash
cd tools/page-extract
npm install

npm run typecheck                 # tsc --noEmit
npm run selftest                  # 評価ロジックの自己テスト（API キー不要）
npm run extract -- --image captures/page-001.png --index 1
npm run evaluate -- --truth fixtures/ground-truth.json --pred out
```

- `npm run extract` は `ANTHROPIC_API_KEY`（または `ant auth login` 済みのプロファイル）が必要
- `npm run evaluate` は完了条件を満たせば終了コード 0、満たさなければ 1 を返す
- 自己テストは API を呼ばないので、評価ロジックを触ったら必ず走らせること。**この指標が Phase 1 の go / no-go を決めるため、静かに壊れると判断そのものが狂う**
- 単一テストの実行手段はまだ用意していません（`src/selftest.ts` は一括実行のみ）

オプションの詳細は `tools/page-extract/README.md` を参照。

## プロダクトの目的

Kindle for Web（Kindle Cloud Reader）で表示中の英語コミックに対し、**漫画の外側の対訳パネルへ原文と日本語訳を並べて表示**する Chrome 拡張機能（Manifest V3）。英語学習用途が主目的なので、原文を消す・置き換える実装にはしない。

- 対訳パネルに「番号・原文・訳文」を読み順どおりに並べ、吹き出し付近には番号マーカーのみ重ねる
- **吹き出し内に直接描画する方式は検討済みで見送り**（将来の追加表示モード）。理由は `docs/DEV_NOTES.md` の 2.3 に記録済み — ピクセル精度の座標と吹き出し形状検出が必要になり、要求精度がほぼ 100% になるため
- 漫画の画像そのものには一切手を加えない（塗りつぶし・インペイントをしない）
- 翻訳は単語単位の直訳ではなく、前後の文脈・キャラクターの口調を踏まえた自然な日本語にする。固有名詞の訳は作品ごとの用語集（IndexedDB）で統一する

## 想定アーキテクチャ（パイプライン）

1 本の画像処理パイプラインが設計の中心です。各段の出力が次段の入力になるため、段ごとの責務を崩さないこと。

```
画面キャプチャ (chrome.tabs.captureVisibleTab)
  → Vision 対応 LLM に画像 + 用語集を送信
  → セリフ・読み順・訳文・概算座標を JSON で取得（1 リクエストに集約）
  → IndexedDB へキャッシュ・用語集を更新
  → 対訳パネルへ表示 + 吹き出し付近に番号マーカー
```

**パイプラインの出力形式は表示方法に依存させないこと。** `docs/DEV_NOTES.md` の 4.1 にスキーマがあります。`bbox` はパネル方式では番号マーカーの配置にしか使わないが、将来の吹き出し内表示モードのために必ず取得しておく。

技術候補（**いずれも最終決定ではない。Phase 1 の結果で確定**）: TypeScript / React（UI）/ Vision 対応 LLM（セリフ認識 + 翻訳を 1 回で）/ 構造化出力 `output_config.format` の json_schema（出力形式の固定）/ HTML オーバーレイ（表示）/ IndexedDB（キャッシュ・用語集）。
Tesseract.js は第一候補から外しています（理由は `docs/DEV_NOTES.md` の 3.1 — MV3 で offscreen document とローカルバンドルが必要になるうえ、アメコミのレタリングに弱い）。
これらを確定・変更したときは `docs/DEV_NOTES.md` の「技術構成」表も更新すること。

## 開発フェーズと現在地

`docs/DEV_NOTES.md` のフェーズ順を守ること。先のフェーズを先取りして実装しない。

- 完了：Manifest V3 の検証用拡張機能（`kindle-capture-test/`）で Kindle for Web の画面を PNG 取得できることを確認済み。
- 完了：Phase 1 の検証 CLI（`tools/page-extract/`）を実装済み。抽出・評価・自己テストが動く。
- **次（Phase 1 の残り）：実データでの精度検証** — 10 ページ分のキャプチャを集め、正解データを手で書き起こし、実 API で抽出して数値評価する。ここはユーザーの作業が必要（コミック画像と API キー）。この段階では画面への表示は実装しない。
- 以降：Phase 2 対訳パネル表示（ここで「実際に読める」状態になる）→ Phase 3 番号マーカー（Phase 2 で不便だと判断した場合のみ）→ Phase 4 自動化（ページ送り検出・キャッシュ・用語集・Batch API）。

未検証のまま残っている前提（実装時に確認が必要）:

- アメコミ特有のフォント・全大文字・斜体・効果音・背景と重なる文字に対する認識精度 — **これが唯一の本質的リスク。Phase 1 でここを通せば全体の実現性がほぼ確定する**
- Kindle 表示領域の DOM 構造（コミック画像が canvas / img / iframe のどれか、ページ送りで DOM が作り直されるか）→ Phase 2 で調査
- ページ送りの検出方式
- 1 ページあたりの実トークン数とコスト

## 実装上の制約

- **DRM の解除やコンテンツ保護の回避は行わない。** 通常の表示・取得が許される範囲に留める。すべての作品・端末で画面キャプチャが成功する前提で設計しない。
- 翻訳済み画像などの再配布機能は作らない。個人の読書・学習用途のみを想定する。
- **API 呼び出しは必ず service worker から行う。** content script から呼ぶと API キーがページコンテキストに露出し、Kindle のページ側 JS から読める。キーは `chrome.storage.local` に保存する（`storage.sync` は端末間に秘密情報が伝播するため使わない）。
- 構造化出力の JSON Schema は `minimum` / `maximum` / `minLength` 等をサポートしないため、`bbox` の値域チェックはクライアント側で実装する。
