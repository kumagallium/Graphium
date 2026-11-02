// メモ（captures.json）の一覧を読む。MCP 側の共通の読み口。
// 無い・壊れている場合は null（呼び出し側が NOT_FOUND などに変換する）。

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { CaptureIndex } from "../features/mobile-capture/capture-store";
import { appDataDir, resolveGraphiumRoot } from "./vault";

export function readCaptureIndex(root: string = resolveGraphiumRoot()): CaptureIndex | null {
  const path = join(appDataDir(root), "captures.json");
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as CaptureIndex | null;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
