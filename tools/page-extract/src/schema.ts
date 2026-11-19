import { z } from "zod";

/**
 * モデルに返させるスキーマ。
 *
 * docs/DEV_NOTES.md 4.1 の出力形式のうち、モデルが生成するのは balloons と
 * glossary_additions だけ。page メタデータ（asin / index）は CLI 側で付与する。
 */

export const BalloonSchema = z.object({
  order: z
    .number()
    .int()
    .describe("読み順。1 から始まる連番"),
  en: z
    .string()
    .describe("吹き出し内の英語原文。複数行は半角スペース1つで連結する"),
  ja: z.string().describe("自然な日本語訳"),
  bbox: z
    .array(z.number())
    .describe("[x1, y1, x2, y2] 吹き出しの外接矩形。入力画像のピクセル座標、左上原点"),
});

export const GlossaryEntrySchema = z.object({
  en: z.string().describe("英語の固有名詞"),
  ja: z.string().describe("採用した日本語訳"),
});

export const PageResultSchema = z.object({
  balloons: z.array(BalloonSchema),
  glossary_additions: z
    .array(GlossaryEntrySchema)
    .describe("このページで新たに登場し、用語集に未登録だった固有名詞"),
});

export type Balloon = z.infer<typeof BalloonSchema>;
export type PageResult = z.infer<typeof PageResultSchema>;

/**
 * bbox の値域チェック。
 *
 * 構造化出力の JSON Schema は minimum / maximum をサポートしないため、
 * 座標が画像内に収まっているかはクライアント側で検証する必要がある。
 * パネル方式では座標がずれても致命的ではないので、失敗ではなく警告として返す。
 */
export function validateBboxes(
  result: PageResult,
  width: number,
  height: number,
): string[] {
  const warnings: string[] = [];

  for (const b of result.balloons) {
    const label = `balloon #${b.order}`;

    if (b.bbox.length !== 4) {
      warnings.push(`${label}: bbox の要素数が ${b.bbox.length} (4 であるべき)`);
      continue;
    }

    const [x1, y1, x2, y2] = b.bbox;

    if (x1 >= x2 || y1 >= y2) {
      warnings.push(`${label}: bbox が矩形になっていない [${b.bbox.join(", ")}]`);
    }
    if (x1 < 0 || y1 < 0 || x2 > width || y2 > height) {
      warnings.push(
        `${label}: bbox が画像外にはみ出している [${b.bbox.join(", ")}] (画像は ${width}x${height})`,
      );
    }
  }

  const orders = result.balloons.map((b) => b.order);
  const expected = Array.from({ length: orders.length }, (_, i) => i + 1);
  if (orders.join(",") !== expected.join(",")) {
    warnings.push(`order が 1 からの連番になっていない [${orders.join(", ")}]`);
  }

  return warnings;
}
