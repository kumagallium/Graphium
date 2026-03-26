// ──────────────────────────────────────────────
// リンクバッジUI
//
// ラベルバッジの隣にリンク情報を表示する。
// クリックでリンク一覧を展開し、ターゲットへの遷移や削除ができる。
// ──────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "lucide-react";
import { useLinkStore } from "./store";
import { CREATED_BY_LABELS, LINK_TYPE_CONFIG, type BlockLink } from "./link-types";
import { Dropdown, DropdownSectionHeader, DropdownDivider } from "@ui/dropdown";

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
              className="fixed z-[9997] inline-flex items-center gap-0.5 rounded-lg text-[10px] font-semibold cursor-pointer select-none pointer-events-auto"
              style={{
                top,
                left,
                transform: "translateY(-50%)",
                padding: "1px 5px",
                backgroundColor: "#eff6ff",
                color: "#5b8fb9",
                border: "1px solid #bfdbfe",
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

  return (
    <Dropdown
      position={{ top, left }}
      onClose={onClose}
      minWidth={240}
      maxHeight="300px"
    >
      <div className="py-1.5">
        {/* 出力リンク */}
        {outgoing.length > 0 && (
          <>
            <DropdownSectionHeader>→ 出力リンク</DropdownSectionHeader>
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
            {outgoing.length > 0 && <DropdownDivider />}
            <DropdownSectionHeader>← 入力リンク</DropdownSectionHeader>
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
      </div>
    </Dropdown>
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
    <div className="flex items-center gap-1 px-2.5 py-1 text-xs">
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: conf.color }}
      />
      <span
        className="text-[10px] font-semibold min-w-[40px]"
        style={{ color: conf.color }}
      >
        {conf.label}
      </span>
      <button
        onClick={onClick}
        className="flex-1 text-left bg-transparent border-none cursor-pointer text-foreground text-xs p-0 hover:underline"
        title="クリックで移動"
      >
        {label}
      </button>
      <span className="text-[9px] text-muted-foreground">
        {CREATED_BY_LABELS[link.createdBy]}
      </span>
      <button
        onClick={onRemove}
        title="リンクを削除"
        className="bg-transparent border-none cursor-pointer text-muted-foreground text-xs px-0.5 hover:text-destructive"
      >
        ×
      </button>
    </div>
  );
}
