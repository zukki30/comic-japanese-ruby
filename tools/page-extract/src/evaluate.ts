import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

import { levenshtein, normalize, pairByText } from "./text.ts";

/** docs/DEV_NOTES.md 7章 Phase 1 の完了条件 */
const THRESHOLDS = {
  cer: 0.1, // 文字単位 CER < 10%
  cleanRate: 0.8, // 手直し不要 >= 80%
  missRate: 0.1, // 取りこぼし <= 10%
  orderRate: 0.8, // 読み順が正しいページ >= 80%
};

export type TruthBalloon = { order: number; en: string; ja?: string };
export type TruthPage = { index: number; image?: string; balloons: TruthBalloon[] };
type Truth = { asin?: string; title?: string; pages: TruthPage[] };

export type PredBalloon = { order: number; en: string; ja: string; bbox: number[] };
export type Pred = {
  page?: { asin?: string | null; index?: number | null };
  image?: { source?: string };
  run?: { model?: string; effort?: string };
  cost?: { usd?: number | null };
  balloons: PredBalloon[];
};

export type PageReport = {
  index: number;
  truthCount: number;
  predCount: number;
  matched: number;
  missed: number;
  spurious: number;
  unreadable: number;
  cer: number;
  cleanCount: number;
  orderCorrect: boolean;
};

function parseArgs(argv: string[]): { truth: string; pred: string; out?: string } {
  const map = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      map.set(token.slice(2), "true");
    } else {
      map.set(token.slice(2), next);
      i += 1;
    }
  }

  const truth = map.get("truth");
  const pred = map.get("pred");
  if (!truth || !pred) {
    console.error(
      [
        "使い方: node src/evaluate.ts --truth <ground-truth.json> --pred <out ディレクトリ>",
        "",
        "  --truth <path>  正解データ（fixtures/ground-truth.example.json の形式）",
        "  --pred <dir>    extract.ts の出力 JSON が入ったディレクトリ",
        "  --out <path>    評価結果 JSON の出力先（既定: <pred>/eval-report.json）",
      ].join("\n"),
    );
    process.exit(1);
  }

  return { truth, pred, out: map.get("out") };
}

function loadPredictions(dir: string): Map<number, Pred> {
  const byIndex = new Map<number, Pred>();

  for (const file of readdirSync(dir)) {
    if (extname(file) !== ".json" || file === "eval-report.json") continue;

    const pred = JSON.parse(readFileSync(join(dir, file), "utf8")) as Pred;
    let index = pred.page?.index ?? null;

    // index が記録されていない場合はファイル名の数字から拾う（page-012.json → 12）
    if (index === null || index === undefined) {
      const digits = basename(file, ".json").match(/(\d+)/);
      if (!digits) {
        console.warn(`ページ番号が判別できないのでスキップ: ${file}`);
        continue;
      }
      index = Number(digits[1]);
    }

    if (byIndex.has(index)) {
      console.warn(`ページ ${index} の出力が重複しています: ${file}`);
    }
    byIndex.set(index, pred);
  }

  return byIndex;
}

