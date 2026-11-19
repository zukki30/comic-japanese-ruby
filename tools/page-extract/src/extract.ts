import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

import { estimateCost, formatUsd } from "./cost.ts";
import { prepareImage, toBase64 } from "./image.ts";
import { SYSTEM_PROMPT, buildGlossaryBlock, type GlossaryEntry } from "./prompt.ts";
import { PageResultSchema, validateBboxes } from "./schema.ts";

const DEFAULT_MODEL = "claude-opus-5";
const DEFAULT_EFFORT = "high";

const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORT_LEVELS)[number];

type Args = {
  image: string;
  out?: string;
  model: string;
  effort: Effort;
  glossary?: string;
  asin?: string;
  index?: number;
};

function parseArgs(argv: string[]): Args {
  const map = new Map<string, string>();

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      map.set(key, "true");
    } else {
      map.set(key, next);
      i += 1;
    }
  }

  const image = map.get("image");
  if (!image) {
    console.error(
      [
        "使い方: node src/extract.ts --image <page.png> [options]",
        "",
        "  --image <path>      入力の PNG（必須）",
        "  --out <path>        出力 JSON のパス（既定: out/<画像名>.json）",
        `  --model <id>        既定: ${DEFAULT_MODEL}`,
        `  --effort <level>    low | medium | high | xhigh | max（既定: ${DEFAULT_EFFORT}）`,
        "  --glossary <path>   用語集 JSON（[{ en, ja }] の配列）",
        "  --asin <asin>       出力に記録する作品の ASIN",
        "  --index <n>         出力に記録するページ番号",
      ].join("\n"),
    );
    process.exit(1);
  }

  const effort = map.get("effort") ?? DEFAULT_EFFORT;
  if (!(EFFORT_LEVELS as readonly string[]).includes(effort)) {
    console.error(
      `--effort は ${EFFORT_LEVELS.join(" / ")} のいずれかです（指定値: ${effort}）`,
    );
    process.exit(1);
  }

  const indexRaw = map.get("index");

  return {
    image,
    out: map.get("out"),
    model: map.get("model") ?? DEFAULT_MODEL,
    effort: effort as Effort,
    glossary: map.get("glossary"),
    asin: map.get("asin"),
    index: indexRaw === undefined ? undefined : Number(indexRaw),
  };
}

function loadGlossary(path: string | undefined): GlossaryEntry[] {
  if (!path) return [];
  if (!existsSync(path)) {
    console.warn(`用語集が見つからないので空で続行します: ${path}`);
    return [];
  }
  return JSON.parse(readFileSync(path, "utf8")) as GlossaryEntry[];
}

function defaultOutPath(imagePath: string): string {
  const name = basename(imagePath, extname(imagePath));
  return join("out", `${name}.json`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(args.image)) {
    console.error(`画像が見つかりません: ${args.image}`);
    process.exit(1);
  }

  const image = prepareImage(args.image);
  if (image.resized) {
    console.log(
      `縮小: ${image.originalWidth}x${image.originalHeight} → ${image.width}x${image.height} (scale ${image.scale.toFixed(4)})`,
    );
  }

  const glossary = loadGlossary(args.glossary);
  const client = new Anthropic();

  const startedAt = Date.now();
  const response = await client.messages.parse({
    model: args.model,
    max_tokens: 16000,
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ],
    output_config: {
      format: zodOutputFormat(PageResultSchema),
      effort: args.effort,
    },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: toBase64(image.path),
            },
          },
          {
            type: "text",
            text: `${buildGlossaryBlock(glossary)}\n\n画像は ${image.width}x${image.height} ピクセルです。このページのセリフを抽出して翻訳してください。`,
          },
        ],
      },
    ],
  });
  const elapsedMs = Date.now() - startedAt;

  if (response.stop_reason === "refusal") {
    console.error("モデルがリクエストを拒否しました:", response.stop_details);
    process.exit(2);
  }
  if (response.stop_reason === "max_tokens") {
    console.error(
      "max_tokens に達して出力が途切れました。max_tokens を増やすか effort を下げてください。",
    );
    process.exit(2);
  }

  const result = response.parsed_output;
  if (!result) {
    console.error("スキーマに沿った出力が得られませんでした。");
    process.exit(2);
  }

  const warnings = validateBboxes(result, image.width, image.height);
  const cost = estimateCost(args.model, response.usage);

  const outPath = args.out ?? defaultOutPath(args.image);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        page: { asin: args.asin ?? null, index: args.index ?? null },
        image: {
          source: args.image,
          sentWidth: image.width,
          sentHeight: image.height,
          originalWidth: image.originalWidth,
          originalHeight: image.originalHeight,
          // bbox はこの scale で割るとキャプチャ原寸の座標に戻る（Phase 3 で使う）
          scale: image.scale,
        },
        run: {
          model: args.model,
          effort: args.effort,
          elapsedMs,
          glossarySize: glossary.length,
        },
        usage: response.usage,
        cost,
        warnings,
        balloons: result.balloons,
        glossary_additions: result.glossary_additions,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(`\n吹き出し ${result.balloons.length} 件`);
  for (const b of result.balloons) {
    console.log(`  ${String(b.order).padStart(2)}. ${b.en}`);
    console.log(`      ${b.ja}`);
  }

  if (result.glossary_additions.length > 0) {
    console.log("\n新規の固有名詞:");
    for (const e of result.glossary_additions) {
      console.log(`  ${e.en} → ${e.ja}`);
    }
  }

  if (warnings.length > 0) {
    console.log("\n警告:");
    for (const w of warnings) console.log(`  - ${w}`);
  }

  console.log(
    [
      "",
      `モデル: ${args.model} (effort: ${args.effort})`,
      `所要: ${(elapsedMs / 1000).toFixed(1)}s`,
      `トークン: 入力 ${cost.inputTokens} / キャッシュ書込 ${cost.cacheWriteTokens} / キャッシュ読出 ${cost.cacheReadTokens} / 出力 ${cost.outputTokens}`,
      `概算コスト: ${formatUsd(cost.usd)}`,
      `出力: ${outPath}`,
    ].join("\n"),
  );
}

await main();
