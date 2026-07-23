// 保存済み API キーが読めないモデルがある時の警告バナー
//
// 典型的な発火条件 (Keychain ダウングレード罠):
//   - Keychain 対応版で起動 → models.json から apiKey が Keychain に移行 →
//     ファイル側は空 → Keychain 非対応版にダウングレード → 起動 → models.json
//     にキー無し / Keychain も読めない → 全リクエストが 401 で死ぬ
//
// UI の役割: 起動直後にこれを検出して「同じキーを Settings に貼り直してください」
// を出し、ユーザーが「AI が動かない理由がわからない」状態に陥らないようにする。
//
// UpdateBanner と同じ場所に出すので、見た目もそろえる（黄色系で警告を表す）。

import { useCallback, useEffect, useState } from "react";
import { useT } from "../i18n";
import { apiBase, isTauri } from "../lib/platform";

type MissingKeyModel = {
  id: string;
  name: string;
  provider: string;
};

type HealthResponse = {
  components?: { auth?: "ok" | "keys-missing" };
  missingKeyModels?: MissingKeyModel[];
};

const DISMISS_KEY = "graphium-missing-api-key-banner-dismissed";

export function MissingApiKeyBanner() {
  const t = useT();
  const [missing, setMissing] = useState<MissingKeyModel[]>([]);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    // session 単位で dismiss を覚える。次回起動でまだ未解決なら再度警告する。
    try {
      return sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  const refresh = useCallback(async () => {
    // Web モード (Vercel) はサーバー側で apiKey を保持しないので、この警告は対象外。
    if (!isTauri()) {
      setMissing([]);
      return;
    }
    try {
      const res = await fetch(`${apiBase()}/health`);
      if (!res.ok) return;
      const data = (await res.json()) as HealthResponse;
      setMissing(data.missingKeyModels ?? []);
    } catch {
      // sidecar が落ちている / 起動中の場合は黙ってスキップ。
      // sidecar クラッシュ系のエラーはバナー側の責務ではなく別経路で扱う。
    }
  }, []);

  useEffect(() => {
    refresh();
    // ユーザーがウィンドウをアクティブにした時に再確認する。Settings でキーを
    // 貼り直して戻ってきた瞬間に警告が消えるようにするため。
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const handleOpenSettings = useCallback(() => {
    // note-app 側がこの CustomEvent を捕まえて Settings モーダルを開く。
    // UpdateBanner の "graphium-update-available" と同じ間接化パターン。
    // tab は settings/modal.tsx の Tab 型に存在する値を渡す（"ai-setup" は存在せず
    // AI タブが開かないバグだったので "ai" に修正）。
    window.dispatchEvent(
      new CustomEvent("graphium-open-settings", { detail: { tab: "ai" } }),
    );
  }, []);

  const handleDismiss = useCallback(() => {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // sessionStorage が使えない環境では state のみ
    }
    setDismissed(true);
  }, []);

  if (dismissed || missing.length === 0) return null;

  const isMultiple = missing.length > 1;
  const title = isMultiple
    ? t("auth.missingKeyBodyMultiple", {
        count: String(missing.length),
        models: missing.map((m) => m.name).join(", "),
      })
    : t("auth.missingKeyTitle", { model: missing[0].name });
  const body = isMultiple ? null : t("auth.missingKeyBody", {
    model: missing[0].name,
    provider: providerDisplayName(missing[0].provider),
  });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: "8px 16px",
        background: "#fff5e0",
        borderBottom: "1px solid #e6c688",
        fontSize: 13,
        color: "#7a5a1a",
      }}
      role="alert"
    >
      <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
        <strong>{title}</strong>
        {body && <span style={{ fontWeight: 400 }}>{body}</span>}
      </span>
      <button
        onClick={handleOpenSettings}
        style={{
          padding: "3px 12px",
          fontSize: 12,
          fontWeight: 600,
          borderRadius: 4,
          border: "1px solid #b08840",
          background: "#b08840",
          color: "#fff",
          cursor: "pointer",
        }}
      >
        {t("auth.openSettings")}
      </button>
      <button
        onClick={handleDismiss}
        style={{
          padding: "3px 8px",
          fontSize: 12,
          borderRadius: 4,
          border: "1px solid #d6b87a",
          background: "transparent",
          color: "#7a5a1a",
          cursor: "pointer",
        }}
        aria-label={t("auth.dismiss")}
      >
        ×
      </button>
    </div>
  );
}

/**
 * provider id を人間向け表示に変換する。Settings → AI Setup の `PROVIDERS`
 * とそろえる。未知の値はそのまま返す（致命的でないので silent fallback）。
 */
function providerDisplayName(provider: string): string {
  switch (provider) {
    case "anthropic":
      return "Anthropic";
    case "openai":
      return "OpenAI";
    case "google":
      return "Google Gemini";
    case "openai-compatible":
      return "OpenAI-compatible";
    default:
      return provider;
  }
}
