// ──────────────────────────────────────────────
// ProvIndicatorLayer
//
// エディタ右側に position:fixed オーバーレイで
// 各ブロックの PROV ラベルを表示する。
// クリックで統合パネル（ラベル変更 + リンク一覧 + リンク追加）を開く。
// ──────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLabelStore } from "./store";
import { useLinkStore } from "../block-link/store";
import {
  CORE_LABELS,
  FREE_LABEL_EXAMPLES,
} from "./labels";
import {
  LINK_TYPE_CONFIG,
  CREATED_BY_LABELS,
  type BlockLink,
} from "../block-link/link-types";

// ──────────────────────────────────
// 色定義
// ──────────────────────────────────
const LABEL_COLORS: Record<string, string> = {
  "[手順]": "#5b8fb9",
  "[使用したもの]": "#4B7A52",
  "[属性]": "#c08b3e",
  "[試料]": "#8b7ab5",
  "[結果]": "#c26356",
  "[条件]": "#c08b3e",
};

function getLabelColor(label: string): string {
  return LABEL_COLORS[label] ?? "#6b7280";
}

// ──────────────────────────────────
// ブロックのテキスト取得ヘルパー
// ──────────────────────────────────
function getBlockText(blockId: string): string {
  const el = document.querySelector(
    `[data-id="${blockId}"][data-node-type="blockOuter"]`
  );
  if (!el) return blockId.slice(0, 8);
  const heading = el.querySelector("h1, h2, h3");
  if (heading) return heading.textContent || "(空)";
  const para = el.querySelector("[data-content-type]");
  if (para) {
    const text = para.textContent || "";
    return text.length > 30 ? text.slice(0, 30) + "…" : text || "(空)";
  }
  return blockId.slice(0, 8);
}

// ──────────────────────────────────
// 前手順リンク追加用のグローバルコールバック
// ──────────────────────────────────
let _onPrevStepLinkSelected:
  | ((sourceBlockId: string, targetBlockId: string) => void)
  | null = null;

export function setOnPrevStepLinkSelected(
  fn: typeof _onPrevStepLinkSelected
) {
  _onPrevStepLinkSelected = fn;
}

// ──────────────────────────────────
// 型定義
// ──────────────────────────────────
type IndicatorInfo = {
  blockId: string;
  top: number;
  left: number;
  label: string | undefined;
  outgoing: BlockLink[];
  incoming: BlockLink[];
};

// エディタラッパーの表示範囲（ラベルをクリップするため）
type ClipBounds = { top: number; bottom: number };

