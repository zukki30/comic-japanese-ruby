import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

/** Opus 5 / Sonnet 5 の高解像度画像入力の上限（長辺） */
export const MAX_LONG_EDGE = 2576;

export type PreparedImage = {
  /** モデルに送る画像のパス（必要に応じて縮小後のもの） */
  path: string;
  width: number;
  height: number;
  /** 縮小前のサイズ。bbox をキャプチャ原寸に戻すのに使う */
  originalWidth: number;
  originalHeight: number;
  /** originalWidth に対する倍率。1 なら無縮小 */
  scale: number;
  resized: boolean;
};

/**
 * PNG の IHDR チャンクから寸法を読む。画像ライブラリへの依存を避けるため自前実装。
 */
export function readPngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path);

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(signature)) {
    throw new Error(`PNG ではありません: ${path}`);
  }
  if (buf.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error(`PNG の IHDR チャンクが見つかりません: ${path}`);
  }

  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * 長辺が上限を超える画像を縮小する。
 *
 * Retina 環境の captureVisibleTab は devicePixelRatio が掛かるため、長辺が
 * 2576px を超えることが多い。上限超過時にモデル側でどう扱われるかに依存すると
 * bbox の座標系が曖昧になるので、送信前に明示的に縮小して倍率を記録する。
 *
 * macOS 標準の sips を使う（追加依存なし）。
 */
export function prepareImage(path: string, maxLongEdge = MAX_LONG_EDGE): PreparedImage {
  const { width, height } = readPngSize(path);
  const longEdge = Math.max(width, height);

  if (longEdge <= maxLongEdge) {
    return {
      path,
      width,
      height,
      originalWidth: width,
      originalHeight: height,
      scale: 1,
      resized: false,
    };
  }

  const ext = extname(path);
  const resizedPath = join(
    dirname(path),
    `${basename(path, ext)}.fit${maxLongEdge}${ext}`,
  );

  try {
    execFileSync("sips", ["-Z", String(maxLongEdge), path, "--out", resizedPath], {
      stdio: "pipe",
    });
  } catch (error) {
    throw new Error(
      `画像の縮小に失敗しました（sips が必要です）: ${path}\n${String(error)}`,
    );
  }

  const resized = readPngSize(resizedPath);

  return {
    path: resizedPath,
    width: resized.width,
    height: resized.height,
    originalWidth: width,
    originalHeight: height,
    scale: resized.width / width,
    resized: true,
  };
}

export function toBase64(path: string): string {
  return readFileSync(path).toString("base64");
}
