// 別ウィンドウの右パネルで、どのタブを開くかを決める（side-peek.tsx の state から切り出した純粋関数）。

/** 開いているタブ id を覚える localStorage のキー。値は id、閉じているときは空文字 */
export const STANDALONE_PANEL_TAB_KEY = "graphium:viewer-window:panel-tab";
/** 旧版（パネルが 1 つだけだった頃）のキー。開いていれば "1" */
export const STANDALONE_PANEL_OPEN_KEY = "graphium:viewer-window:panel-open";

/**
 * 覚えていた値から、いま開くタブの id を決める。閉じているときは null。
 * - 新しいキーがあれば、その id（いまの一覧に無ければ閉じる。ナレッジのページでタブが減った等）
 * - 新しいキーが無く、旧キーが開いていれば、ステップ（prov）を開く。旧版のパネルはステップだけだった。
 *   ステップが一覧に無ければ先頭のタブ
 */
export function resolveStandalonePanelTab(
  storedTab: string | null,
  legacyOpen: string | null,
  ids: readonly string[],
): string | null {
  if (storedTab !== null) return storedTab !== "" && ids.includes(storedTab) ? storedTab : null;
  if (legacyOpen !== "1") return null;
  return ids.includes("prov") ? "prov" : (ids[0] ?? null);
}

/** タブのボタンを押したあとの、覚える値。開いているタブをもう一度押したら閉じる（空文字） */
export function nextStandalonePanelTab(current: string | null, clicked: string): string {
  return current === clicked ? "" : clicked;
}
