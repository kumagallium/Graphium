// 設定「表示・言語」の「画面の大きさ」セクション。
//
// デスクトップ: 倍率を選ぶ <select>。選んだらすぐ反映して記憶する（設定モーダルの
//   「保存」も「キャンセル」も待たない。キーで変えたのと同じ扱い）。
// ブラウザ: コントロールは出さない。ブラウザ自身の拡大縮小を案内するだけ。
//
// 倍率の実体は Rust が持つ（src-tauri/src/ui_zoom.rs）ので、props で受けて onChange で返す。

import { ChevronDown } from "lucide-react";
import { useT } from "../../i18n";
import { isTauri } from "../../lib/platform";
import { isMacLike } from "../../lib/shortcut-label";
import { setUiZoom } from "../../lib/ui-zoom";
import { SettingSection } from "../settings/SettingSection";
import { formatZoomPercent } from "./format";
import { useUiZoom } from "./use-ui-zoom";
import { ZoomKeys } from "./ZoomKeys";

export type ZoomSettingProps = {
  /** デスクトップアプリか（偽ならブラウザの拡大縮小を案内するだけ） */
  isDesktop: boolean;
  /** 現在の倍率。まだ取れていなければ null */
  level: number | null;
  /** 選べる倍率（Rust の段の表） */
  levels: number[];
  onChange: (level: number) => void;
  /** 「Ctrl + ホイール」の説明を出すか（mac では書かない）。既定は OS から判定 */
  showWheelHint?: boolean;
  /** キーキャップの OS 表記の差し替え（Storybook 用。省略で OS から判定） */
  mac?: boolean;
};

/** 常に見える 1 行の要約 = 一文 + キーキャップの並び（キーの字を文の中に混ぜない） */
function Summary({ text, mac }: { text: string; mac?: boolean }) {
  return (
    <>
      {text}
      <ZoomKeys mac={mac} className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5" />
    </>
  );
}

export function ZoomSetting({
  isDesktop,
  level,
  levels,
  onChange,
  showWheelHint = !isMacLike(),
  mac,
}: ZoomSettingProps) {
  const t = useT();

  if (!isDesktop) {
    return (
      <SettingSection
        title={t("settings.zoom")}
        summary={<Summary text={t("settings.zoom.summaryBrowser")} mac={mac} />}
      />
    );
  }

  return (
    <SettingSection
      title={t("settings.zoom")}
      summary={<Summary text={t("settings.zoom.summary")} mac={mac} />}
      details={
        <ul className="list-disc pl-4 space-y-0.5">
          {showWheelHint && <li>{t("settings.zoom.detailWheel")}</li>}
          <li>{t("settings.zoom.detailRemember")}</li>
          <li>{t("settings.zoom.detailWhole")}</li>
        </ul>
      }
    >
      <div className="relative">
        <select
          value={level === null ? "" : String(level)}
          disabled={level === null}
          aria-label={t("settings.zoom.select")}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full appearance-none rounded-md border border-border bg-background px-3 py-2 pr-8 text-sm text-foreground transition-colors focus:border-primary focus:outline-none disabled:opacity-50"
        >
          {level === null && <option value="" />}
          {levels.map((l) => (
            <option key={l} value={String(l)}>
              {formatZoomPercent(l)}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
      </div>
    </SettingSection>
  );
}

/**
 * 設定モーダルに置く版。倍率の購読と反映までつなぐ。
 * 設定の Settings（localStorage: graphium-settings）には触れない ── フォント・色のように
 * 「保存」で確定する項目ではなく、変えた時点で反映・記憶が済む。
 */
export function ZoomSettingSection() {
  const { level, levels } = useUiZoom();
  return (
    <ZoomSetting
      isDesktop={isTauri()}
      level={level}
      levels={levels}
      onChange={(next) => void setUiZoom(next, "settings")}
    />
  );
}
