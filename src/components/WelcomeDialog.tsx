// 起動時の Welcome ダイアログと旧 Drive レイアウト移行ダイアログ
//
// 表示条件:
// - 旧 Drive レイアウトのファイルが検出された → 移行ダイアログ（最優先）
// - 初回起動かつ未表示 → ウェルカムダイアログ
// それ以外は何も表示しない（即エディタ）

import { useEffect, useState } from "react";
import { Folder, HardDrive, Server } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useT } from "../i18n";
import { isTauri } from "../lib/platform";
import { getActiveProvider, probeServerProvider } from "../lib/storage/registry";
import { AiUpgradeNotice } from "./AiUpgradeNotice";

const WELCOME_SHOWN_KEY = "graphium_welcome_shown";

type LegacyScan = {
  note_count: number;
  wiki_count: number;
  skill_count: number;
};

type Mode =
  | { kind: "hidden" }
  | { kind: "welcome"; rootPath: string | null }
  | { kind: "legacy"; scan: LegacyScan; rootPath: string }
  | { kind: "migrating" }
  | { kind: "migrated"; moved: LegacyScan };

export function WelcomeDialog() {
  const t = useT();
  const [mode, setMode] = useState<Mode>({ kind: "hidden" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Web/Docker は移行検知の対象外（ファイルシステムにアクセスできない）
      if (isTauri()) {
        try {
          const [scan, root] = await Promise.all([
            invoke<LegacyScan>("detect_legacy_drive_layout"),
            invoke<{ current: string }>("get_graphium_root").catch(() => ({ current: "" })),
          ]);
          const total = scan.note_count + scan.wiki_count + scan.skill_count;
          if (!cancelled && total > 0) {
            setMode({ kind: "legacy", scan, rootPath: root.current });
            return;
          }
        } catch (e) {
          console.warn("旧レイアウト検知に失敗:", e);
        }
      }

      // 初回起動チェック
      const shown = typeof localStorage !== "undefined" ? localStorage.getItem(WELCOME_SHOWN_KEY) : null;
      if (!shown && !cancelled) {
        // サーバー側ストレージの判定が間に合うように probe を待つ
        await probeServerProvider();
        if (cancelled) return;
        let rootPath: string | null = null;
        if (isTauri()) {
          try {
            const root = await invoke<{ current: string }>("get_graphium_root");
            rootPath = root.current;
          } catch {
            // ignore
          }
        }
        setMode({ kind: "welcome", rootPath });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dismissWelcome = () => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(WELCOME_SHOWN_KEY, "1");
    }
    setMode({ kind: "hidden" });
  };

  const runMigration = async () => {
    setMode({ kind: "migrating" });
    try {
      const moved = await invoke<LegacyScan>("migrate_legacy_drive_layout");
      setMode({ kind: "migrated", moved });
    } catch (e) {
      console.error("移行失敗:", e);
      alert(t("welcome.migrationError") + "\n" + String(e));
      setMode({ kind: "hidden" });
    }
  };

  const finishMigration = () => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(WELCOME_SHOWN_KEY, "1");
    }
    // インデックスを再構築させるためリロード
    window.location.reload();
  };

  if (mode.kind === "hidden") return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="max-w-md w-[calc(100%-2rem)] bg-background border border-border rounded-xl shadow-xl p-6 space-y-4">
        {mode.kind === "welcome" && (
          <>
            <div className="flex flex-col items-center gap-3">
              <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Graphium" className="w-14 h-14" />
              <h2 className="text-lg font-semibold">{t("welcome.title")}</h2>
            </div>
            <p className="text-sm text-muted-foreground">{t("welcome.subtitle")}</p>
            {isTauri() && mode.rootPath && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-muted text-xs">
                <Folder size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium mb-0.5">{t("welcome.saveLocation")}</p>
                  <p className="text-muted-foreground break-all">{mode.rootPath}</p>
                  <p className="text-muted-foreground mt-1.5">{t("welcome.saveLocationHint")}</p>
                </div>
              </div>
            )}
            {!isTauri() && getActiveProvider().id === "server-fs" && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-muted text-xs">
                <Server size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium mb-0.5">{t("welcome.serverStorage")}</p>
                  <p className="text-muted-foreground">{t("welcome.serverStorageHint")}</p>
                </div>
              </div>
            )}
            {!isTauri() && getActiveProvider().id !== "server-fs" && (
              <>
                <div className="flex items-start gap-2 p-3 rounded-lg bg-muted text-xs">
                  <HardDrive size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium mb-0.5">{t("welcome.browserStorage")}</p>
                    <p className="text-muted-foreground">{t("welcome.browserStorageHint")}</p>
                  </div>
                </div>
                <AiUpgradeNotice variant="card" />
              </>
            )}
            <button
              onClick={dismissWelcome}
              className="w-full px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
            >
              {t("welcome.start")}
            </button>
          </>
        )}

        {mode.kind === "legacy" && (
          <>
            <h2 className="text-lg font-semibold">{t("welcome.legacyTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("welcome.legacyBody")}</p>
            <div className="p-3 rounded-lg bg-muted text-xs space-y-1">
              <p className="font-medium">{t("welcome.legacyDetected")}</p>
              <p className="text-muted-foreground">
                {t("welcome.legacyNotes", { n: String(mode.scan.note_count) })}・
                {t("welcome.legacyWiki", { n: String(mode.scan.wiki_count) })}・
                {t("welcome.legacySkills", { n: String(mode.scan.skill_count) })}
              </p>
              <p className="text-muted-foreground break-all pt-1">{mode.rootPath}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setMode({ kind: "hidden" })}
                className="flex-1 px-4 py-2.5 rounded-lg border border-border text-sm hover:bg-accent transition-colors"
              >
                {t("welcome.later")}
              </button>
              <button
                onClick={runMigration}
                className="flex-1 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
              >
                {t("welcome.migrateNow")}
              </button>
            </div>
          </>
        )}

        {mode.kind === "migrating" && (
          <>
            <h2 className="text-lg font-semibold">{t("welcome.migrating")}</h2>
            <p className="text-sm text-muted-foreground">{t("welcome.migratingHint")}</p>
          </>
        )}

        {mode.kind === "migrated" && (
          <>
            <h2 className="text-lg font-semibold">{t("welcome.migratedTitle")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("welcome.migratedBody", { n: String(mode.moved.note_count + mode.moved.wiki_count + mode.moved.skill_count) })}
            </p>
            <button
              onClick={finishMigration}
              className="w-full px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
            >
              {t("welcome.start")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
