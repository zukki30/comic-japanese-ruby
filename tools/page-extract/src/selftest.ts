/**
 * 評価ロジックの自己テスト。
 *
 * この指標が Phase 1 の go / no-go を決めるので、計算が静かに間違っていると
 * 判断そのものが狂う。手計算で検証できる小さなケースで固定しておく。
 *
 * 実行: npm run selftest
 */

import { evaluatePage, type Pred, type TruthPage } from "./evaluate.ts";
import { levenshtein, normalize, pairByText, similarity } from "./text.ts";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "✓" : "✗"} ${label}${ok ? "" : `\n      期待: ${JSON.stringify(expected)}\n      実際: ${JSON.stringify(actual)}`}`,
  );
}

function near(label: string, actual: number, expected: number, tolerance = 1e-9): void {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "✓" : "✗"} ${label}${ok ? "" : `\n      期待: ${expected}\n      実際: ${actual}`}`,
  );
}

console.log("\nnormalize");
check("全大文字に揃える", normalize("I have to go"), "I HAVE TO GO");
check("連続する空白と改行を1つに潰す", normalize("NOT IF I\n  CAN HELP IT!"), "NOT IF I CAN HELP IT!");
check("カーリークォートを ASCII に寄せる", normalize("DON’T"), "DON'T");
check("省略記号を展開する", normalize("WAIT…"), "WAIT...");
check("各種ダッシュを統一する", normalize("A—B"), "A-B");

console.log("\nlevenshtein / similarity");
check("同一文字列の距離は 0", levenshtein("ABC", "ABC"), 0);
check("1文字置換の距離は 1", levenshtein("IT!", "IT?"), 1);
check("空文字列との距離は長さ", levenshtein("", "ABCD"), 4);
near("類似度は 1 - 距離/長さ", similarity("ABCD", "ABCE"), 0.75);

console.log("\npairByText");
{
  const pairing = pairByText<{ en: string }, { en: string }>(
    [{ en: "HELLO THERE" }, { en: "GOODBYE NOW" }],
    [{ en: "GOODBYE NOW" }, { en: "BOOM" }],
    { truth: (t) => t.en, pred: (p) => p.en },
  );
  check("対応が付いた件数", pairing.matched.length, 1);
  check("対応先が正しい", pairing.matched[0]!.pred.en, "GOODBYE NOW");
  check("取りこぼし", pairing.missed.map((m) => m.en), ["HELLO THERE"]);
  check("誤検出（効果音を拾った分）", pairing.spurious.map((s) => s.en), ["BOOM"]);
}

console.log("\nevaluatePage: 1文字誤り + 効果音の誤検出");
{
  // 正解の文字数は 25 + 21 = 46、誤りは 1 文字なので CER = 1/46
  const truth: TruthPage = {
    index: 1,
    balloons: [
      { order: 1, en: "I HAVE TO SAVE THE WORLD!" },
      { order: 2, en: "NOT IF I CAN HELP IT!" },
    ],
  };
  const pred: Pred = {
    balloons: [
      { order: 1, en: "I have to save the world!", ja: "", bbox: [0, 0, 1, 1] },
      { order: 2, en: "NOT IF I CAN HELP IT?", ja: "", bbox: [0, 0, 1, 1] },
      { order: 3, en: "KRAKA-THOOM", ja: "", bbox: [0, 0, 1, 1] },
    ],
  };

  const r = evaluatePage(truth, pred);
  check("一致", r.matched, 2);
  check("取りこぼし", r.missed, 0);
  check("誤検出", r.spurious, 1);
  near("CER = 1/46", r.cer, 1 / 46);
  check("手直し不要は大文字小文字差を無視して 1 件", r.cleanCount, 1);
  check("読み順は正しい", r.orderCorrect, true);
}

console.log("\nevaluatePage: 読み順の入れ替わりを検出する");
{
  const truth: TruthPage = {
    index: 2,
    balloons: [
      { order: 1, en: "FIRST LINE OF DIALOGUE" },
      { order: 2, en: "SECOND LINE OF DIALOGUE" },
    ],
  };
  const pred: Pred = {
    balloons: [
      { order: 1, en: "SECOND LINE OF DIALOGUE", ja: "", bbox: [0, 0, 1, 1] },
      { order: 2, en: "FIRST LINE OF DIALOGUE", ja: "", bbox: [0, 0, 1, 1] },
    ],
  };

  const r = evaluatePage(truth, pred);
  check("書き起こし自体は一致", r.matched, 2);
  near("CER は 0", r.cer, 0);
  check("読み順は NG", r.orderCorrect, false);
}

console.log("\nevaluatePage: 判読不能の報告と全欠落");
{
  const truth: TruthPage = {
    index: 3,
    balloons: [
      { order: 1, en: "SOMETHING UNREADABLE HERE" },
      { order: 2, en: "THIS ONE IS MISSED ENTIRELY" },
    ],
  };
  const pred: Pred = {
    balloons: [{ order: 1, en: "[?]", ja: "[?]", bbox: [0, 0, 1, 1] }],
  };

  const r = evaluatePage(truth, pred);
  check("[?] は類似度が低く対応が付かない", r.matched, 0);
  check("2件とも取りこぼし", r.missed, 2);
  check("[?] は誤検出として数える", r.spurious, 1);
  near("対応が無いので CER は 0（取りこぼしで評価する）", r.cer, 0);
}

console.log(
  failures === 0
    ? "\n自己テスト: 全件 OK\n"
    : `\n自己テスト: ${failures} 件失敗\n`,
);
process.exit(failures === 0 ? 0 : 1);
