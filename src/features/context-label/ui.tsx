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
import { createPortal } from "react-dom";
import {
  CORE_LABELS,
  FREE_LABEL_EXAMPLES,
  classifyLabel,
  getHeadingLabelRole,
  STRUCTURAL_LABELS,
} from "./labels";
// label-attributes は将来のステータス機能で再利用
import { useLabelStore } from "./store";

// ──────────────────────────────────
// 色定義
// ──────────────────────────────────
const LABEL_COLORS: Record<string, string> = {
  "[手順]": "#3b82f6",
  "[使用したもの]": "#10b981",
  "[条件]": "#f59e0b",
  "[試料]": "#8b5cf6",
  "[結果]": "#ef4444",
};

function getLabelColor(label: string): string {
  return LABEL_COLORS[label] ?? "#6b7280";
}

// ──────────────────────────────────
// LabelBadgeLayer（マージン埋め込み方式）
//
// エディタのラッパーに padding-left を確保し、
// その左マージン領域に position:absolute でバッジを配置する。
// DOMフローに乗るためスクロール追従が自動で、はみ出しが構造的に不可能。
// ──────────────────────────────────

/** エディタラッパー用の定数 */
export const LABEL_GUTTER_WIDTH = 100; // px: ラベル表示領域の幅

type BadgeInfo = {
  blockId: string;
  label: string;
  top: number;   // ラッパー内の offsetTop
};

