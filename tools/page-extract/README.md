# page-extract

Phase 1（セリフ認識・翻訳の精度検証）用の CLI。

コミックページの PNG を Vision 対応モデルに渡し、`docs/DEV_NOTES.md` 4.1 の形式で「セリフ・読み順・訳文・概算座標」を取得する。取得結果を正解データと比較して、Phase 1 の完了条件を満たしているかを数値で判定する。

**拡張機能とは意図的に切り離してある。** Phase 1 で検証したいのは認識精度とコストだけで、そこに MV3 の制約（offscreen document、service worker の寿命、CSP）を持ち込むと検証が遅くなる。拡張側の役割は PNG を吐くところまでで、それは `kindle-capture-test/` で検証済み。

## セットアップ

Node 23.6 以上（TypeScript をそのまま実行するため）。画像の縮小に macOS の `sips` を使う。

```bash
cd tools/page-extract
npm install
```

API キーは環境変数で渡す。

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

または `ant auth login` でログイン済みなら環境変数なしで動く。

## 1. キャプチャを集める

`kindle-capture-test/` の拡張で PNG を保存し、`tools/page-extract/captures/` に `page-001.png` のような連番で置く。吹き出し 100 個分が目標。

Kindle の表示設定によっては **1 枚が見開き 2 ページ**になる。その場合も画像 1 枚が 1 つの `index` に対応し、評価はそのまま動く。1 枚あたりの吹き出しが倍になるので、必要な枚数は少なくて済む。

キャプチャ画像は著作物なので `.gitignore` でコミット対象から除外してある。

## 2. 正解データを作る

```bash
cp fixtures/ground-truth.example.json fixtures/ground-truth.json
```

`ground-truth.json` に、各画像の吹き出しを**画像を見ながら手で**書き起こす。吹き出し 100 個が目標。

**正解データは抽出モデルの答え合わせなので、同じモデルに書かせてはいけない。** 難読箇所で誤りが揃い、精度が実際より高く出る。Phase 1 の go / no-go はまさにその難読箇所で決まるため、偏りが判定に直撃する。

書き起こしのルール（`src/prompt.ts` のモデルへの指示と揃えてある。片方だけ変えると評価がズレる）:

- **効果音・擬音（SFX）は含めない。** 背景の文字、看板、ロゴ、ページ番号も含めない
- 作品タイトルのロゴ、作者のサイン、次号予告や広告などの本編外の告知も含めない
- 吹き出し・ナレーションボックス・思考の吹き出しの中身だけを対象にする
- 画像に見えるとおりに書き起こす（アメコミの全大文字はそのまま）
- 複数行は半角スペース1つで連結する
- 行末のハイフネーションは結合して元の単語に戻す（`INCRE-` / `DIBLE` → `INCREDIBLE`）
- **判読できない文字は推測で埋めず `[?]` と書く**（モデル側にも同じ指示をしている）
- `order` は読み順の連番（1 始まり）
- **見開き 2 ページの画像では、左ページを最後まで書き起こしてから右ページに移る。** `order` は画像全体を通した連番にし、ページごとに振り直さない

`ja` は自動評価では使わないが、訳文を目視確認するときの基準になるので埋めておくと後が楽。

## 3. 抽出する

```bash
npm run extract -- --image captures/page-001.png --index 1
```

主なオプション:

| オプション | 既定 | 説明 |
|---|---|---|
| `--image <path>` | （必須） | 入力 PNG |
| `--out <path>` | `out/<画像名>.json` | 出力先 |
| `--model <id>` | `claude-opus-5` | `claude-sonnet-5` など |
| `--effort <level>` | `high` | `low` / `medium` / `high` / `xhigh` / `max` |
| `--glossary <path>` | なし | 用語集 JSON（`[{ "en": "...", "ja": "..." }]`） |
| `--asin` / `--index` | なし | 出力に記録するページ識別子 |

10 ページまとめて処理する例:

```bash
for i in $(seq -w 1 10); do
  npm run extract -- --image "captures/page-0$i.png" --index "$((10#$i))" --out "out/page-0$i.json"
done
```

## 4. 評価する

```bash
npm run evaluate -- --truth fixtures/ground-truth.json --pred out
```

Phase 1 の完了条件（`docs/DEV_NOTES.md` 7章）に対して合否を出す。

| 指標 | 目標 | 算出方法 |
|---|---|---|
| 文字単位 CER | < 10% | 対応が付いた吹き出しの Levenshtein 距離の合計 ÷ 正解文字数の合計 |
| 手直し不要 | >= 80% | 正規化後に原文が完全一致した吹き出しの割合 |
| 取りこぼし | <= 10% | 対応が付かなかった正解の吹き出しの割合 |
| 読み順が正しいページ | >= 80% | 対応が付いた吹き出しを予測の順に並べたとき、正解の order が単調増加しているページの割合 |

あわせて**誤検出**（正解に対応が無いモデル出力。効果音を拾った場合など）と、モデル自身が `[?]` と報告した判読不能箇所の件数を出す。

全条件を満たすと終了コード 0、満たさないと 1 を返す。

### 評価の設計

- **対応付けは bbox ではなく原文の類似度で行う。** 対訳パネル方式では座標が低精度でも問題にならないので、座標精度を認識精度の評価に混ぜたくない。類似度 0.5 以上で「検出できた」とみなす
- **正規化で大文字小文字・引用符の字形・改行位置の差は潰す。** アメコミは全大文字が基本なので大文字小文字は情報を持たない
- **CER は対応が付いたペアのみで計算する。** 取りこぼしを文字誤りとして混ぜると、認識品質と検出漏れが分離できなくなる。取りこぼしは別指標で見る
- **訳文の品質は自動判定していない。** 評価可能なのは原文の書き起こし精度と読み順まで。訳文は目視で確認する

## モデルとコストの比較

`docs/DEV_NOTES.md` 3.2 の方針（Sonnet 5 で精度を見て、不足分を Opus 5 に回す）を確認するには、同じキャプチャに対して出力先を変えて走らせる。

```bash
npm run extract -- --image captures/page-001.png --index 1 \
  --model claude-sonnet-5 --out out-sonnet/page-001.json
npm run extract -- --image captures/page-001.png --index 1 \
  --model claude-opus-5 --out out-opus/page-001.json

npm run evaluate -- --truth fixtures/ground-truth.json --pred out-sonnet
npm run evaluate -- --truth fixtures/ground-truth.json --pred out-opus
```

各出力 JSON に実測のトークン数と概算コストが入っているので、精度とコストを並べて比較できる。

## 既知の制約

- **画像の縮小**: 長辺が 2576px（モデルの高解像度入力の上限）を超える画像は `sips` で自動縮小する。bbox は縮小後の座標系で返るため、キャプチャ原寸に戻すには出力 JSON の `image.scale` で割る（Phase 3 で使う）
- **プロンプトキャッシュ**: システムプロンプトに `cache_control` を付けているが、Opus 5 の最小キャッシュ長は 512 トークン、Sonnet 5 は 1024 トークン。現在のシステムプロンプトはこの境界付近なので、キャッシュが効いていない可能性がある。出力 JSON の `usage.cache_read_input_tokens` が 0 のままなら効いていない
- **Batch API 未対応**: 1 ページずつ同期で投げる。1 巻単位の事前翻訳（50% 引）は Phase 4 で対応する
