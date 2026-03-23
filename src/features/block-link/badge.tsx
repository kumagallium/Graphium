// ──────────────────────────────────────────────
// リンクバッジUI
//
// ラベルバッジの隣にリンク情報を表示する。
// クリックでリンク一覧を展開し、ターゲットへの遷移や削除ができる。
// ──────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "lucide-react";
import { useLinkStore } from "./store";
import { CREATED_BY_LABELS, LINK_TYPE_CONFIG, type BlockLink } from "./link-types";

type LinkBadgeInfo = {
  blockId: string;
  top: number;
  left: number;
  outgoing: BlockLink[];
  incoming: BlockLink[];
};

/**
 * ブロックの見出しテキストを取得するヘルパー
 */
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

/**
 * リンクバッジレイヤー（position:fixed オーバーレイ）
 * リンクを持つブロックの右側にバッジを表示する
 */
export function LinkBadgeLayer() {
  const { links, getOutgoing, getIncoming, removeLink } = useLinkStore();
  const [badges, setBadges] = useState<LinkBadgeInfo[]>([]);
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null);

  const compute = useCallback(() => {
    // リンクを持つブロックIDを集める
    const blockIds = new Set<string>();
    links.forEach((l) => {
      blockIds.add(l.sourceBlockId);
      blockIds.add(l.targetBlockId);
    });

    const next: LinkBadgeInfo[] = [];
    blockIds.forEach((blockId) => {
      const el = document.querySelector(
        `[data-id="${blockId}"][data-node-type="blockOuter"]`
      ) as HTMLElement | null;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      if (rect.height === 0) return;

      const outgoing = getOutgoing(blockId);
      const incoming = getIncoming(blockId);
      if (outgoing.length === 0 && incoming.length === 0) return;

      // ブロック右側に配置
      next.push({
        blockId,
        top: rect.top + rect.height / 2,
        left: rect.right + 8,
        outgoing,
        incoming,
      });
    });
    setBadges(next);
  }, [links, getOutgoing, getIncoming]);

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

  if (badges.length === 0) return null;

  return createPortal(
    <>
      {badges.map(({ blockId, top, left, outgoing, incoming }) => {
        const count = outgoing.length + incoming.length;
        const isExpanded = expandedBlockId === blockId;
        return (
          <div key={blockId}>
            {/* バッジ */}
            <button
              onClick={() => setExpandedBlockId(isExpanded ? null : blockId)}
              title={`${count} リンク`}
              style={{
                position: "fixed",
                top,
                left,
                transform: "translateY(-50%)",
                zIndex: 9997,
                display: "inline-flex",
                alignItems: "center",
                gap: 2,
                padding: "1px 5px",
                borderRadius: 10,
                fontSize: 10,
                fontWeight: 600,
                background: "#eff6ff",
                color: "#5b8fb9",
                border: "1px solid #bfdbfe",
                cursor: "pointer",
                userSelect: "none",
                pointerEvents: "auto",
              }}
            >
              <Link size={10} strokeWidth={2.5} /> {count}
            </button>

            {/* 展開パネル */}
            {isExpanded && (
              <LinkDetailPanel
                blockId={blockId}
                top={top + 14}
                left={left}
                outgoing={outgoing}
                incoming={incoming}
                onRemove={removeLink}
                onClose={() => setExpandedBlockId(null)}
              />
            )}
          </div>
        );
      })}
    </>,
    document.body,
  );
}

/**
 * リンク詳細パネル
 */
function LinkDetailPanel({
  blockId,
  top,
  left,
  outgoing,
  incoming,
  onRemove,
  onClose,
}: {
  blockId: string;
  top: number;
  left: number;
  outgoing: BlockLink[];
  incoming: BlockLink[];
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // 少し遅延させてバッジ自体のクリックイベントと競合しないようにする
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handler);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  const scrollToBlock = (targetId: string) => {
    const el = document.querySelector(
      `[data-id="${targetId}"][data-node-type="blockOuter"]`
    );
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // ハイライトエフェクト
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
        top,
        left,
        zIndex: 9999,
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        boxShadow: "0 4px 20px rgba(0,0,0,0.14)",
        padding: "6px 0",
        minWidth: 240,
        maxHeight: 300,
        overflowY: "auto",
      }}
    >
      {/* 出力リンク */}
      {outgoing.length > 0 && (
        <>
          <div style={sectionStyle}>→ 出力リンク</div>
          {outgoing.map((link) => (
            <LinkRow
              key={link.id}
              link={link}
              label={getBlockText(link.targetBlockId)}
              onClick={() => scrollToBlock(link.targetBlockId)}
              onRemove={() => onRemove(link.id)}
            />
          ))}
        </>
      )}

      {/* 入力リンク */}
      {incoming.length > 0 && (
        <>
          {outgoing.length > 0 && <div style={divStyle} />}
          <div style={sectionStyle}>← 入力リンク</div>
          {incoming.map((link) => (
            <LinkRow
              key={link.id}
              link={link}
              label={getBlockText(link.sourceBlockId)}
              onClick={() => scrollToBlock(link.sourceBlockId)}
              onRemove={() => onRemove(link.id)}
            />
          ))}
        </>
      )}
    </div>,
    document.body,
  );
}

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
          width: 6, height: 6, borderRadius: "50%",
          background: conf.color, flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 10, color: conf.color, fontWeight: 600, minWidth: 40 }}>
        {conf.label}
      </span>
      <button
        onClick={onClick}
        style={{
          flex: 1, textAlign: "left", background: "none",
          border: "none", cursor: "pointer", color: "#374151",
          fontSize: 12, padding: 0,
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
          background: "none", border: "none", cursor: "pointer",
          color: "#9ca3af", fontSize: 11, padding: "0 2px",
        }}
      >
        ×
      </button>
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  padding: "2px 10px",
  fontSize: 10,
  fontWeight: 700,
  color: "#9ca3af",
  letterSpacing: "0.05em",
};

const divStyle: React.CSSProperties = {
  borderTop: "1px solid #f3f4f6",
  margin: "4px 0",
};