export function evaluatePage(truthPage: TruthPage, pred: Pred): PageReport {
  const pairing = pairByText<TruthBalloon, PredBalloon>(
    truthPage.balloons,
    pred.balloons,
    { truth: (t) => t.en, pred: (p) => p.en },
  );

  let distanceSum = 0;
  let referenceLength = 0;
  let cleanCount = 0;
  let unreadable = 0;

  for (const m of pairing.matched) {
    const truthText = normalize(m.truth.en);
    const predText = normalize(m.pred.en);

    distanceSum += levenshtein(truthText, predText);
    referenceLength += truthText.length;

    if (truthText === predText) cleanCount += 1;
    if (predText.includes("[?]")) unreadable += 1;
  }

  // 読み順: 対応が付いた吹き出しについて、予測の順に並べたとき正解の order が
  // 単調増加しているか。欠落があっても相対順序が保たれていれば正しいとみなす。
  const sorted = [...pairing.matched].sort((a, b) => a.pred.order - b.pred.order);
  const orderCorrect = sorted.every(
    (m, i) => i === 0 || sorted[i - 1].truth.order < m.truth.order,
  );

  return {
    index: truthPage.index,
    truthCount: truthPage.balloons.length,
    predCount: pred.balloons.length,
    matched: pairing.matched.length,
    missed: pairing.missed.length,
    spurious: pairing.spurious.length,
    unreadable,
    cer: referenceLength === 0 ? 0 : distanceSum / referenceLength,
    cleanCount,
    orderCorrect,
  };
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(args.truth)) {
    console.error(`正解データが見つかりません: ${args.truth}`);
    process.exit(1);
  }
  if (!existsSync(args.pred)) {
    console.error(`出力ディレクトリが見つかりません: ${args.pred}`);
    process.exit(1);
  }

  const truth = JSON.parse(readFileSync(args.truth, "utf8")) as Truth;
  const predictions = loadPredictions(args.pred);

  const reports: PageReport[] = [];
  const skipped: number[] = [];

  for (const page of truth.pages) {
    const pred = predictions.get(page.index);
    if (!pred) {
      skipped.push(page.index);
      continue;
    }
    reports.push(evaluatePage(page, pred));
  }

  if (reports.length === 0) {
    console.error("評価できるページがありません。extract.ts の出力を確認してください。");
    process.exit(1);
  }

  const totals = reports.reduce(
    (acc, r) => ({
      truth: acc.truth + r.truthCount,
      matched: acc.matched + r.matched,
      missed: acc.missed + r.missed,
      spurious: acc.spurious + r.spurious,
      unreadable: acc.unreadable + r.unreadable,
      clean: acc.clean + r.cleanCount,
      orderOk: acc.orderOk + (r.orderCorrect ? 1 : 0),
    }),
    { truth: 0, matched: 0, missed: 0, spurious: 0, unreadable: 0, clean: 0, orderOk: 0 },
  );

  // 全体 CER はページごとの値を平均せず、文字数で重み付けして再計算する
  let distanceSum = 0;
  let referenceLength = 0;
  for (const page of truth.pages) {
    const pred = predictions.get(page.index);
    if (!pred) continue;
    const pairing = pairByText<TruthBalloon, PredBalloon>(
      page.balloons,
      pred.balloons,
      { truth: (t) => t.en, pred: (p) => p.en },
    );
    for (const m of pairing.matched) {
      const t = normalize(m.truth.en);
      distanceSum += levenshtein(t, normalize(m.pred.en));
      referenceLength += t.length;
    }
  }

  const metrics = {
    pages: reports.length,
    balloons: totals.truth,
    cer: referenceLength === 0 ? 0 : distanceSum / referenceLength,
    cleanRate: totals.truth === 0 ? 0 : totals.clean / totals.truth,
    missRate: totals.truth === 0 ? 0 : totals.missed / totals.truth,
    orderRate: reports.length === 0 ? 0 : totals.orderOk / reports.length,
    spurious: totals.spurious,
    unreadable: totals.unreadable,
  };

  console.log("\nページ別");
  console.log("  page  正解  出力  一致  欠落  誤検出   CER   読順");
  for (const r of reports) {
    console.log(
      [
        `  ${String(r.index).padStart(4)}`,
        String(r.truthCount).padStart(4),
        String(r.predCount).padStart(4),
        String(r.matched).padStart(4),
        String(r.missed).padStart(4),
        String(r.spurious).padStart(6),
        pct(r.cer).padStart(6),
        r.orderCorrect ? "  ok" : "  NG",
      ].join("  "),
    );
  }

  if (skipped.length > 0) {
    console.log(`\n出力が無くスキップしたページ: ${skipped.join(", ")}`);
  }

  const checks = [
    {
      label: "文字単位 CER",
      value: pct(metrics.cer),
      target: `< ${pct(THRESHOLDS.cer)}`,
      pass: metrics.cer < THRESHOLDS.cer,
    },
    {
      label: "手直し不要（原文完全一致）",
      value: pct(metrics.cleanRate),
      target: `>= ${pct(THRESHOLDS.cleanRate)}`,
      pass: metrics.cleanRate >= THRESHOLDS.cleanRate,
    },
    {
      label: "取りこぼし",
      value: pct(metrics.missRate),
      target: `<= ${pct(THRESHOLDS.missRate)}`,
      pass: metrics.missRate <= THRESHOLDS.missRate,
    },
    {
      label: "読み順が正しいページ",
      value: pct(metrics.orderRate),
      target: `>= ${pct(THRESHOLDS.orderRate)}`,
      pass: metrics.orderRate >= THRESHOLDS.orderRate,
    },
  ];

  console.log(`\n完了条件（${metrics.pages} ページ / 吹き出し ${metrics.balloons} 件）`);
  for (const c of checks) {
    console.log(
      `  ${c.pass ? "✓" : "✗"} ${c.label}: ${c.value}（目標 ${c.target}）`,
    );
  }
  console.log(`  - 誤検出: ${metrics.spurious} 件`);
  console.log(`  - 判読不能 [?] と報告: ${metrics.unreadable} 件`);

  const allPassed = checks.every((c) => c.pass);
  console.log(
    `\n判定: ${allPassed ? "Phase 1 の完了条件を満たしています" : "完了条件を満たしていません"}`,
  );
  console.log(
    "※ 訳文の品質は自動判定できません。正解データの ja を埋めて目視で確認してください。",
  );

  const outPath = args.out ?? join(args.pred, "eval-report.json");
  writeFileSync(
    outPath,
    `${JSON.stringify({ metrics, thresholds: THRESHOLDS, checks, pages: reports, skipped }, null, 2)}\n`,
    "utf8",
  );
  console.log(`\n評価結果: ${outPath}`);

  process.exit(allPassed ? 0 : 1);
}

// selftest から evaluatePage を import できるよう、直接実行時のみ main を走らせる
if (import.meta.filename === process.argv[1]) {
  main();
}
