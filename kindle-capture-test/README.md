# kindle-capture-test

Kindle for Web の表示ページを PNG として取得できるか確認するための検証用拡張機能（Manifest V3）。

**検証結果：成功**（漫画の画像と英語のセリフが判読可能な状態で取得できることを確認済み）

Phase 1 では、この拡張で保存した PNG を `tools/page-extract` に渡して認識精度を評価する。

## 使い方

1. Chrome で `chrome://extensions` を開く
2. デベロッパーモードを有効化する
3. 「パッケージ化されていない拡張機能を読み込む」でこのディレクトリを選択する
4. Kindle for Web で英語コミックを開く
5. 拡張機能のアイコンをクリックする
6. PNG ファイルを保存する

## 制約

- `activeTab` 権限のため、アイコンをクリックしたタブしかキャプチャできない
- キャプチャ画像は devicePixelRatio とブラウザ表示倍率が掛かった物理ピクセルサイズになる。Retina 環境では長辺が 2576px を超えることが多く、そのままではモデルの高解像度入力上限に収まらない。`tools/page-extract` 側で自動縮小する
- これは検証用であり、本番の拡張とは permissions 構成が異なる（`docs/DEV_NOTES.md` の 6 章を参照）