export function LabelBadgeLayer() {
  const { labels, openDropdown } = useLabelStore();
  const [badges, setBadges] = useState<BadgeInfo[]>([]);
  const wrapperRef = useRef<HTMLElement | null>(null);

  const compute = useCallback(() => {
    // ラッパー要素を取得（data-label-wrapper 属性で識別）
    const wrapper = document.querySelector("[data-label-wrapper]") as HTMLElement | null;
    if (!wrapper) return;
    wrapperRef.current = wrapper;

    const wrapperRect = wrapper.getBoundingClientRect();
    const next: BadgeInfo[] = [];

    for (const [blockId, label] of labels) {
      const el = wrapper.querySelector(
        `[data-id="${blockId}"][data-node-type="blockOuter"]`
      ) as HTMLElement | null;
      if (!el) continue;

      const elRect = el.getBoundingClientRect();
      if (elRect.height === 0) continue;

      // ブロックの先頭行に合わせる（ネストしたブロックでもずれない）
      // blockOuter 内の最初のテキスト要素を探して、その位置を使う
      const firstContent = el.querySelector("h1, h2, h3, p, li, td") as HTMLElement | null;
      const targetRect = firstContent ? firstContent.getBoundingClientRect() : elRect;
      const top = targetRect.top - wrapperRect.top + wrapper.scrollTop + targetRect.height / 2;
      next.push({ blockId, label, top });
    }
    setBadges(next);
  }, [labels]);

  // labels 変化時に再計算
  useEffect(() => {
    const raf = requestAnimationFrame(compute);
    return () => cancelAnimationFrame(raf);
  }, [compute]);

  // エディタ内のDOM変更で再計算
  useEffect(() => {
    const wrapper = document.querySelector("[data-label-wrapper]");
    if (!wrapper) return;

    let rafId: number | null = null;
    const observer = new MutationObserver(() => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(compute);
    });
    observer.observe(wrapper, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // スクロール時も再計算（ラッパー自体のスクロール）
    wrapper.addEventListener("scroll", compute);

    return () => {
      observer.disconnect();
      wrapper.removeEventListener("scroll", compute);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [compute]);

  if (badges.length === 0) return null;

  // ラッパー内にポータルで描画（ラッパーが position:relative なので absolute が効く）
  const wrapper = wrapperRef.current ?? document.querySelector("[data-label-wrapper]");
  if (!wrapper) return null;

  return createPortal(
    <>
      {badges.map(({ blockId, label, top }) => {
        return (
          <div
            key={blockId}
            style={{
              position: "absolute",
              top,
              left: 4,
              transform: "translateY(-50%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-start",
              gap: 3,
              pointerEvents: "auto",
              whiteSpace: "nowrap",
            }}
          >
            {/* ラベルバッジ本体 */}
            <span
              data-prov-label-anchor={blockId}
              onClick={() => openDropdown(blockId)}
              title={`${label} — クリックで変更`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                padding: "1px 6px",
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 600,
                backgroundColor: getLabelColor(label) + "18",
                color: getLabelColor(label),
                border: `1px solid ${getLabelColor(label)}38`,
                cursor: "pointer",
                userSelect: "none",
                lineHeight: 1.6,
              }}
            >
              {label}
            </span>
          </div>
        );
      })}
    </>,
    wrapper
  );
}

// ──────────────────────────────────
// LabelDropdownPortal
// document.body にポータルで出すドロップダウン。
// SideMenu の hover 状態に依存しないため消えない。
// ──────────────────────────────────
// 前手順リンク追加用のグローバルコールバック（main.tsx側で登録）
let _onPrevStepLinkSelected: ((sourceBlockId: string, targetBlockId: string) => void) | null = null;

export function setOnPrevStepLinkSelected(fn: typeof _onPrevStepLinkSelected) {
  _onPrevStepLinkSelected = fn;
}

export function LabelDropdownPortal() {
  const { labels, openBlockId, setLabel, closeDropdown } = useLabelStore();
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [freeInput, setFreeInput] = useState("");
  const [prevStepMode, setPrevStepMode] = useState(false);
  const [headingCandidates, setHeadingCandidates] = useState<{ blockId: string; text: string; level: number }[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  // ドロップダウンが開いたとき、バッジ要素の位置に合わせる
  useEffect(() => {
    if (!openBlockId) return;
    const anchor = document.querySelector(
      `[data-prov-label-anchor="${openBlockId}"]`
    );
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      // ドロップダウンは position:absolute (document座標)
      setPos({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
      });
    } else {
      // バッジが非表示の場合（ラベル未設定 = SideMenuボタンがアンカー）
      // SideMenuボタンの位置を使う
      const sideAnchor = document.querySelector(
        `[data-prov-label-anchor="${openBlockId}"]`
      );
      if (sideAnchor) {
        const rect = sideAnchor.getBoundingClientRect();
        setPos({
          top: rect.bottom + window.scrollY + 4,
          left: rect.left + window.scrollX,
        });
      }
    }
    setFreeInput("");
    setPrevStepMode(false);
  }, [openBlockId]);

  // 外側クリックで閉じる
  useEffect(() => {
    if (!openBlockId) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        closeDropdown();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openBlockId, closeDropdown]);

  if (!openBlockId) return null;

  const currentLabel = labels.get(openBlockId);

  const select = (label: string | null) => {
    setLabel(openBlockId, label);
    closeDropdown();
  };

  return createPortal(
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: pos.top,
        left: pos.left,
        zIndex: 9999,
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        boxShadow: "0 4px 20px rgba(0,0,0,0.14)",
        padding: "6px 0",
        minWidth: 200,
      }}
    >
      {/* コアラベル */}
      <div style={sectionHeaderStyle}>コアラベル（PROV-DM）</div>
      {CORE_LABELS.map((label) => {
        const active = currentLabel === label;
        const color = getLabelColor(label);
        return (
          <button
            key={label}
            onClick={() => select(active ? null : label)}
            style={{
              ...menuItemStyle,
              background: active ? color + "15" : "none",
              color: active ? color : "#374151",
              fontWeight: active ? 600 : 400,
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: color,
                marginRight: 6,
                flexShrink: 0,
              }}
            />
            {label}
            {active && (
              <span style={{ marginLeft: "auto", fontSize: 11 }}>✓</span>
            )}
          </button>
        );
      })}

      {/* 前手順リンク */}
      <div style={dividerStyle} />
      <div style={{ ...sectionHeaderStyle, color: "#3b82f6" }}>前手順リンク（wasInformedBy）</div>
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
        style={{
          ...menuItemStyle,
          color: "#3b82f6",
          background: "#eff6ff",
          borderRadius: 4,
          margin: "2px 6px",
          width: "calc(100% - 12px)",
        }}
      >
        <span style={{ marginRight: 4 }}>→</span>
        前の手順を選択してリンク
      </button>

      {/* 前手順: 見出し選択サブメニュー */}
      {prevStepMode && (
        <div style={{ padding: "4px 0", background: "#f0f9ff", borderTop: "1px solid #e0f2fe" }}>
          <div style={{ ...sectionHeaderStyle, color: "#3b82f6" }}>
            リンク先の見出しを選択
          </div>
          {headingCandidates.length === 0 && (
            <div style={{ padding: "6px 12px", fontSize: 12, color: "#9ca3af" }}>見出しがありません</div>
          )}
          {headingCandidates.map((c) => (
            <button
              key={c.blockId}
              onClick={() => {
                if (openBlockId) {
                  _onPrevStepLinkSelected?.(openBlockId, c.blockId);
                }
                closeDropdown();
              }}
              style={{
                ...menuItemStyle,
                color: "#1e40af",
                fontSize: 12,
              }}
            >
              <span style={{ fontSize: 10, color: "#60a5fa", fontWeight: 700, marginRight: 4 }}>
                H{c.level}
              </span>
              {c.text || "(空の見出し)"}
            </button>
          ))}
          <button
            onClick={() => setPrevStepMode(false)}
            style={{ ...menuItemStyle, fontSize: 11, color: "#9ca3af" }}
          >
            ← 戻る
          </button>
        </div>
      )}

      {/* フリーラベル例 */}
      <div style={dividerStyle} />
      <div style={sectionHeaderStyle}>フリーラベル（例）</div>
      {FREE_LABEL_EXAMPLES.slice(0, 4).map((label) => {
        const active = currentLabel === label;
        return (
          <button
            key={label}
            onClick={() => select(active ? null : label)}
            style={{
              ...menuItemStyle,
              color: "#6b7280",
              fontWeight: active ? 600 : 400,
            }}
          >
            {label}
            {active && (
              <span style={{ marginLeft: "auto", fontSize: 11 }}>✓</span>
            )}
          </button>
        );
      })}

      {/* カスタム入力 */}
      <div style={dividerStyle} />
      <div style={{ padding: "4px 10px 6px" }}>
        <div style={sectionHeaderStyle}>カスタム</div>
        <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
          <input
            autoFocus
            value={freeInput}
            onChange={(e) => setFreeInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && freeInput.trim()) {
                const v = freeInput.trim();
                select(v.startsWith("[") ? v : `[${v}]`);
              }
              if (e.key === "Escape") closeDropdown();
            }}
            placeholder="[ラベル名]"
            style={{
              flex: 1,
              fontSize: 12,
              padding: "3px 6px",
              border: "1px solid #d1d5db",
              borderRadius: 4,
              outline: "none",
            }}
          />
          <button
            onClick={() => {
              if (freeInput.trim()) {
                const v = freeInput.trim();
                select(v.startsWith("[") ? v : `[${v}]`);
              }
            }}
            style={{
              padding: "3px 8px",
              fontSize: 12,
              background: "#3b82f6",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            追加
          </button>
        </div>
      </div>

      {/* ラベル削除 */}
      {currentLabel && (
        <>
          <div style={dividerStyle} />
          <button
            onClick={() => select(null)}
            style={{ ...menuItemStyle, color: "#ef4444" }}
          >
            ラベルを外す
          </button>
        </>
      )}
    </div>,
    document.body
  );
}

