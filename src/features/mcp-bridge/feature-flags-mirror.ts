// 設定の写し（`<root>/appdata/feature-flags.json`）
// MCP サーバー（Node 単体）は localStorage の設定を読めないので、知見・洞察の ON/OFF を
// アプリ側からファイルに書き出して見せる。設計: docs/internal/mcp-knowledge-generation-design-2026-10.md §8 Q2
// ・デスクトップ: filesystem provider の writeAppData が `<root>/appdata/feature-flags.json` に書く
// ・書き口を持たない provider（google-drive 等）では何もしない
// ・ベストエフォート（書けなくてもアプリは止めない）

import { useEffect } from "react";
import { isAtomLayerEnabled, isClaimsEnabled, SETTINGS_SAVED_EVENT } from "../settings/store";

export type FeatureFlagsFile = {
  claims: boolean;
  insights: boolean;
  updatedAt: string;
};

export type FeatureFlagsStorage = {
  writeAppData?(key: string, data: unknown): Promise<void>;
};

export const FEATURE_FLAGS_KEY = "feature-flags";

/** 現在の設定から写しの中身（updatedAt を除く）を作る */
export function readCurrentFlags(): Pick<FeatureFlagsFile, "claims" | "insights"> {
  return { claims: isClaimsEnabled(), insights: isAtomLayerEnabled() };
}

/**
 * 値が前回書いたものと違うときだけ書く。書いたら true。
 * `last` は呼び出し側が持つ「前回書いた値」（書き込み成功時のみ更新される）。
 */
export async function writeFeatureFlagsIfChanged(
  provider: FeatureFlagsStorage | null | undefined,
  last: { current: Pick<FeatureFlagsFile, "claims" | "insights"> | null },
  now: () => string = () => new Date().toISOString(),
): Promise<boolean> {
  if (!provider || typeof provider.writeAppData !== "function") return false;
  const flags = readCurrentFlags();
  if (last.current && last.current.claims === flags.claims && last.current.insights === flags.insights) {
    return false;
  }
  try {
    await provider.writeAppData(FEATURE_FLAGS_KEY, { ...flags, updatedAt: now() } satisfies FeatureFlagsFile);
    last.current = flags;
    return true;
  } catch (err) {
    console.warn("[feature-flags] write failed", err);
    return false;
  }
}

/** 起動時（provider が使えるようになったとき）と設定の保存時に写しを書く */
export function useFeatureFlagsMirror(provider: FeatureFlagsStorage | null | undefined, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !provider || typeof provider.writeAppData !== "function") return;
    const last: { current: Pick<FeatureFlagsFile, "claims" | "insights"> | null } = { current: null };
    const sync = () => { void writeFeatureFlagsIfChanged(provider, last); };
    sync();
    window.addEventListener(SETTINGS_SAVED_EVENT, sync);
    return () => window.removeEventListener(SETTINGS_SAVED_EVENT, sync);
  }, [provider, enabled]);
}
