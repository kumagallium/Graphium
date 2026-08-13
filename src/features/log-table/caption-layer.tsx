// 記録テーブルのキャプション（テーブル名）レイヤー
// IndexTableIconLayer と同じパターンで body ポータルに描画する。
//
// 学術文書の慣例どおりテーブルのキャプションは表の上に置く。名前は
// logTables サイドストアの config.name に保存され、チャートブロックが
// 参照テーブルの表示名として使う（eureco の「データテーブル1: 地点Aの
// 観測結果」に相当する、参照に耐える名前）。

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../../i18n";
import { useLogTableStore } from "./store";
import { computeLogTableDisplayNames } from "./auto-name";

type CaptionPos = {
  blockId: string;
  top: number;
  left: number;
  width: number;
  /** 表示名（無名なら「表 N」の自動名） */
  displayName: string;
};

export function LogTableCaptionLayer({
  editorRef,
}: {
  editorRef: React.RefObject<any>;
}) {
  const store = useLogTableStore();
  const [captions, setCaptions] = useState<CaptionPos[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // テーブルの位置を計算（icon-layer と同じ再試行つき）
  const retryRef = useRef<number | null>(null);
  const compute = useCallback(() => {
    const next: CaptionPos[] = [];
    const editor = editorRef.current;
    if (!editor) {
      if (store.tables.size > 0 && retryRef.current === null) {
        retryRef.current = window.setTimeout(() => {
          retryRef.current = null;
          compute();
        }, 200);
      }
      return;
    }

    let domMissing = false;
    const displayNames = computeLogTableDisplayNames(
      (editor as any).document ?? [],
      store.isLogTable,
      store.getName
    );
    store.tables.forEach((_config, blockId) => {
      const block = editor.getBlock?.(blockId);
      if (!block || block.type !== "table") return;

      const blockEl = document.querySelector(
        `[data-id="${blockId}"][data-node-type="blockOuter"]`
      );
      if (!blockEl) {
        domMissing = true;
        return;
      }
      const tableEl = blockEl.querySelector("table");
      const rect = (tableEl ?? blockEl).getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) return;
      next.push({
        blockId,
        top: rect.top - 24,
        left: rect.left,
        width: rect.width,
        displayName: displayNames.get(blockId) ?? "",
      });
    });

    setCaptions(next);

    if (domMissing && retryRef.current === null) {
      retryRef.current = window.setTimeout(() => {
        retryRef.current = null;
        compute();
      }, 200);
    }
  }, [store.tables, editorRef]);

  useEffect(() => {
    return () => {
      if (retryRef.current !== null) {
        window.clearTimeout(retryRef.current);
        retryRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(compute, 50);
    return () => {
      clearTimeout(timer);
      if (retryRef.current !== null) {
        window.clearTimeout(retryRef.current);
        retryRef.current = null;
      }
    };
  }, [compute]);

  useEffect(() => {
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);

    const editorEl = document.querySelector("[data-label-wrapper]");
    let observer: MutationObserver | null = null;
    if (editorEl) {
      observer = new MutationObserver(compute);
      observer.observe(editorEl, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    }

    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
      observer?.disconnect();
    };
  }, [compute]);

  const startEditing = (blockId: string) => {
    setDraft(store.getName(blockId));
    setEditing(blockId);
  };

  const commit = (blockId: string) => {
    store.setName(blockId, draft);
    setEditing(null);
  };

  if (captions.length === 0) return null;

  return createPortal(
    <>
      {captions.map(({ blockId, top, left, width, displayName }) => {
        const name = store.getName(blockId);
        if (editing === blockId) {
          return (
            <input
              key={blockId}
              autoFocus
              type="text"
              value={draft}
              placeholder={displayName || t("logTable.namePlaceholder")}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commit(blockId)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") commit(blockId);
                if (e.key === "Escape") setEditing(null);
              }}
              style={{
                position: "fixed",
                top,
                left,
                width: Math.max(180, Math.min(width, 360)),
                height: 22,
                padding: "0 6px",
                fontSize: 13,
                borderRadius: 6,
                border: "1px solid var(--color-input)",
                background: "var(--color-card)",
                color: "var(--color-foreground)",
                outline: "none",
                zIndex: 50,
              }}
            />
          );
        }
        return (
          <button
            key={blockId}
            type="button"
            onClick={() => startEditing(blockId)}
            title={t("logTable.nameHint")}
            style={{
              position: "fixed",
              top,
              left,
              maxWidth: Math.max(180, width),
              height: 22,
              display: "flex",
              alignItems: "center",
              padding: "0 6px",
              margin: 0,
              borderRadius: 6,
              border: "none",
              background: "transparent",
              cursor: "text",
              fontSize: 13,
              // 手で付けた名前は少し立て、自動名（表 N）は控えめに出す
              fontWeight: name ? 500 : 400,
              color: name ? "var(--color-text-secondary)" : "var(--color-text-tertiary)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              zIndex: 50,
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
          >
            {displayName || t("logTable.namePlaceholder")}
          </button>
        );
      })}
    </>,
    document.body
  );
}
