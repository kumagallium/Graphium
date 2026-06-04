// ──────────────────────────────────────────────
// コンテキストラベル UI
//
// 構成:
//   LabelBadgeLayer      … position:fixed オーバーレイでラベルを常時表示
//                          ProseMirror の管理DOM内には一切挿入しない
//   LabelSideMenu        … サイドメニューにラベルボタンを追加
//   LabelDropdownPortal  … document.body ポータルのドロップダウン
// ──────────────────────────────────────────────

import { SideMenuExtension } from "@blocknote/core/extensions";
import {
  AddBlockButton,
  DragHandleButton,
  SideMenu,
  useBlockNoteEditor,
  useExtensionState,
} from "@blocknote/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CORE_LABELS,
  FREE_LABEL_EXAMPLES,
  LABEL_SCOPE,
  classifyLabel,
  getHeadingLabelRole,
  STRUCTURAL_LABELS,
  type CoreLabel,
} from "./labels";
// label-attributes は将来のステータス機能で再利用
import { useLabelStore } from "./store";
import { useT, getDisplayLabel } from "../../i18n";
import { Dropdown, DropdownSectionHeader, DropdownDivider } from "@ui/dropdown";
import { MenuItem } from "@ui/menu-item";
import { Button } from "@ui/button";
import { Input } from "@ui/form-field";

// ──────────────────────────────────
// 色定義
// ──────────────────────────────────
const LABEL_COLORS: Record<string, string> = {
  // Section
  procedure: "#5b8fb9",
  // Phase（procedure と関連性のある寒色系の薄め）
  plan: "#7aa6c4",
  result: "#9b7fb8",
  // Inline
  material: "#4B7A52",
  tool: "#c08b3e",
  attribute: "#c08b3e",
  output: "#c26356",
};

function getLabelColor(label: string): string {
  return LABEL_COLORS[label] ?? "#6b7280";
}

/**
 * 指定 blockId のブロックが見出し（heading）かを DOM から判定する。
 * BlockNote は h1-h6 を heading ブロック種別として描画するので、
 * data-id 属性のラッパー内に h1-h6 タグがあれば heading とみなす。
 */
function isHeadingBlock(blockId: string): boolean {
  if (typeof document === "undefined") return false;
  const wrapper =
    document.querySelector(`[data-id="${blockId}"]`) ??
    document.querySelector(`[data-prov-label-anchor="${blockId}"]`)?.closest("[data-id]");
  if (!wrapper) return false;
  return !!wrapper.querySelector("h1, h2, h3, h4, h5, h6");
}

/**
 * 指定 blockId のブロックがテーブルかを DOM から判定する。
 * BlockNote のテーブルブロックはラッパー内に <table> を描画する。
 */
function isTableBlock(blockId: string): boolean {
  if (typeof document === "undefined") return false;
  const wrapper =
    document.querySelector(`[data-id="${blockId}"]`) ??
    document.querySelector(`[data-prov-label-anchor="${blockId}"]`)?.closest("[data-id]");
  if (!wrapper) return false;
  return !!wrapper.querySelector("table");
}

/**
 * 構造テーブルとしてブロックラベルを付与できる entity 系ラベル。
 * テーブルに material / tool / output ブロックラベルを付けると、generator が
 * parseStructuredTable で「列見出し=属性キー / 行=Entity」に展開する。
 * attribute は親 Entity に従属する概念で、テーブル全体への付与は意味を持たないため除外。
 */
const TABLE_BLOCK_LABELS: CoreLabel[] = ["material", "tool", "output"];

/**
 * Phase C (2026-04-29): ラベルバッジドロップダウンも # メニューと同じ context filter をかける。
 *   - 見出しブロック: section / phase ラベル（procedure / plan / result）のみ
 *   - テーブルブロック: material / tool / output（構造テーブルとして列=属性キー・行=Entity に展開）
 *   - その他の本文ブロック: コアラベルは出さない（inline 系はハイライト経路で付与する、Phase C-2 以降）
 *   - 既に inline-type ラベルが付いた既存ブロックは、それを保持できるよう "現在のラベル" は表示する
 */
function getVisibleCoreLabels(blockId: string, currentLabel: string | undefined): CoreLabel[] {
  const heading = isHeadingBlock(blockId);
  const table = !heading && isTableBlock(blockId);
  const allowedScopes = heading ? new Set(["section", "phase"]) : new Set<string>();
  return CORE_LABELS.filter((label) => {
    if (allowedScopes.has(LABEL_SCOPE[label])) return true;
    // テーブルは構造テーブルとして entity 系ラベルをブロックラベルで付与できる
    if (table && TABLE_BLOCK_LABELS.includes(label)) return true;
    // 既存の inline-type ラベルが本文に付いている場合は、外せるように現在のラベルだけ残す
    if (currentLabel === label) return true;
    return false;
  });
}

