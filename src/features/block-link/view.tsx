// ──────────────────────────────────────────────
// 「前手順: @」リンク入力UI
//
// H2 procedure ブロックから「前手順リンク」を追加する体験。
// エディタ内の他の H2 見出しを候補として一覧表示し、
// 選択すると informed_by リンクが生成される。
// ──────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLinkStore } from "./store";
import { LINK_TYPE_CONFIG, type LinkType } from "./link-types";

type HeadingCandidate = {
  blockId: string;
  text: string;
  level: number;
};

/**
 * エディタDOMからH2見出しブロックを探して候補リストを返す
 */
function findHeadingCandidates(excludeBlockId?: string): HeadingCandidate[] {
  const candidates: HeadingCandidate[] = [];
  // BlockNote の見出しブロックを探す
  const headingEls = document.querySelectorAll(
    '[data-node-type="blockOuter"]'
  );
  headingEls.forEach((el) => {
    const blockId = el.getAttribute("data-id");
    if (!blockId || blockId === excludeBlockId) return;
    // 内部の heading 要素を確認
    const h2 = el.querySelector("h2");
    const h1 = el.querySelector("h1");
    const h3 = el.querySelector("h3");
    if (h2) {
      candidates.push({ blockId, text: h2.textContent || "", level: 2 });
    } else if (h1) {
      candidates.push({ blockId, text: h1.textContent || "", level: 1 });
    } else if (h3) {
      candidates.push({ blockId, text: h3.textContent || "", level: 3 });
    }
  });
  return candidates;
}

/**
 * 前手順リンク追加ドロップダウン
 */
export function PrevStepLinkDropdown({
  sourceBlockId,
  anchorRect,
  onClose,
}: {
  sourceBlockId: string;
  anchorRect: { top: number; left: number };
  onClose: () => void;
}) {
  const { addLink, getOutgoing } = useLinkStore();
  const [candidates, setCandidates] = useState<HeadingCandidate[]>([]);
  const [filter, setFilter] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // 候補リストを取得
  useEffect(() => {
    setCandidates(findHeadingCandidates(sourceBlockId));
  }, [sourceBlockId]);

  // 既存の informed_by リンク
  const existingTargets = new Set(
    getOutgoing(sourceBlockId)
      .filter((l) => l.type === "informed_by")
      .map((l) => l.targetBlockId)
  );

  // 外側クリックで閉じる
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const filtered = candidates.filter(
    (c) => c.text.toLowerCase().includes(filter.toLowerCase())
  );

  const handleSelect = (targetBlockId: string) => {
    if (existingTargets.has(targetBlockId)) return;
    addLink({
      sourceBlockId,
      targetBlockId,
      type: "informed_by",
      createdBy: "human",
    });
    onClose();
  };

  return createPortal(
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: anchorRect.top + window.scrollY,
        left: anchorRect.left + window.scrollX,
        zIndex: 9999,
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        boxShadow: "0 4px 20px rgba(0,0,0,0.14)",
        padding: "6px 0",
        minWidth: 260,
        maxHeight: 320,
        overflowY: "auto",
      }}
    >
      <div style={{ padding: "4px 10px 6px", fontSize: 10, fontWeight: 700, color: "#9ca3af", letterSpacing: "0.05em" }}>
        前手順: @ リンク先を選択
      </div>
      <div style={{ padding: "2px 10px 6px" }}>
        <input
          autoFocus
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && filtered.length === 1) {
              handleSelect(filtered[0].blockId);
            }
          }}
          placeholder="見出しを検索..."
          style={{
            width: "100%",
            fontSize: 12,
            padding: "4px 6px",
            border: "1px solid #d1d5db",
            borderRadius: 4,
            outline: "none",
          }}
        />
      </div>

      {filtered.length === 0 && (
        <div style={{ padding: "8px 12px", fontSize: 12, color: "#9ca3af" }}>
          候補なし
        </div>
      )}

      {filtered.map((c) => {
        const isLinked = existingTargets.has(c.blockId);
        return (
          <button
            key={c.blockId}
            onClick={() => handleSelect(c.blockId)}
            disabled={isLinked}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              width: "100%",
              textAlign: "left",
              padding: "5px 12px",
              fontSize: 13,
              background: isLinked ? "#f3f4f6" : "none",
              border: "none",
              cursor: isLinked ? "default" : "pointer",
              color: isLinked ? "#9ca3af" : "#374151",
            }}
          >
            <span style={{
              fontSize: 10,
              color: "#9ca3af",
              fontWeight: 700,
              minWidth: 20,
            }}>
              H{c.level}
            </span>
            <span style={{ flex: 1 }}>{c.text || "(空の見出し)"}</span>
            {isLinked && <span style={{ fontSize: 10 }}>リンク済</span>}
          </button>
        );
      })}
    </div>,
    document.body
  );
}