// ──────────────────────────────────
// ProvIndicatorLayer
// ──────────────────────────────────
export function ProvIndicatorLayer() {
  const { labels, getLabel, setLabel, openBlockId } = useLabelStore();
  const { links, getOutgoing, getIncoming, removeLink } = useLinkStore();
  const [indicators, setIndicators] = useState<IndicatorInfo[]>([]);
  const [clipBounds, setClipBounds] = useState<ClipBounds>({ top: 0, bottom: 9999 });
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);

  // ラベルまたはリンクを持つブロックの位置を計算
  const compute = useCallback(() => {
    // ラベル or リンクを持つブロック ID を収集
    const blockIds = new Set<string>();
    labels.forEach((_label, blockId) => blockIds.add(blockId));
    links.forEach((l) => {
      blockIds.add(l.sourceBlockId);
      blockIds.add(l.targetBlockId);
    });

    // エディタラッパーの右端を取得（サイドバーとの境界）
    const wrapper = document.querySelector("[data-label-wrapper]");
    if (!wrapper) return;
    const wrapperRect = wrapper.getBoundingClientRect();
    // サイドバー境界の左にラベルを配置（8px の余白）
    const indicatorLeft = wrapperRect.right - 8;
    // ラベルの表示範囲をエディタラッパー内に制限
    setClipBounds({ top: wrapperRect.top, bottom: wrapperRect.bottom });

    const next: IndicatorInfo[] = [];
    blockIds.forEach((blockId) => {
      const outer = document.querySelector(
        `[data-id="${blockId}"][data-node-type="blockOuter"]`
      ) as HTMLElement | null;
      if (!outer) return;

      // コンテンツ部分（bn-block-content）の位置を使う
      // blockOuter は子ブロックを含むため高さが大きくなり、位置がずれる
      const content = outer.querySelector(".bn-block-content") as HTMLElement | null;
      const rect = content ? content.getBoundingClientRect() : outer.getBoundingClientRect();
      if (rect.height === 0) return;

      const label = getLabel(blockId);
      const outgoing = getOutgoing(blockId);
      const incoming = getIncoming(blockId);

      // ラベルもリンクもないブロックはスキップ
      if (!label && outgoing.length === 0 && incoming.length === 0) return;

      next.push({
        blockId,
        top: rect.top + rect.height / 2,
        left: indicatorLeft,
        label,
        outgoing,
        incoming,
      });
    });
    setIndicators(next);
  }, [labels, links, getLabel, getOutgoing, getIncoming]);

  useEffect(() => {
    const raf = requestAnimationFrame(compute);
    return () => cancelAnimationFrame(raf);
  }, [compute]);

  useEffect(() => {
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
    };
  }, [compute]);

  // ドロップダウンが開いているときは activeBlockId を連動
  useEffect(() => {
    if (openBlockId) setActiveBlockId(openBlockId);
  }, [openBlockId]);

  // ホバー中のブロック ID（ブロック本体 or ラベルバッジのホバーで設定）
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);

  // エディタ内のブロックホバーを監視（全ブロック対象）
  useEffect(() => {
    const wrapper = document.querySelector("[data-label-wrapper]");
    if (!wrapper) return;

    const handleOver = (e: Event) => {
      const target = (e as MouseEvent).target as HTMLElement;
      const blockOuter = target.closest('[data-node-type="blockOuter"]') as HTMLElement | null;
      if (!blockOuter) {
        setHoveredBlockId(null);
        return;
      }
      const blockId = blockOuter.getAttribute("data-id");
      setHoveredBlockId(blockId || null);
    };

    const handleOut = (e: Event) => {
      const related = (e as MouseEvent).relatedTarget as HTMLElement | null;
      if (!related?.closest('[data-node-type="blockOuter"]')) {
        setHoveredBlockId(null);
      }
    };

    wrapper.addEventListener("mouseover", handleOver);
    wrapper.addEventListener("mouseout", handleOut);
    return () => {
      wrapper.removeEventListener("mouseover", handleOver);
      wrapper.removeEventListener("mouseout", handleOut);
    };
  }, []);

  // ホバー中のブロックの矩形を計算
  const hoverOverlay = (() => {
    if (!hoveredBlockId) return null;
    const outer = document.querySelector(
      `[data-id="${hoveredBlockId}"][data-node-type="blockOuter"]`
    ) as HTMLElement | null;
    if (!outer) return null;
    const content = outer.querySelector(".bn-block-content") as HTMLElement | null;
    return (content || outer).getBoundingClientRect();
  })();

  if (indicators.length === 0) return null;

  return createPortal(
    <>
      {/* ホバーハイライトオーバーレイ（全ブロック共通色） */}
      {hoverOverlay && (
        <div
          style={{
            position: "fixed",
            top: hoverOverlay.top - 2,
            left: hoverOverlay.left - 4,
            width: hoverOverlay.width + 8,
            height: hoverOverlay.height + 4,
            borderRadius: 6,
            background: "rgba(75, 122, 82, 0.05)",
            border: "1.5px solid rgba(75, 122, 82, 0.15)",
            pointerEvents: "none",
            zIndex: 9996,
          }}
        />
      )}
      {indicators.map(({ blockId, top, left, label, outgoing, incoming }) => {
        const isActive = activeBlockId === blockId;
        const color = label ? getLabelColor(label) : undefined;

        // ラベルがないブロックは右側に何も表示しない
        if (!label) return null;

        // エディタラッパーの表示範囲外はスキップ（ヘッダーに重ならないよう）
        if (top < clipBounds.top || top > clipBounds.bottom) return null;

        return (
          <div key={blockId}>
            {/* ラベルバッジ（右揃え: transform で右端に合わせる） */}
            <button
              onClick={() =>
                setActiveBlockId(isActive ? null : blockId)
              }
              onPointerEnter={() => setHoveredBlockId(blockId)}
              onPointerLeave={() => setHoveredBlockId(null)}
              data-prov-label-anchor={blockId}
              title={`${label} — クリックで詳細`}
              style={{
                position: "fixed",
                top,
                right: window.innerWidth - left,
                transform: "translateY(-50%)",
                zIndex: 9997,
                display: "inline-block",
                padding: "0px 6px",
                borderRadius: 9999,
                fontSize: 11,
                fontWeight: 600,
                backgroundColor: color + "18",
                color: color,
                border: `1px solid ${color}38`,
                cursor: "pointer",
                userSelect: "none",
                lineHeight: 1.6,
                whiteSpace: "nowrap",
                pointerEvents: "auto",
              }}
            >
              {label}
            </button>

            {/* 統合パネル */}
            {isActive && (
              <ProvPanel
                blockId={blockId}
                top={top + 14}
                left={left}
                label={label}
                outgoing={outgoing}
                incoming={incoming}
                onClose={() => setActiveBlockId(null)}
                onLabelChange={(newLabel) => {
                  setLabel(blockId, newLabel);
                  if (newLabel === null) setActiveBlockId(null);
                }}
                onRemoveLink={removeLink}
              />
            )}
          </div>
        );
      })}
    </>,
    document.body
  );
}