// ──────────────────────────────────
// LabelBadgeLayer
//
// A方式: ラベルバッジは SideMenu 内に統合。
// LabelBadgeLayer は互換性のため空コンポーネントとして維持。
// ──────────────────────────────────

/** ガター幅（A方式: SideMenu 内表示のためガター不要） */
export const LABEL_GUTTER_WIDTH = 0;

export function LabelBadgeLayer() {
  return null;
}

// ──────────────────────────────────
// LabelDropdownPortal
// Dropdown + MenuItem で構成。
// SideMenu の hover 状態に依存しないため消えない。
// ──────────────────────────────────
// 前手順リンク追加用のグローバルコールバック（main.tsx側で登録）
let _onPrevStepLinkSelected: ((sourceBlockId: string, targetBlockId: string) => void) | null = null;

export function setOnPrevStepLinkSelected(fn: typeof _onPrevStepLinkSelected) {
  _onPrevStepLinkSelected = fn;
}

export function LabelDropdownPortal() {
  const t = useT();
  const { labels, openBlockId, setLabel, closeDropdown } = useLabelStore();
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [freeInput, setFreeInput] = useState("");
  const [prevStepMode, setPrevStepMode] = useState(false);
  const [headingCandidates, setHeadingCandidates] = useState<{ blockId: string; text: string; level: number }[]>([]);

  // ドロップダウンが開いている間、SideMenu を強制表示する
  useEffect(() => {
    if (openBlockId) {
      document.body.setAttribute("data-label-dropdown-open", "true");
    } else {
      document.body.removeAttribute("data-label-dropdown-open");
    }
    return () => {
      document.body.removeAttribute("data-label-dropdown-open");
    };
  }, [openBlockId]);

  // ドロップダウンが開いたとき、アンカー要素の位置に合わせる
  // position: fixed でビューポート座標を使い、画面外に切れないよう調整
  useEffect(() => {
    if (!openBlockId) return;
    const anchor =
      document.querySelector(`[data-prov-label-anchor="${openBlockId}"]`);
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();
    let top = rect.bottom + 4;
    let left = rect.left;

    // ビューポート下端に収まらない場合は上に表示
    const dropdownHeight = 400; // 推定最大高さ
    if (top + dropdownHeight > window.innerHeight) {
      top = Math.max(8, rect.top - dropdownHeight - 4);
    }
    // 左端がはみ出す場合
    if (left + 220 > window.innerWidth) {
      left = window.innerWidth - 228;
    }
    if (left < 4) left = 4;

    setPos({ top, left });
    setFreeInput("");
    setPrevStepMode(false);
  }, [openBlockId]);

  if (!openBlockId) return null;

  const currentLabel = labels.get(openBlockId);

  const select = (label: string | null) => {
    setLabel(openBlockId, label);
    closeDropdown();
  };

  const visibleCoreLabels = getVisibleCoreLabels(openBlockId, currentLabel);

  return (
    <Dropdown position={pos} onClose={closeDropdown} minWidth={200}>
      <div className="py-1.5">
        {/* コアラベル（context filter 適用：見出しは section/phase、本文は core 非表示） */}
        {visibleCoreLabels.length > 0 && (
          <DropdownSectionHeader>{t("labelUi.coreLabels")}</DropdownSectionHeader>
        )}
        {visibleCoreLabels.map((label) => {
          const active = currentLabel === label;
          const color = getLabelColor(label);
          return (
            <MenuItem
              key={label}
              active={active}
              dotColor={color}
              onClick={() => select(active ? null : label)}
              style={{ color: active ? color : undefined }}
            >
              {getDisplayLabel(label)}
            </MenuItem>
          );
        })}

        {/* 前手順リンク（procedure ラベル付きの見出しブロックでのみ表示） */}
        {currentLabel === "procedure" && isHeadingBlock(openBlockId) && (
          <>
            <DropdownDivider />
            <DropdownSectionHeader className="text-[#5b8fb9]">
              {t("labelUi.prevStepLink")}
            </DropdownSectionHeader>
            <button
              onClick={() => {
                // 見出し候補を取得してモード切替
                const candidates: { blockId: string; text: string; level: number }[] = [];
                document.querySelectorAll('[data-node-type="blockOuter"]').forEach((el) => {
                  const blockId = el.getAttribute("data-id");
                  if (!blockId || blockId === openBlockId) return;
                  const h2 = el.querySelector("h2");
                  const h1 = el.querySelector("h1");
                  if (h2) candidates.push({ blockId, text: h2.textContent || "", level: 2 });
                  else if (h1) candidates.push({ blockId, text: h1.textContent || "", level: 1 });
                });
                setHeadingCandidates(candidates);
                setPrevStepMode(true);
              }}
              className="flex items-center w-full text-left px-3 py-1.5 text-sm bg-info/10 text-[#5b8fb9] rounded mx-1.5 cursor-pointer border-none"
              style={{ width: "calc(100% - 12px)" }}
            >
              <span className="mr-1">→</span>
              {t("labelUi.selectPrevStep")}
            </button>
          </>
        )}

        {/* 前手順: 見出し選択サブメニュー */}
        {prevStepMode && (
          <div className="py-1 bg-info/5 border-t border-info/20">
            <DropdownSectionHeader className="text-[#5b8fb9]">
              {t("labelUi.selectHeading")}
            </DropdownSectionHeader>
            {headingCandidates.length === 0 && (
              <div className="px-3 py-1.5 text-xs text-muted-foreground">{t("provIndicator.noHeadings")}</div>
            )}
            {headingCandidates.map((c) => (
              <MenuItem
                key={c.blockId}
                onClick={() => {
                  if (openBlockId) {
                    _onPrevStepLinkSelected?.(openBlockId, c.blockId);
                  }
                  closeDropdown();
                }}
                className="text-xs"
              >
                <span className="text-[10px] text-[#60a5fa] font-bold mr-1">
                  H{c.level}
                </span>
                {c.text || t("labelUi.emptyHeading")}
              </MenuItem>
            ))}
            <MenuItem
              onClick={() => setPrevStepMode(false)}
              className="text-xs text-muted-foreground"
            >
              {t("labelUi.goBack")}
            </MenuItem>
          </div>
        )}

        {/* フリーラベル例（上にコアラベル or 前ステップリンク UI がある時だけ divider） */}
        {(visibleCoreLabels.length > 0 || (currentLabel === "procedure" && isHeadingBlock(openBlockId))) && (
          <DropdownDivider />
        )}
        <DropdownSectionHeader>{t("labelUi.freeLabels")}</DropdownSectionHeader>
        {FREE_LABEL_EXAMPLES.slice(0, 4).map((label) => {
          const active = currentLabel === label;
          return (
            <MenuItem
              key={label}
              active={active}
              onClick={() => select(active ? null : label)}
              className="text-muted-foreground"
            >
              {getDisplayLabel(label)}
            </MenuItem>
          );
        })}

        {/* カスタム入力 */}
        <DropdownDivider />
        <div className="px-2.5 py-1.5">
          <DropdownSectionHeader>{t("labelUi.custom")}</DropdownSectionHeader>
          <div className="flex gap-1 mt-0.5">
            <Input
              autoFocus
              value={freeInput}
              onChange={(e) => setFreeInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && freeInput.trim()) {
                  select(freeInput.trim());
                }
                if (e.key === "Escape") closeDropdown();
              }}
              placeholder={t("labelUi.placeholder")}
              className="text-xs py-1 px-1.5"
            />
            <Button
              size="sm"
              onClick={() => {
                if (freeInput.trim()) {
                  select(freeInput.trim());
                }
              }}
              className="text-xs shrink-0"
            >
              {t("common.add")}
            </Button>
          </div>
        </div>

        {/* ラベル削除 */}
        {currentLabel && (
          <>
            <DropdownDivider />
            <MenuItem
              onClick={() => select(null)}
              className="text-destructive"
            >
              {t("labelUi.removeLabel")}
            </MenuItem>
          </>
        )}
      </div>
    </Dropdown>
  );
}

