/**
 * 比較用の正規化。
 *
 * アメコミのレタリングは全大文字が基本なので大文字小文字は情報を持たない。
 * 引用符・ダッシュ・省略記号の字形差と改行位置も認識精度とは無関係なので潰す。
 */
export function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length];
}

export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}

export type Pairing<T, U> = {
  matched: Array<{ truth: T; pred: U; similarity: number }>;
  missed: T[];
  spurious: U[];
};

/**
 * 正解とモデル出力を対応付ける。
 *
 * bbox ではなく原文の類似度で突き合わせる。パネル方式では座標が低精度でも
 * 問題にならないため、座標精度を認識精度の評価に混ぜたくない。
 */
export function pairByText<T, U>(
  truth: T[],
  pred: U[],
  textOf: { truth: (t: T) => string; pred: (p: U) => string },
  threshold = 0.5,
): Pairing<T, U> {
  const candidates: Array<{ t: number; p: number; sim: number }> = [];

  for (let t = 0; t < truth.length; t += 1) {
    const tn = normalize(textOf.truth(truth[t]));
    for (let p = 0; p < pred.length; p += 1) {
      const sim = similarity(tn, normalize(textOf.pred(pred[p])));
      if (sim >= threshold) candidates.push({ t, p, sim });
    }
  }

  candidates.sort((a, b) => b.sim - a.sim);

  const usedTruth = new Set<number>();
  const usedPred = new Set<number>();
  const matched: Pairing<T, U>["matched"] = [];

  for (const c of candidates) {
    if (usedTruth.has(c.t) || usedPred.has(c.p)) continue;
    usedTruth.add(c.t);
    usedPred.add(c.p);
    matched.push({ truth: truth[c.t], pred: pred[c.p], similarity: c.sim });
  }

  return {
    matched,
    missed: truth.filter((_, i) => !usedTruth.has(i)),
    spurious: pred.filter((_, i) => !usedPred.has(i)),
  };
}
