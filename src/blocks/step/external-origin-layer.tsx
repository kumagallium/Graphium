// 外部参照インプット行の由来チップレイヤー
//
// 別ノートの output を受け取った [インプット] 表の行の右横に、
// `← ノート › ステップ` の由来を淡く出す（D-1 案 / 2026-08-23 合意）。
// クリックで参照元ノートを Side Peek で開く。解決できないときは
// リンク切れとして赤くする。
//
// IndexTableIconLayer と同じ方式: 行の DOM 位置を測ってエディタラッパー内に
// 絶対配置で描画する（位置リスト→CSS の経路は作らない）。行の特定は
// tableRowIdentity style が出す data-row-identity 属性で行う。

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink } from "lucide-react";
import { useLinkStore } from "../../features/block-link/store";
import {
  getLatestProcessIndex,
  resolveCrossNoteOutput,
  subscribeLatestProcessIndex,
} from "../../features/network-graph/process-index";
import {
  getIndexTableCallbacks,
  openEditorSidePeek,
} from "../../features/index-table/context";
import { t, useLocaleSubscription } from "../../i18n";
import { useSyncExternalStore } from "react";

type OriginChip = {
  linkId: string;
  noteId: string;
  label: string; // ← ノート › ステップ
  title: string; // ツールチップ
  broken: boolean;
  top: number;
  left: number;
};

export function ExternalOriginLayer({
  editorRef,
  wrapperEl,
}: {
  editorRef: React.RefObject<any>;
  /** SidePeek など専用ラッパーで使う場合に渡す（省略時は [data-label-wrapper]） */
  wrapperEl?: HTMLElement | null;
}) {
  useLocaleSubscription();
  const linkStore = useLinkStore();
  const processIndex = useSyncExternalStore(
    subscribeLatestProcessIndex,
    getLatestProcessIndex,
    getLatestProcessIndex,
  );
  const [chips, setChips] = useState<OriginChip[]>([]);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const retryRef = useRef<number | null>(null);

  const externalLinks = linkStore.links.filter(
    (l) => l.type === "informed_by" && !!l.targetNoteId && !!l.sourceEntityId,
  );
  // 依存を値で比較するためのキー（links は毎 render 新配列になり得る）
  const linksKey = externalLinks
    .map((l) => `${l.id}:${l.sourceEntityId}:${l.targetEntityLabel}`)
    .join("|");

  const compute = useCallback(() => {
    const next: OriginChip[] = [];
    const root =
      wrapperEl ?? document.querySelector<HTMLElement>("[data-label-wrapper]");
    if (!root) return;
    setPortalHost((prev) => (prev === root ? prev : root));
    const rootRect = root.getBoundingClientRect();

    let domMissing = false;
    for (const link of externalLinks) {
      const anchor = root.querySelector<HTMLElement>(
        `[data-row-identity="${CSS.escape(link.sourceEntityId!)}"]`,
      );
      if (!anchor) {
        domMissing = true;
        continue;
      }
      // identity の span は display: contents（自身のボックスを持たない）なので、
      // getBoundingClientRect は常に空になる。中身のテキストを Range で測る
      const range = document.createRange();
      range.selectNodeContents(anchor);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        domMissing = true;
        continue;
      }
      const resolved =
        link.targetNoteId && link.targetEntityId
          ? resolveCrossNoteOutput(processIndex, {
              noteId: link.targetNoteId,
              sourceModifiedAt: link.targetSourceModifiedAt,
              stepId: link.targetBlockId,
              entityIdentity: link.targetEntityId,
              identityStable: link.targetEntityStable,
              outputIndex: link.targetEntityIndex,
              outputCount: link.targetEntityCount,
            })
          : null;
      const noteTitle =
        resolved?.noteTitle ?? link.targetNoteTitle ?? link.targetNoteId ?? "";
      const stepTitle =
        resolved?.stepName ?? link.targetStepTitle ?? link.targetBlockId.slice(0, 8);
      next.push({
        linkId: link.id,
        noteId: link.targetNoteId!,
        label: `← ${noteTitle} › ${stepTitle}`,
        title: t("step.openExternalSource", { note: noteTitle, step: stepTitle }),
        broken: !resolved,
        top: rect.top - rootRect.top + root.scrollTop + rect.height / 2,
        left: rect.right - rootRect.left + root.scrollLeft + 8,
      });
    }
    setChips(next);

    // BlockNote の DOM が store より遅れて描かれるケースの保険（IconLayer と同じ）
    if (domMissing && retryRef.current === null) {
      retryRef.current = window.setTimeout(() => {
        retryRef.current = null;
        compute();
      }, 200);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linksKey, processIndex, wrapperEl]);

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

  // スクロール・リサイズ・DOM 変化に追従（IconLayer と同じ）
  useEffect(() => {
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    const root =
      wrapperEl ?? document.querySelector<HTMLElement>("[data-label-wrapper]");
    let observer: MutationObserver | null = null;
    if (root) {
      observer = new MutationObserver(compute);
      observer.observe(root, { subtree: true, childList: true, characterData: true });
    }
    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
      observer?.disconnect();
    };
  }, [compute, wrapperEl]);

  if (!portalHost || chips.length === 0) return null;

  return createPortal(
    <>
      {chips.map((chip) => (
        <button
          key={chip.linkId}
          type="button"
          data-test="external-origin-chip"
          title={chip.title}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (!openEditorSidePeek(editorRef.current, chip.noteId)) {
              getIndexTableCallbacks()?.onOpenSidePeek(chip.noteId);
            }
          }}
          style={{
            position: "absolute",
            top: chip.top,
            left: chip.left,
            transform: "translateY(-50%)",
            zIndex: 10,
            display: "inline-flex",
            alignItems: "center",
            gap: 3,
            maxWidth: 260,
            padding: "1px 4px",
            border: "none",
            borderRadius: 4,
            background: "transparent",
            cursor: "pointer",
            fontSize: 10.5,
            lineHeight: 1.4,
            whiteSpace: "nowrap",
            color: chip.broken ? "var(--color-error)" : "var(--color-text-tertiary)",
          }}
        >
          <ExternalLink size={10} strokeWidth={2} style={{ flex: "0 0 auto", opacity: 0.75 }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {chip.label}
            {chip.broken ? ` — ${t("step.brokenLink")}` : ""}
          </span>
        </button>
      ))}
    </>,
    portalHost,
  );
}
