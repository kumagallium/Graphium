// ──────────────────────────────────────────────
// ProvIndicatorLayer
//
// エディタ右側に position:fixed オーバーレイで
// 各ブロックの PROV ラベルを表示する。
// クリックで統合パネル（ラベル変更 + リンク一覧 + リンク追加）を開く。
// ──────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLabelStore, useProvLabelsEnabled } from "./store";
import { deriveActivityName } from "./activity-name";
import { useLinkStore } from "../block-link/store";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";
import {
  FREE_LABEL_EXAMPLES,
} from "./labels";
import { getVisibleCoreLabels } from "./label-visibility";
import {
  LINK_TYPE_CONFIG,
  CREATED_BY_LABELS,
  type BlockLink,
} from "../block-link/link-types";
import { Dropdown, DropdownSectionHeader, DropdownDivider } from "@ui/dropdown";
import { MenuItem } from "@ui/menu-item";
import { Button } from "@ui/button";
import { Input } from "@ui/form-field";
import { useT, getDisplayLabel } from "../../i18n";
import { t as tStatic } from "../../i18n";
import {
  RelationshipPicker,
  type PickerCandidate,
} from "../inline-label/relationship-picker";

// ──────────────────────────────────
// 色定義
// ──────────────────────────────────
const LABEL_COLORS: Record<string, string> = {
  procedure: "#5b8fb9",
  material: "#4B7A52",
  tool: "#c08b3e",
  attribute: "#8fa394",
  result: "#c26356",
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
  // 見出しは activity 名として扱うため連番プレフィックスを除く（リンク表示と PROV 出力を揃える）
  if (heading) return deriveActivityName(heading.textContent ?? "") || tStatic("common.empty");
  const para = el.querySelector("[data-content-type]");
  if (para) {
    const text = para.textContent || "";
    return text.length > 30 ? text.slice(0, 30) + "…" : text || tStatic("common.empty");
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
export function ProvIndicatorLayer({
  wrapperEl,
  hidden = false,
  bottomInset = 0,
}: {
  wrapperEl?: HTMLElement | null;
  /** モバイルで全画面オーバーレイ（右パネル）が開いている間はラベルを描画しない */
  hidden?: boolean;
  /** 画面下端からの予約領域（モバイルのボトムバー高さ等）。この内側にラベルを置かない */
  bottomInset?: number;
} = {}) {
  const provLabelsEnabled = useProvLabelsEnabled();
  const { labels, getLabel, setLabel, openBlockId } = useLabelStore();
  const { links, getOutgoing, getIncoming, removeLink } = useLinkStore();
  const [indicators, setIndicators] = useState<IndicatorInfo[]>([]);
  const [clipBounds, setClipBounds] = useState<ClipBounds>({ top: 0, bottom: 9999 });
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const t = useT();

  // ラベルまたはリンクを持つブロックの位置を計算
  const compute = useCallback(() => {
    // ラベル or リンクを持つブロック ID を収集
    const blockIds = new Set<string>();
    labels.forEach((_label, blockId) => blockIds.add(blockId));
    links.forEach((l) => {
      blockIds.add(l.sourceBlockId);
      blockIds.add(l.targetBlockId);
    });

    // wrapperEl が渡されていれば、その配下のみを対象にする（メインエディタと SidePeek が
    // 同じノートを開いているとき、blockId が両方に存在しても自分の wrapper 内の要素を
    // 確実に拾うため）。未指定なら従来通りドキュメント全体から探索する。
    const queryRoot: ParentNode = wrapperEl ?? document;
    let wrapper: Element | null = null;
    if (wrapperEl) {
      wrapper = wrapperEl;
    } else {
      for (const blockId of blockIds) {
        const outer = document.querySelector(
          `[data-id="${blockId}"][data-node-type="blockOuter"]`
        );
        if (outer) {
          wrapper = outer.closest("[data-label-wrapper]");
          if (wrapper) break;
        }
      }
      if (!wrapper) {
        wrapper = document.querySelector("[data-label-wrapper]");
      }
    }
    if (!wrapper) return;
    const wrapperRect = wrapper.getBoundingClientRect();
    // SidePeek が開いていて、この wrapper がその下に隠れている場合は
    // ラベルを SidePeek の左端より内側に収める（z-index で重なるのを防ぐ）
    let effectiveRight = wrapperRect.right;
    const sidePeek = document.querySelector("[data-side-peek]");
    if (sidePeek && !sidePeek.contains(wrapper)) {
      const peekRect = sidePeek.getBoundingClientRect();
      if (peekRect.left < effectiveRight) {
        effectiveRight = peekRect.left;
      }
    }
    // サイドバー境界の左にラベルを配置（8px の余白）
    const indicatorLeft = effectiveRight - 8;
    // ラベルの表示範囲をエディタラッパー内に制限。
    // モバイルではボトムバー（bottomInset）の上端でクリップし、固定ツールバーと重ならないようにする。
    const clipBottom =
      bottomInset > 0
        ? Math.min(wrapperRect.bottom, window.innerHeight - bottomInset)
        : wrapperRect.bottom;
    setClipBounds({ top: wrapperRect.top, bottom: clipBottom });

    const next: IndicatorInfo[] = [];
    blockIds.forEach((blockId) => {
      const outer = queryRoot.querySelector(
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
  }, [labels, links, getLabel, getOutgoing, getIncoming, wrapperEl, bottomInset]);

  useEffect(() => {
    const raf = requestAnimationFrame(compute);
    return () => cancelAnimationFrame(raf);
  }, [compute]);

  useEffect(() => {
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    const wrapper = wrapperEl ?? document.querySelector("[data-label-wrapper]");
    let ro: ResizeObserver | undefined;
    let mo: MutationObserver | undefined;
    if (wrapper) {
      // エディタラッパーの幅変化を監視（右パネル展開/折りたたみ時の再計算）
      ro = new ResizeObserver(compute);
      ro.observe(wrapper);
      // ブロックの追加・削除を監視（ラベルなしブロックの変更でも位置を再計算）
      mo = new MutationObserver(() => {
        requestAnimationFrame(compute);
      });
      mo.observe(wrapper, { childList: true, subtree: true });
    }
    // SidePeek の開閉（document.body 直下にポータルされる）を監視
    const bodyMo = new MutationObserver(() => {
      requestAnimationFrame(compute);
    });
    bodyMo.observe(document.body, { childList: true });
    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
      ro?.disconnect();
      mo?.disconnect();
      bodyMo.disconnect();
    };
  }, [compute]);

  // ドロップダウンが開いているときは activeBlockId を連動
  useEffect(() => {
    if (openBlockId) setActiveBlockId(openBlockId);
  }, [openBlockId]);

  // モバイルで全画面オーバーレイ（右パネル）が開いている間は、エディタが隠れているため
  // ラベルが空白に孤立して見える。描画自体を止める。
  // 来歴ラベル機能がオフなら、ラベル / PROV リンクのインジケータ層を一切描画しない。
  if (!provLabelsEnabled || hidden || indicators.length === 0) return null;

  return createPortal(
    <>
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
              data-prov-label-anchor={blockId}
              title={tStatic("provIndicator.clickForDetails", { label: getDisplayLabel(label) })}
              className="fixed z-[9997] inline-block rounded-full text-xs font-semibold cursor-pointer select-none whitespace-nowrap pointer-events-auto"
              style={{
                top,
                right: window.innerWidth - left,
                transform: "translateY(-50%)",
                padding: "0px 6px",
                backgroundColor: color + "18",
                color: color,
                border: `1px solid ${color}38`,
                lineHeight: 1.6,
              }}
            >
              {getDisplayLabel(label)}
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
  const t = useT();
  const { labels: allLabels } = useLabelStore();
  const useLabelStoreRef = { current: allLabels };
  const [showLabelPicker, setShowLabelPicker] = useState(false);
  const [showPrevStepPicker, setShowPrevStepPicker] = useState(false);
  const [headingCandidates, setHeadingCandidates] = useState<
    { blockId: string; text: string }[]
  >([]);
  const [freeInput, setFreeInput] = useState("");
  // IME 確定 Enter 判定（WebKit のイベント順対応。lib/ime-enter.ts 参照）
  const { compositionHandlers, isImeKey } = useImeEnterGuard();

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

  return (
    <Dropdown
      position={{ top: adjustedTop, left: adjustedLeft }}
      onClose={onClose}
      minWidth={240}
      maxHeight="70vh"
    >
      <div className="py-1.5">
        {/* ── 現在のラベル表示 + 変更ボタン ── */}
        <div className="flex items-center gap-1.5 px-3 py-1">
          {label ? (
            <span
              className="inline-block rounded-full text-xs font-semibold"
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
          ) : (
            <span className="text-xs text-muted-foreground">{t("labelUi.noLabel")}</span>
          )}
          <button
            onClick={() => setShowLabelPicker(!showLabelPicker)}
            className="ml-auto text-[10px] text-[#5b8fb9] bg-transparent border-none cursor-pointer underline"
          >
            {showLabelPicker ? t("common.close") : t("common.change")}
          </button>
        </div>

        {/* ── ラベル選択（展開時） ── */}
        {showLabelPicker && (
          <div className="border-t border-border pt-1">
            <DropdownSectionHeader>{t("labelUi.coreLabels")}</DropdownSectionHeader>
            {getVisibleCoreLabels(blockId, label).map((l) => {
              const active = label === l;
              const c = getLabelColor(l);
              return (
                <MenuItem
                  key={l}
                  active={active}
                  dotColor={c}
                  onClick={() => {
                    onLabelChange(active ? null : l);
                    setShowLabelPicker(false);
                  }}
                  style={{ color: active ? c : undefined }}
                >
                  {getDisplayLabel(l)}
                </MenuItem>
              );
            })}

            {/* フリーラベル例 */}
            <DropdownDivider />
            <DropdownSectionHeader>{t("labelUi.freeLabels")}</DropdownSectionHeader>
            {FREE_LABEL_EXAMPLES.slice(0, 4).map((l) => {
              const active = label === l;
              return (
                <MenuItem
                  key={l}
                  active={active}
                  onClick={() => {
                    onLabelChange(active ? null : l);
                    setShowLabelPicker(false);
                  }}
                  className="text-muted-foreground"
                >
                  {getDisplayLabel(l)}
                </MenuItem>
              );
            })}

            {/* カスタム入力 */}
            <DropdownDivider />
            <div className="px-2.5 py-1.5">
              <DropdownSectionHeader>{t("labelUi.custom")}</DropdownSectionHeader>
              <div className="flex gap-1 mt-0.5">
                <Input
                  value={freeInput}
                  onChange={(e) => setFreeInput(e.target.value)}
                  {...compositionHandlers}
                  onKeyDown={(e) => {
                    // IME 変換確定の Enter では確定しない（WKWebView の
                    // compositionend → keydown(13) 順対応。lib/ime-enter.ts 参照）
                    if (e.key === "Enter" && !isImeKey(e) && freeInput.trim()) {
                      onLabelChange(freeInput.trim());
                      setShowLabelPicker(false);
                    }
                    if (e.key === "Escape") setShowLabelPicker(false);
                  }}
                  placeholder={t("labelUi.placeholder")}
                  className="text-xs py-1 px-1.5"
                />
                <Button
                  size="sm"
                  onClick={() => {
                    if (freeInput.trim()) {
                      onLabelChange(freeInput.trim());
                      setShowLabelPicker(false);
                    }
                  }}
                  className="text-xs shrink-0"
                >
                  {t("common.add")}
                </Button>
              </div>
            </div>

            {/* ラベル削除 */}
            {label && (
              <>
                <DropdownDivider />
                <MenuItem
                  onClick={() => {
                    onLabelChange(null);
                    setShowLabelPicker(false);
                  }}
                  className="text-destructive"
                >
                  {t("labelUi.removeLabel")}
                </MenuItem>
              </>
            )}
          </div>
        )}

        {/* ── リンク一覧 ── */}
        {/*
          informed_by など PROV リンクは「source wasInformedBy target」の意味。
          ・outgoing (sourceBlockId == 自分): 自分が target に依拠している → 入力（前手順）
          ・incoming (targetBlockId == 自分): source が自分に依拠している → 出力（次手順）
        */}
        {linkCount > 0 && (
          <>
            <DropdownDivider />
            {outgoing.length > 0 && (
              <>
                <DropdownSectionHeader>{t("provIndicator.inLinks")}</DropdownSectionHeader>
                {outgoing.map((link) => (
                  <LinkRow
                    key={link.id}
                    link={link}
                    direction="outgoing"
                    label={getBlockText(link.targetBlockId)}
                    onClick={() => scrollToBlock(link.targetBlockId)}
                    onRemove={() => onRemoveLink(link.id)}
                  />
                ))}
              </>
            )}
            {incoming.length > 0 && (
              <>
                {outgoing.length > 0 && <DropdownDivider />}
                <DropdownSectionHeader>{t("provIndicator.outLinks")}</DropdownSectionHeader>
                {incoming.map((link) => (
                  <LinkRow
                    key={link.id}
                    link={link}
                    direction="incoming"
                    label={getBlockText(link.sourceBlockId)}
                    onClick={() => scrollToBlock(link.sourceBlockId)}
                    onRemove={() => onRemoveLink(link.id)}
                  />
                ))}
              </>
            )}
          </>
        )}

        {/* ── 前手順リンク追加（procedure ラベルのみ） ── */}
        {label === "procedure" && <>
        <DropdownDivider />
        <DropdownSectionHeader className="text-[#5b8fb9]">
          {t("labelUi.prevStepLink")}
        </DropdownSectionHeader>
        <button
          onClick={() => {
            const candidates: { blockId: string; text: string }[] = [];
            const labelMap = useLabelStoreRef.current;
            document
              .querySelectorAll('[data-node-type="blockOuter"]')
              .forEach((el) => {
                const bid = el.getAttribute("data-id");
                if (!bid || bid === blockId) return;
                if (labelMap.get(bid) !== "procedure") return;
                const heading = el.querySelector("h1, h2, h3");
                const text = heading?.textContent
                  || el.querySelector("[data-content-type]")?.textContent
                  || "";
                candidates.push({
                  blockId: bid,
                  text: text || t("common.empty"),
                });
              });
            setHeadingCandidates(candidates);
            setShowPrevStepPicker(true);
          }}
          className="flex items-center w-full text-left px-3 py-1.5 text-sm bg-info/10 text-[#5b8fb9] rounded mx-1.5 cursor-pointer border-none"
          style={{ width: "calc(100% - 12px)" }}
        >
          <span className="mr-1">→</span>
          {t("labelUi.selectPrevStep")}
        </button>
        </>}
      </div>

      {/* 前手順ピッカー（クリック導線統一: RelationshipPicker） */}
      <RelationshipPicker
        open={showPrevStepPicker}
        onClose={() => setShowPrevStepPicker(false)}
        title={t("linking.title")}
        source={{
          label: t("linking.target"),
          chip: {
            text: getDisplayLabel("procedure"),
            style: { bg: "#5b8fb918", border: "#5b8fb9" },
          },
        }}
        sections={[
          {
            title: t("linking.sectionPickPrevStep"),
            candidates: headingCandidates.map<PickerCandidate>((c) => ({
              id: c.blockId,
              chips: [
                {
                  text: c.text || t("common.empty"),
                  style: { bg: "#5b8fb912", border: "#5b8fb9" },
                },
              ],
            })),
            emptyMessage: t("linking.noPrevStepCandidates"),
            onSelect: (c) => {
              _onPrevStepLinkSelected?.(blockId, c.id);
              setShowPrevStepPicker(false);
              onClose();
            },
          },
        ]}
      />
    </Dropdown>
  );
}

// ──────────────────────────────────
// LinkRow（リンク行）
// ──────────────────────────────────
function LinkRow({
  link,
  direction,
  label,
  onClick,
  onRemove,
}: {
  link: BlockLink;
  direction: "outgoing" | "incoming";
  label: string;
  onClick: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const conf = LINK_TYPE_CONFIG[link.type];
  // informed_by の incoming は "次手順" 表示（source が自分を informed_by している）
  const linkLabel =
    link.type === "informed_by" && direction === "incoming"
      ? t("linkType.informed_by.next")
      : conf.label;
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
        {linkLabel}
      </span>
      <button
        onClick={onClick}
        className="flex-1 text-left bg-transparent border-none cursor-pointer text-foreground text-xs p-0 hover:underline"
        title={t("common.clickToNavigate")}
      >
        {label}
      </button>
      <span className="text-[9px] text-muted-foreground">
        {CREATED_BY_LABELS[link.createdBy]}
      </span>
      <button
        onClick={onRemove}
        title={t("linkBadge.deleteLink")}
        className="bg-transparent border-none cursor-pointer text-muted-foreground text-xs px-0.5 hover:text-destructive"
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
export function ProvIndicatorHoverHint({ wrapperEl, zIndex, hidden = false }: { wrapperEl?: HTMLElement | null; zIndex?: number; hidden?: boolean } = {}) {
  const provLabelsEnabled = useProvLabelsEnabled();
  const { labels, openDropdown } = useLabelStore();
  const { links } = useLinkStore();
  const [hoverBlock, setHoverBlock] = useState<{
    blockId: string;
    top: number;
    left: number;
  } | null>(null);
  // # ボタンにマウスが乗っている間は hoverBlock を維持する
  const hintHoveredRef = useRef(false);

  useEffect(() => {
    // wrapper 内の mousemove でマウス Y 座標から最も近いブロックを判定
    // パディング領域にマウスがあっても対応するブロックの # が表示される
    const handleMouseMove = (e: MouseEvent) => {
      // # ボタンにマウスが乗っている間は更新しない
      if (hintHoveredRef.current) return;
      const wrapper = wrapperEl || document.querySelector("[data-label-wrapper]");
      if (!wrapper) return;

      const blockOuters = wrapper.querySelectorAll(
        '[data-node-type="blockOuter"]'
      );

      let matched: HTMLElement | null = null;
      let matchedDist = Infinity;

      blockOuters.forEach((el) => {
        const rect = el.getBoundingClientRect();
        const centerY = rect.top + rect.height / 2;
        const dist = Math.abs(e.clientY - centerY);
        if (e.clientY >= rect.top && e.clientY <= rect.bottom && dist < matchedDist) {
          matchedDist = dist;
          matched = el as HTMLElement;
        }
      });

      if (!matched) {
        setHoverBlock(null);
        return;
      }

      const matchedEl = matched as HTMLElement;
      const blockId = matchedEl.getAttribute("data-id");
      if (!blockId) return;

      // 既にラベルまたはリンクがあるブロックはスキップ
      if (labels.has(blockId)) {
        setHoverBlock(null);
        return;
      }
      const hasLink = links.some(
        (l) => l.sourceBlockId === blockId || l.targetBlockId === blockId
      );
      if (hasLink) {
        setHoverBlock(null);
        return;
      }

      const wrapperRect = wrapper.getBoundingClientRect();
      const content = matchedEl.querySelector(".bn-block-content") as HTMLElement | null;
      const rect = content ? content.getBoundingClientRect() : matchedEl.getBoundingClientRect();

      setHoverBlock({
        blockId,
        top: rect.top + rect.height / 2,
        left: wrapperRect.right - 8,
      });
    };

    const handleMouseLeave = () => {
      if (hintHoveredRef.current) return;
      setHoverBlock(null);
    };

    const wrapper = wrapperEl || document.querySelector("[data-label-wrapper]");
    if (!wrapper) return;
    wrapper.addEventListener("mousemove", handleMouseMove as EventListener);
    wrapper.addEventListener("mouseleave", handleMouseLeave as EventListener);
    return () => {
      wrapper.removeEventListener("mousemove", handleMouseMove as EventListener);
      wrapper.removeEventListener("mouseleave", handleMouseLeave as EventListener);
    };
  }, [labels, links, wrapperEl]);

  // 来歴ラベル機能がオフなら # 付与ヒントを出さない。
  if (!provLabelsEnabled || hidden || !hoverBlock) return null;

  // 対象ブロックのハイライト用 rect を取得
  const targetOuter = document.querySelector(
    `[data-id="${hoverBlock.blockId}"][data-node-type="blockOuter"]`
  ) as HTMLElement | null;
  const targetContent = targetOuter?.querySelector(".bn-block-content") as HTMLElement | null;
  const highlightRect = (targetContent || targetOuter)?.getBoundingClientRect();

  return createPortal(
    <>
      {/* 対象ブロックのハイライト */}
      {highlightRect && (
        <div
          className="fixed rounded-lg pointer-events-none"
          style={{
            zIndex: zIndex ?? 9,
            top: highlightRect.top - 2,
            left: highlightRect.left - 4,
            width: highlightRect.width + 8,
            height: highlightRect.height + 4,
            background: "rgba(75, 122, 82, 0.05)",
            border: "1.5px solid rgba(75, 122, 82, 0.15)",
          }}
        />
      )}
      {/* # ボタン */}
      <button
        onClick={() => openDropdown(hoverBlock.blockId)}
        onMouseEnter={() => { hintHoveredRef.current = true; }}
        onMouseLeave={() => { hintHoveredRef.current = false; setHoverBlock(null); }}
        data-prov-label-anchor={hoverBlock.blockId}
        data-prov-hover-hint="true"
        className="fixed inline-flex items-center justify-center w-5 h-5 rounded-lg border border-dashed border-border bg-transparent cursor-pointer text-muted-foreground text-xs opacity-50 pointer-events-auto hover:border-primary hover:text-primary hover:opacity-100 transition-colors duration-200"
        style={{
          zIndex: zIndex ? zIndex + 5 : 9996,
          top: hoverBlock.top,
          right: window.innerWidth - hoverBlock.left,
          transform: "translateY(-50%)",
        }}
      >
        #
      </button>
    </>,
    document.body
  );
}

// ──────────────────────────────────
// ScopeHighlight
// Chat タブがアクティブなとき、対象スコープのブロック群をハイライトする。
// blockIds に含まれるブロックの最小〜最大範囲を囲む。
// ──────────────────────────────────
export function ScopeHighlight({ blockIds }: { blockIds: string[] }) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (blockIds.length === 0) {
      setRect(null);
      return;
    }

    const update = () => {
      let top = Infinity;
      let bottom = -Infinity;
      let left = Infinity;
      let right = -Infinity;
      let found = false;

      for (const id of blockIds) {
        const el = document.querySelector(
          `[data-id="${id}"][data-node-type="blockOuter"]`
        ) as HTMLElement | null;
        if (!el) continue;
        const r = el.getBoundingClientRect();
        top = Math.min(top, r.top);
        bottom = Math.max(bottom, r.bottom);
        left = Math.min(left, r.left);
        right = Math.max(right, r.right);
        found = true;
      }

      setRect(found ? new DOMRect(left, top, right - left, bottom - top) : null);
    };

    update();
    const wrapper = document.querySelector("[data-label-wrapper]");
    wrapper?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    const interval = setInterval(update, 500);
    return () => {
      wrapper?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      clearInterval(interval);
    };
  }, [blockIds]);

  if (!rect) return null;

  return createPortal(
    <div
      className="fixed rounded-lg pointer-events-none z-[9]"
      style={{
        top: rect.top - 4,
        left: rect.left - 6,
        width: rect.width + 12,
        height: rect.height + 8,
        background: "rgba(139, 92, 246, 0.08)",
        border: "1.5px solid rgba(139, 92, 246, 0.2)",
      }}
    />,
    document.body
  );
}

// ──────────────────────────────────
// BlockHoverHighlight
// エディタ内の全ブロックにホバーハイライトを表示する独立コンポーネント。
// ラベルの有無に関係なく動作する。
// ──────────────────────────────────
export function BlockHoverHighlight({ wrapperEl, zIndex = 9 }: { wrapperEl?: HTMLElement | null; zIndex?: number } = {}) {
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);

  useEffect(() => {
    const wrapper = wrapperEl || document.querySelector("[data-label-wrapper]");
    if (!wrapper) return;

    const handleOver = (e: Event) => {
      const target = (e as MouseEvent).target as HTMLElement;
      const blockOuter = target.closest(
        '[data-node-type="blockOuter"]'
      ) as HTMLElement | null;
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
  }, [wrapperEl]);

  if (!hoveredBlockId) return null;

  const outer = document.querySelector(
    `[data-id="${hoveredBlockId}"][data-node-type="blockOuter"]`
  ) as HTMLElement | null;
  if (!outer) return null;

  const content = outer.querySelector(".bn-block-content") as HTMLElement | null;
  const rect = (content || outer).getBoundingClientRect();

  return createPortal(
    <div
      className="fixed rounded-lg pointer-events-none"
      style={{
        zIndex,
        top: rect.top - 2,
        left: rect.left - 4,
        width: rect.width + 8,
        height: rect.height + 4,
        background: "rgba(75, 122, 82, 0.05)",
        border: "1.5px solid rgba(75, 122, 82, 0.15)",
      }}
    />,
    document.body
  );
}