// ──────────────────────────────────
// LabelSideMenuButton
// A方式: SideMenu 内にラベルバッジ or # ボタンを表示。
// ラベル設定済み → バッジ表示（クリックで変更）
// ラベル未設定 → # ボタン（クリックで付与）
// ──────────────────────────────────
export function LabelSideMenuButton() {
  const t = useT();
  const editor = useBlockNoteEditor<any, any, any>();
  const { getLabel, openDropdown } = useLabelStore();

  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  });

  if (!block) return null;

  const label = getLabel(block.id);

  if (label) {
    // ラベル設定済み: バッジ表示（Crucible デザインガイドライン準拠: rounded-full）
    const color = getLabelColor(label);
    return (
      <span
        onClick={() => openDropdown(block.id)}
        data-prov-label-anchor={block.id}
        title={t("labelUi.clickToChange", { label: getDisplayLabel(label) })}
        className="inline-block rounded-full text-xs font-semibold cursor-pointer select-none whitespace-nowrap"
        style={{
          padding: "0px 6px",
          backgroundColor: color + "18",
          color: color,
          border: `1px solid ${color}38`,
          lineHeight: 1.6,
        }}
      >
        {getDisplayLabel(label)}
      </span>
    );
  }

  // ラベル未設定: # ボタン
  return (
    <button
      onClick={() => openDropdown(block.id)}
      data-prov-label-anchor={block.id}
      title={t("labelUi.addLabel")}
      className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-lg border border-dashed border-border bg-transparent cursor-pointer text-muted-foreground text-xs leading-none hover:border-primary hover:text-primary transition-colors duration-200"
    >
      #
    </button>
  );
}

// カスタムSideMenu（デフォルト + ラベルボタン）
export function LabelSideMenu() {
  return (
    <SideMenu>
      <LabelSideMenuButton />
      <AddBlockButton />
      <DragHandleButton />
    </SideMenu>
  );
}