/**
 * 汎用リンク追加ドロップダウン（リンクタイプを選んでからターゲットを選択）
 */
export function AddLinkDropdown({
  sourceBlockId,
  anchorRect,
  onClose,
}: {
  sourceBlockId: string;
  anchorRect: { top: number; left: number };
  onClose: () => void;
}) {
  const { addLink } = useLinkStore();
  const [selectedType, setSelectedType] = useState<LinkType | null>(null);
  const [candidates, setCandidates] = useState<HeadingCandidate[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedType) {
      setCandidates(findHeadingCandidates(sourceBlockId));
    }
  }, [selectedType, sourceBlockId]);

  // 外側クリックで閉じる
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const handleSelect = (targetBlockId: string) => {
    if (!selectedType) return;
    addLink({
      sourceBlockId,
      targetBlockId,
      type: selectedType,
      createdBy: "human",
    });
    onClose();
  };

  return createPortal(
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: anchorRect.top + window.scrollY,
        left: anchorRect.left + window.scrollX,
        zIndex: 9999,
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 8,
        boxShadow: "0 4px 20px rgba(0,0,0,0.14)",
        padding: "6px 0",
        minWidth: 220,
        maxHeight: 360,
        overflowY: "auto",
      }}
    >
      {!selectedType ? (
        <>
          <div style={{ padding: "4px 10px 6px", fontSize: 10, fontWeight: 700, color: "#9ca3af" }}>
            リンクタイプを選択
          </div>
          {(Object.entries(LINK_TYPE_CONFIG) as [LinkType, typeof LINK_TYPE_CONFIG[LinkType]][]).map(
            ([type, conf]) => (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  width: "100%",
                  textAlign: "left",
                  padding: "5px 12px",
                  fontSize: 13,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#374151",
                }}
              >
                <span style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: conf.color, flexShrink: 0,
                }} />
                {conf.label}
                <span style={{ fontSize: 10, color: "#9ca3af", marginLeft: "auto" }}>
                  {conf.provDM}
                </span>
              </button>
            )
          )}
        </>
      ) : (
        <>
          <div style={{ padding: "4px 10px 6px", fontSize: 10, fontWeight: 700, color: "#9ca3af" }}>
            {LINK_TYPE_CONFIG[selectedType].label} のターゲットを選択
          </div>
          <button
            onClick={() => setSelectedType(null)}
            style={{
              padding: "3px 12px", fontSize: 11, color: "#5b8fb9",
              background: "none", border: "none", cursor: "pointer",
            }}
          >
            ← タイプ選択に戻る
          </button>
          {candidates.map((c) => (
            <button
              key={c.blockId}
              onClick={() => handleSelect(c.blockId)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                width: "100%", textAlign: "left", padding: "5px 12px",
                fontSize: 13, background: "none", border: "none",
                cursor: "pointer", color: "#374151",
              }}
            >
              <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 700, minWidth: 20 }}>
                H{c.level}
              </span>
              {c.text || "(空の見出し)"}
            </button>
          ))}
        </>
      )}
    </div>,
    document.body
  );
}
