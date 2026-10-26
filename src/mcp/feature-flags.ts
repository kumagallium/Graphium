// アプリの機能の ON/OFF の写し（appdata/feature-flags.json）を読む。
// アプリが起動時と設定変更時に書く（{ claims, insights, updatedAt }）。MCP は書かない。
// 設計: docs/internal/mcp-knowledge-generation-design-2026-10.md §8 Q2 / §10
//
// 写しが無い・読めないときは「不明」として扱い、呼び出し側が断る
// （黙って作らせると、知見を OFF にしている人に知見が増えうるため）。

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { appDataDir } from "./vault";

export type FeatureFlags = {
  claims: boolean;
  insights: boolean;
  updatedAt?: string;
};

export type FeatureFlagsResult = { ok: true; flags: FeatureFlags } | { ok: false; reason: "missing" | "unreadable" };

export function featureFlagsPath(root: string): string {
  return join(appDataDir(root), "feature-flags.json");
}

/** 写しを読む。無い／JSON として読めない／claims が真偽値でないときは ok: false */
export function readFeatureFlags(root: string): FeatureFlagsResult {
  const path = featureFlagsPath(root);
  if (!existsSync(path)) return { ok: false, reason: "missing" };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<FeatureFlags> | null;
    if (!raw || typeof raw !== "object" || typeof raw.claims !== "boolean") {
      return { ok: false, reason: "unreadable" };
    }
    return {
      ok: true,
      flags: {
        claims: raw.claims,
        // insights は段 2 で使う。無ければ OFF 扱い（断る側に倒す）
        insights: raw.insights === true,
        ...(typeof raw.updatedAt === "string" ? { updatedAt: raw.updatedAt } : {}),
      },
    };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

export const SETTINGS_UNKNOWN_MESSAGE =
  "SETTINGS_UNKNOWN: アプリの設定（知見を使うか）を読めません。新しい版の Graphium を一度起動してから、もう一度お試しください。";

export const CLAIMS_DISABLED_MESSAGE =
  "CLAIMS_DISABLED: Graphium の設定で「知見」が OFF になっているため、知見は作れません。作りたい場合は Graphium の設定で知見を ON にしてください。";

/** 知見を作ってよいかの判定。作ってよければ null、だめなら断りの文 */
export function claimsGateMessage(root: string): string | null {
  const r = readFeatureFlags(root);
  if (!r.ok) return SETTINGS_UNKNOWN_MESSAGE;
  if (!r.flags.claims) return CLAIMS_DISABLED_MESSAGE;
  return null;
}