// ──────────────────────────────────
// LabelSideMenuButton
// ラベル未設定ブロックに「#」ボタンを表示する。
// ラベル設定済みは LabelBadgeLayer が常時表示するのでここには出さない。
// ──────────────────────────────────
export function LabelSideMenuButton() {
  const editor = useBlockNoteEditor<any, any, any>();
  const { getLabel, openDropdown } = useLabelStore();

  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  });

  if (!block) return null;

  const label = getLabel(block.id);

  // 見出しブロックのロールヒント
  const headingRole =
    block.type === "heading" && label
      ? getHeadingLabelRole((block.props as any).level, label)
      : null;

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      {!label && (
        // ラベル未設定: #ボタンを表示、アンカー属性でドロップダウンの位置合わせ用
        <button
          onClick={() => openDropdown(block.id)}
          data-prov-label-anchor={block.id}
          title="ラベルを付ける"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            borderRadius: 4,
            border: "1px dashed #d1d5db",
            background: "none",
            cursor: "pointer",
            color: "#9ca3af",
            fontSize: 12,
            lineHeight: 1,
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget;
            el.style.borderColor = "#3b82f6";
            el.style.color = "#3b82f6";
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget;
            el.style.borderColor = "#d1d5db";
            el.style.color = "#9ca3af";
          }}
        >
          #
        </button>
      )}

      {/* 見出しロールのヒント（ラベル設定済み時のみ） */}
      {headingRole && (
        <span style={{ fontSize: 9, color: "#9ca3af", whiteSpace: "nowrap" }}>
          {headingRole === "section-marker" ? "§" : "▶"}
        </span>
      )}
    </div>
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

// ──────────────────────────────────
// スタイル定数
// ──────────────────────────────────
const sectionHeaderStyle: React.CSSProperties = {
  padding: "2px 10px",
  fontSize: 10,
  fontWeight: 700,
  color: "#9ca3af",
  letterSpacing: "0.05em",
  textTransform: "uppercase",
};

const menuItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  textAlign: "left",
  padding: "5px 12px",
  fontSize: 13,
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "#374151",
};

const dividerStyle: React.CSSProperties = {
  borderTop: "1px solid #f3f4f6",
  margin: "4px 0",
};