// ──────────────────────────────────
// ProvPanel（統合パネル）
// ラベル変更 + リンク一覧 + リンク追加を1パネルに集約
// ──────────────────────────────────
function ProvPanel({
  blockId,
  top,
  left,
  label,
  outgoing,
  incoming,
  onClose,
  onLabelChange,
  onRemoveLink,
}: {
  blockId: string;
  top: number;
  left: number;
  label: string | undefined;
  outgoing: BlockLink[];
  incoming: BlockLink[];
  onClose: () => void;
  onLabelChange: (label: string | null) => void;
  onRemoveLink: (linkId: string) => void;
}) {
  const { labels: allLabels } = useLabelStore();
  const useLabelStoreRef = { current: allLabels };
  const ref = useRef<HTMLDivElement>(null);
  const [showLabelPicker, setShowLabelPicker] = useState(false);
  const [prevStepMode, setPrevStepMode] = useState(false);
  const [headingCandidates, setHeadingCandidates] = useState<
    { blockId: string; text: string }[]
  >([]);
  const [freeInput, setFreeInput] = useState("");

  // 外側クリックで閉じる
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handler);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  // パネル位置の調整（画面端対応）
  const adjustedTop = Math.min(top, window.innerHeight - 400);
  const adjustedLeft = Math.min(left, window.innerWidth - 260);

  const linkCount = outgoing.length + incoming.length;
  const color = label ? getLabelColor(label) : "#9ca3af";

  const scrollToBlock = (targetId: string) => {
    const el = document.querySelector(
      `[data-id="${targetId}"][data-node-type="blockOuter"]`
    );
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      (el as HTMLElement).style.outline = "2px solid #5b8fb9";
      setTimeout(() => {
        (el as HTMLElement).style.outline = "";
      }, 1500);
    }
  };

  return createPortal(
    <div
      ref={ref}
      style={{
        position: "fixed",
        top: adjustedTop,
        left: adjustedLeft,
        zIndex: 9999,
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        boxShadow: "0 4px 20px rgba(0,0,0,0.14)",
        padding: "6px 0",
        minWidth: 240,
        maxHeight: "70vh",
        overflowY: "auto",
      }}
    >
      {/* ── 現在のラベル表示 + 変更ボタン ── */}
      <div
        style={{
          padding: "6px 12px 4px",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {label ? (
          <span
            style={{
              display: "inline-block",
              padding: "0px 6px",
              borderRadius: 9999,
              fontSize: 11,
              fontWeight: 600,
              backgroundColor: color + "18",
              color: color,
              border: `1px solid ${color}38`,
              lineHeight: 1.6,
            }}
          >
            {label}
          </span>
        ) : (
          <span style={{ fontSize: 11, color: "#9ca3af" }}>ラベルなし</span>
        )}
        <button
          onClick={() => setShowLabelPicker(!showLabelPicker)}
          style={{
            marginLeft: "auto",
            fontSize: 10,
            color: "#5b8fb9",
            background: "none",
            border: "none",
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          {showLabelPicker ? "閉じる" : "変更"}
        </button>
      </div>

      {/* ── ラベル選択（展開時） ── */}
      {showLabelPicker && (
        <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 4 }}>
          <div style={sectionHeaderStyle}>コアラベル（PROV-DM）</div>
          {CORE_LABELS.map((l) => {
            const active = label === l;
            const c = getLabelColor(l);
            return (
              <button
                key={l}
                onClick={() => {
                  onLabelChange(active ? null : l);
                  setShowLabelPicker(false);
                }}
                style={{
                  ...menuItemStyle,
                  background: active ? c + "15" : "none",
                  color: active ? c : "#374151",
                  fontWeight: active ? 600 : 400,
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: c,
                    marginRight: 6,
                    flexShrink: 0,
                  }}
                />
                {l}
                {active && (
                  <span style={{ marginLeft: "auto", fontSize: 11 }}>✓</span>
                )}
              </button>
            );
          })}

          {/* フリーラベル例 */}
          <div style={dividerStyle} />
          <div style={sectionHeaderStyle}>フリーラベル（例）</div>
          {FREE_LABEL_EXAMPLES.slice(0, 4).map((l) => {
            const active = label === l;
            return (
              <button
                key={l}
                onClick={() => {
                  onLabelChange(active ? null : l);
                  setShowLabelPicker(false);
                }}
                style={{
                  ...menuItemStyle,
                  color: "#6b7280",
                  fontWeight: active ? 600 : 400,
                }}
              >
                {l}
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
                value={freeInput}
                onChange={(e) => setFreeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && freeInput.trim()) {
                    const v = freeInput.trim();
                    onLabelChange(v.startsWith("[") ? v : `[${v}]`);
                    setShowLabelPicker(false);
                  }
                  if (e.key === "Escape") setShowLabelPicker(false);
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
                    onLabelChange(v.startsWith("[") ? v : `[${v}]`);
                    setShowLabelPicker(false);
                  }
                }}
                style={{
                  padding: "3px 8px",
                  fontSize: 12,
                  background: "#5b8fb9",
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
          {label && (
            <>
              <div style={dividerStyle} />
              <button
                onClick={() => {
                  onLabelChange(null);
                  setShowLabelPicker(false);
                }}
                style={{ ...menuItemStyle, color: "#c26356" }}
              >
                ラベルを外す
              </button>
            </>
          )}
        </div>
      )}

      {/* ── リンク一覧 ── */}
      {linkCount > 0 && (
        <>
          <div style={dividerStyle} />
          {outgoing.length > 0 && (
            <>
              <div style={sectionHeaderStyle}>→ 出力リンク</div>
              {outgoing.map((link) => (
                <LinkRow
                  key={link.id}
                  link={link}
                  label={getBlockText(link.targetBlockId)}
                  onClick={() => scrollToBlock(link.targetBlockId)}
                  onRemove={() => onRemoveLink(link.id)}
                />
              ))}
            </>
          )}
          {incoming.length > 0 && (
            <>
              {outgoing.length > 0 && <div style={dividerStyle} />}
              <div style={sectionHeaderStyle}>← 入力リンク</div>
              {incoming.map((link) => (
                <LinkRow
                  key={link.id}
                  link={link}
                  label={getBlockText(link.sourceBlockId)}
                  onClick={() => scrollToBlock(link.sourceBlockId)}
                  onRemove={() => onRemoveLink(link.id)}
                />
              ))}
            </>
          )}
        </>
      )}

      {/* ── 前手順リンク追加（[手順] ラベルのみ） ── */}
      {label === "[手順]" && <>
      <div style={dividerStyle} />
      <div style={{ ...sectionHeaderStyle, color: "#5b8fb9" }}>
        前手順リンク（wasInformedBy）
      </div>
      <button
        onClick={() => {
          const candidates: {
            blockId: string;
            text: string;
          }[] = [];
          // [手順] ラベルが付いたブロックのみをリンク先候補にする
          const labelMap = useLabelStoreRef.current;
          document
            .querySelectorAll('[data-node-type="blockOuter"]')
            .forEach((el) => {
              const bid = el.getAttribute("data-id");
              if (!bid || bid === blockId) return;
              if (labelMap.get(bid) !== "[手順]") return;
              // テキストを取得
              const heading = el.querySelector("h1, h2, h3");
              const text = heading?.textContent
                || el.querySelector("[data-content-type]")?.textContent
                || "";
              candidates.push({
                blockId: bid,
                text: text || "(空)",
              });
            });
          setHeadingCandidates(candidates);
          setPrevStepMode(true);
        }}
        style={{
          ...menuItemStyle,
          color: "#5b8fb9",
          background: "#eff6ff",
          borderRadius: 4,
          margin: "2px 6px",
          width: "calc(100% - 12px)",
        }}
      >
        <span style={{ marginRight: 4 }}>→</span>
        前の手順を選択してリンク
      </button>

      {/* 前手順: 見出し選択 */}
      {prevStepMode && (
        <div
          style={{
            padding: "4px 0",
            background: "#f0f9ff",
            borderTop: "1px solid #e0f2fe",
          }}
        >
          <div style={{ ...sectionHeaderStyle, color: "#5b8fb9" }}>
            リンク先の [手順] を選択
          </div>
          {headingCandidates.length === 0 && (
            <div
              style={{ padding: "6px 12px", fontSize: 12, color: "#9ca3af" }}
            >
              見出しがありません
            </div>
          )}
          {headingCandidates.map((c) => (
            <button
              key={c.blockId}
              onClick={() => {
                _onPrevStepLinkSelected?.(blockId, c.blockId);
                onClose();
              }}
              style={{
                ...menuItemStyle,
                color: "#1e40af",
                fontSize: 12,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  color: "#5b8fb9",
                  fontWeight: 600,
                  marginRight: 4,
                }}
              >
                [手順]
              </span>
              {c.text || "(空)"}
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
      </>}
    </div>,
    document.body
  );
}

// ──────────────────────────────────
// LinkRow（リンク行）
// ──────────────────────────────────
function LinkRow({
  link,
  label,
  onClick,
  onRemove,
}: {
  link: BlockLink;
  label: string;
  onClick: () => void;
  onRemove: () => void;
}) {
  const conf = LINK_TYPE_CONFIG[link.type];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 10px",
        fontSize: 12,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: conf.color,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontSize: 10,
          color: conf.color,
          fontWeight: 600,
          minWidth: 40,
        }}
      >
        {conf.label}
      </span>
      <button
        onClick={onClick}
        style={{
          flex: 1,
          textAlign: "left",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "#374151",
          fontSize: 12,
          padding: 0,
        }}
        title="クリックで移動"
      >
        {label}
      </button>
      <span style={{ fontSize: 9, color: "#9ca3af" }}>
        {CREATED_BY_LABELS[link.createdBy]}
      </span>
      <button
        onClick={onRemove}
        title="リンクを削除"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "#9ca3af",
          fontSize: 11,
          padding: "0 2px",
        }}
      >
        ×
      </button>
    </div>
  );
}

// ──────────────────────────────────
// ホバーで「#」を表示するレイヤー
// ラベルもリンクもないブロックにホバーすると右端に表示
// ──────────────────────────────────
export function ProvIndicatorHoverHint() {
  const { labels, openDropdown } = useLabelStore();
  const { links } = useLinkStore();
  const [hoverBlock, setHoverBlock] = useState<{
    blockId: string;
    top: number;
    left: number;
  } | null>(null);

  useEffect(() => {
    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const blockOuter = target.closest(
        '[data-node-type="blockOuter"]'
      ) as HTMLElement | null;
      if (!blockOuter) {
        setHoverBlock(null);
        return;
      }

      const blockId = blockOuter.getAttribute("data-id");
      if (!blockId) return;

      // 既にラベルまたはリンクがあるブロックはスキップ
      if (labels.has(blockId)) return;
      const hasLink = links.some(
        (l) => l.sourceBlockId === blockId || l.targetBlockId === blockId
      );
      if (hasLink) return;

      const wrapper = document.querySelector("[data-label-wrapper]");
      if (!wrapper) return;
      const wrapperRect = wrapper.getBoundingClientRect();
      const rect = blockOuter.getBoundingClientRect();

      setHoverBlock({
        blockId,
        top: rect.top + rect.height / 2,
        left: wrapperRect.right - 8,
      });
    };

    const handleMouseOut = (e: MouseEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
      if (!related?.closest('[data-node-type="blockOuter"]')) {
        setHoverBlock(null);
      }
    };

    const wrapper = document.querySelector("[data-label-wrapper]");
    if (!wrapper) return;
    wrapper.addEventListener("mouseover", handleMouseOver as EventListener);
    wrapper.addEventListener("mouseout", handleMouseOut as EventListener);
    return () => {
      wrapper.removeEventListener(
        "mouseover",
        handleMouseOver as EventListener
      );
      wrapper.removeEventListener(
        "mouseout",
        handleMouseOut as EventListener
      );
    };
  }, [labels, links]);

  if (!hoverBlock) return null;

  return createPortal(
    <button
      onClick={() => openDropdown(hoverBlock.blockId)}
      data-prov-label-anchor={hoverBlock.blockId}
      style={{
        position: "fixed",
        top: hoverBlock.top,
        right: window.innerWidth - hoverBlock.left,
        transform: "translateY(-50%)",
        zIndex: 9996,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 20,
        height: 20,
        borderRadius: 6,
        border: "1px dashed #d5e0d7",
        background: "none",
        cursor: "pointer",
        color: "#6b7f6e",
        fontSize: 11,
        opacity: 0.5,
        pointerEvents: "auto",
      }}
    >
      #
    </button>,
    document.body
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
