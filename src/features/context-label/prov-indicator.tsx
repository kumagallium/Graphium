// ──────────────────────────────────────────────
// ProvIndicatorLayer
//
// position:fixed オーバーレイで各ブロックの PROV ラベルを表示する。
// - 見出し等（レガシー）: エディタ右端マージンのバッジ
// - テーブル: ヘッダー上のメタデータ領域に右寄せのチップ
//   （領域は data-block-label-space 属性 + CSS の padding-top で実確保する。
//    ラベル付きのときだけ現れ、前のブロックと重ならない）
// クリックで統合パネル（ラベル変更 + リンク一覧 + リンク追加）を開く。
// ──────────────────────────────────────────────

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLabelStore, useProvLabelsEnabled } from "./store";
import { deriveActivityName } from "./activity-name";
import { useLinkStore } from "../block-link/store";
import { resolveTableChipPlacement, TABLE_CHIP_STACK_OFFSET } from "./table-chip-position";
import { findChipContainerRight } from "./table-chip-container";
import { CAPTION_ROW_ATTR, watchCaptionTargets, type CaptionWatch } from "./caption-watch";
import { compactBadgeText } from "./compact-badge";
import { getVisibleCoreLabels } from "./label-visibility";
import { NARROW_PANE_ATTR } from "../../lib/pane-layout";
import {
  LINK_TYPE_CONFIG,
  CREATED_BY_LABELS,
  type BlockLink,
} from "../block-link/link-types";
import { Dropdown, DropdownSectionHeader, DropdownDivider } from "@ui/dropdown";
import { MenuItem } from "@ui/menu-item";
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
  // Output Entity は v3→v4 で "result" から "output" に改名された。
  // 新しいキーが無いとフォールバックのグレーになり、ラベルだけ色を失う（実バグ）
  output: "#c26356",
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
  /** ビューポート座標。詳細パネル（画面基準の fixed）が使う */
  top: number;
  /** バッジ右端の x 座標（margin: エディタ右端 / table: テーブル右端） */
  left: number;
  /**
   * エディタラッパー内の座標（スクロール量込み）。バッジはこれを使って
   * ラッパーの中に absolute で置く。ラッパーと一緒に動くので、スクロールに
   * 遅れない — fixed + JS 追随では、スクロールを処理するスレッドと座標を
   * 計算するスレッドが違うため、必ずワンテンポずれる。
   */
  localTop: number;
  localLeft: number;
  label: string | undefined;
  /** ブロック型（step コンテナはラベル無しでも工程として扱うため必要） */
  blockType: string | undefined;
  /**
   * バッジの置き方。
   * - margin: エディタ右端マージンに右揃え（レガシー見出しラベル用）
   * - table: テーブルヘッダー上のメタデータ領域に右寄せのチップ
   *   （ブロックラベル UI はインライン移行済みで、テーブルだけが現役。
   *    右余白に浮かせず本体に寄せて「このテーブルに付くラベル」を示す）
   */
  placement: "margin" | "table";
  /**
   * 本文枠が狭いときの margin バッジの縮小表示（1 文字）。右の溝が 24px 前後しか無く、
   * ラベル名の全文が本文の文字に被るため。table のチップには使わない（表の上に置く）。
   */
  compact: boolean;
  outgoing: BlockLink[];
  incoming: BlockLink[];
};

// テーブルチップとテーブル上辺の間隔
const TABLE_CHIP_GAP = 4;

// エディタラッパーの表示範囲（ラベルをクリップするため）

// ──────────────────────────────────
// ProvIndicatorLayer
// ──────────────────────────────────
export function ProvIndicatorLayer({
  wrapperEl,
  hidden = false,
}: {
  wrapperEl?: HTMLElement | null;
  /** モバイルで全画面オーバーレイ（右パネル）が開いている間はラベルを描画しない */
  hidden?: boolean;
} = {}) {
  const provLabelsEnabled = useProvLabelsEnabled();
  const { labels, getLabel, setLabel, openBlockId } = useLabelStore();
  const { links, getOutgoing, getIncoming, removeLink } = useLinkStore();
  const [indicators, setIndicators] = useState<IndicatorInfo[]>([]);
  // バッジのポータル先。ラッパーの中に置くことで overflow が自然にクリップし、
  // z-index もラッパー内に閉じる（画面全面に出ないのでメニューを覆わない）
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  // メタデータ領域（padding-top）を予約したテーブルの blockId。
  // ラベルが外れたら compute が予約を解除する。
  const spacedTablesRef = useRef<Set<string>>(new Set());
  // 描画済みテーブルチップの実幅。狭い表でチップを名前の行の右隣へ逃がすために使う。
  // チップは描いてからでないと測れないので、描画後に測って（下の useLayoutEffect）
  // 変わっていれば描き直す
  const chipWidthsRef = useRef<Map<string, number>>(new Map());
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
    setPortalHost(wrapper as HTMLElement);
    const scrollTop = (wrapper as HTMLElement).scrollTop ?? 0;
    const scrollLeft = (wrapper as HTMLElement).scrollLeft ?? 0;
    // ビューポート座標 → ラッパー内座標
    const toLocalTop = (y: number) => y - wrapperRect.top + scrollTop;
    const toLocalLeft = (x: number) => x - wrapperRect.left + scrollLeft;
    // サイドバー境界の左にラベルを配置（8px の余白）。
    // SidePeek との重なりを避ける計算はもう要らない — ラッパーの中に描くので、
    // 外側にある要素とは stacking context が分かれる。
    const indicatorLeft = wrapperRect.right - 8;
    // 本文枠が狭いか（note-app が枠の幅を測って data-narrow-pane を付ける。サイドピークの枠には付かない）
    const narrow = wrapper.hasAttribute(NARROW_PANE_ATTR);

    const next: IndicatorInfo[] = [];
    const spacedTables = new Set<string>();
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
      const blockType = content?.getAttribute("data-content-type") ?? undefined;
      const outgoing = getOutgoing(blockId);
      const incoming = getIncoming(blockId);

      // ラベルもリンクもないブロックはスキップ。
      // step も同様（前手順の導線はカード自身のヘッダーが持つ。
      // ここに出すとラベル未定義のバッジが「#」として右余白に浮いてしまう）。
      if (!label && outgoing.length === 0 && incoming.length === 0) {
        return;
      }

      // テーブルはヘッダー上のメタデータ領域（padding-top で実確保）に
      // チップを右寄せで置く。content 要素はブロック全幅のため、
      // 内容依存幅のテーブル実体（<table>）を測って右端に合わせる。
      const isTable = blockType === "table";
      if (isTable && content) {
        if (label) {
          content.setAttribute("data-block-label-space", "");
          spacedTables.add(blockId);
        } else {
          content.removeAttribute("data-block-label-space");
        }
      }
      const tableEl = isTable
        ? (content?.querySelector("table") as HTMLElement | null)
        : null;
      const anchorRect = tableEl ? tableEl.getBoundingClientRect() : rect;
      // 横スクロール中のテーブルは右端が content の外へ出るためクランプする
      const tableRight = content
        ? Math.min(anchorRect.right, content.getBoundingClientRect().right)
        : anchorRect.right;

      // 表が狭いと、左上の名前の行（「表 N ⤢」）と右揃えのチップが重なる。
      // 名前の行の実幅が取れたときだけ、チップを名前の行の右隣まで押し出す
      // （表が十分広ければ従来どおり表の右端。取れなければ今の位置のまま）
      const captionRowEl = isTable
        ? wrapper.querySelector<HTMLElement>(`[${CAPTION_ROW_ATTR}="${blockId}"]`)
        : null;
      // 右隣へ押し出した先がステップのカード（などの入れ物）の右端を超えるときは、名前の行の上へ積む
      const chipPlacement = isTable
        ? resolveTableChipPlacement({
            tableLeft: anchorRect.left,
            tableRight,
            captionWidth: captionRowEl ? captionRowEl.getBoundingClientRect().width : null,
            chipWidth: chipWidthsRef.current.get(blockId) ?? null,
            maxRight: findChipContainerRight(outer, wrapperRect.right - 8),
          })
        : null;
      const viewportTop = isTable
        ? anchorRect.top - TABLE_CHIP_GAP - (chipPlacement?.stacked ? TABLE_CHIP_STACK_OFFSET : 0)
        : rect.top + rect.height / 2;
      const viewportLeft = chipPlacement ? chipPlacement.right : indicatorLeft;
      next.push({
        blockId,
        top: viewportTop,
        left: viewportLeft,
        localTop: toLocalTop(viewportTop),
        localLeft: toLocalLeft(viewportLeft),
        label,
        blockType,
        placement: isTable ? "table" : "margin",
        compact: !isTable && narrow,
        outgoing,
        incoming,
      });
    });

    // ラベルが外れた（または走査対象から消えた）テーブルの領域予約を解除する
    spacedTablesRef.current.forEach((blockId) => {
      if (spacedTables.has(blockId)) return;
      const el = queryRoot.querySelector(
        `[data-id="${blockId}"] .bn-block-content[data-content-type="table"]`
      );
      el?.removeAttribute("data-block-label-space");
    });
    spacedTablesRef.current = spacedTables;

    setIndicators(next);
  }, [labels, links, getLabel, getOutgoing, getIncoming, wrapperEl]);

  useEffect(() => {
    const raf = requestAnimationFrame(compute);
    return () => cancelAnimationFrame(raf);
  }, [compute]);

  // 描いたテーブルチップの実幅を測る。前回測った幅と違えば、描画の直後（ペイント前）に
  // 位置を測り直す。幅は測った値で確定するので、二度目以降は変わらずループしない
  useLayoutEffect(() => {
    if (!portalHost) return;
    let changed = false;
    const seen = new Set<string>();
    for (const ind of indicators) {
      if (ind.placement !== "table" || !ind.label) continue;
      seen.add(ind.blockId);
      const chip = portalHost.querySelector<HTMLElement>(
        `[data-prov-label-anchor="${ind.blockId}"]`
      );
      const width = chip ? chip.offsetWidth : 0;
      if (width <= 0) continue;
      const prev = chipWidthsRef.current.get(ind.blockId);
      if (prev === undefined || Math.abs(prev - width) > 0.5) {
        chipWidthsRef.current.set(ind.blockId, width);
        changed = true;
      }
    }
    // 消えたチップの幅は捨てる
    for (const id of [...chipWidthsRef.current.keys()]) {
      if (!seen.has(id)) chipWidthsRef.current.delete(id);
    }
    if (changed) compute();
  }, [indicators, portalHost, compute]);

  useEffect(() => {
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    const wrapper = wrapperEl ?? document.querySelector("[data-label-wrapper]");
    let ro: ResizeObserver | undefined;
    let mo: MutationObserver | undefined;
    let narrowMo: MutationObserver | undefined;
    let captionWatch: CaptionWatch | undefined;
    if (wrapper) {
      // エディタラッパーの幅変化を監視（右パネル展開/折りたたみ時の再計算）
      ro = new ResizeObserver(compute);
      ro.observe(wrapper);
      // 名前の行の幅・表の上余白 <style> の出現と書き換え・本文の高さも拾う（対象を絞った
      // 監視。経緯は caption-watch.ts）。名前の行は狭い表でチップを名前の行の右隣へ逃がす位置、
      // <style> と本文の高さは上余白が反映された後の表の位置を測り直すために要る。
      // 後から出る <style>・エディタの購読は watchCaptionTargets が自分で張り直す
      captionWatch = watchCaptionTargets(wrapper, ro, () => {
        requestAnimationFrame(compute);
      });
      captionWatch.sync();
      // ブロックの追加・削除を監視（ラベルなしブロックの変更でも位置を再計算）
      mo = new MutationObserver(() => {
        requestAnimationFrame(compute);
      });
      mo.observe(wrapper, { childList: true, subtree: true });
      // 本文枠が狭い ⇄ 広いに切り替わると、右の溝の幅（= margin バッジの置き場）が変わる。
      // 印は幅の変化の後に React が付けるので、ResizeObserver とは別に属性の変化でも測り直す
      narrowMo = new MutationObserver(() => {
        requestAnimationFrame(compute);
      });
      narrowMo.observe(wrapper, { attributes: true, attributeFilter: [NARROW_PANE_ATTR] });
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
      narrowMo?.disconnect();
      captionWatch?.disconnect();
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

  const badges = (
    <>
      {indicators.map(({ blockId, top, left, localTop, localLeft, label, blockType, placement, compact, outgoing, incoming }) => {
        const isActive = activeBlockId === blockId;
        const color = label ? getLabelColor(label) : undefined;

        // ラベルがないブロックは右側に何も表示しない
        if (!label) return null;

        const isTableChip = placement === "table";
        const displayLabel = getDisplayLabel(label);
        // 狭い枠の margin バッジは頭の 1 文字だけにして右の溝（24px 前後）に収める。全文は title と統合パネルにある。
        // 表示名の角括弧は飛ばす（そのままだとどのラベルも「[」になる）
        const badgeText = compact ? compactBadgeText(displayLabel) : displayLabel;

        return (
          <div key={blockId}>
            {/* ラベルバッジ（右揃え。margin はブロック中央の高さ、
                table はメタデータ領域内 = テーブル上辺の上に置く） */}
            <button
              onClick={() =>
                setActiveBlockId(isActive ? null : blockId)
              }
              data-prov-label-anchor={blockId}
              title={tStatic("provIndicator.clickForDetails", { label: displayLabel })}
              className="absolute z-[5] inline-block rounded-full text-xs font-semibold cursor-pointer select-none whitespace-nowrap pointer-events-auto"
              style={{
                top: localTop,
                left: localLeft,
                transform: isTableChip
                  ? "translate(-100%, -100%)"
                  : "translate(-100%, -50%)",
                padding: compact ? "0px" : "0px 6px",
                ...(compact ? { minWidth: 20, textAlign: "center" as const } : null),
                backgroundColor: color + "18",
                color: color,
                border: `1px solid ${color}38`,
                lineHeight: 1.6,
              }}
            >
              {badgeText}
            </button>

            {/* 統合パネル */}
            {isActive && (
              <ProvPanel
                blockId={blockId}
                top={top + 14}
                left={left}
                label={label}
                blockType={blockType}
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
    </>
  );

  // ラッパーが見つかるまでは描かない（compute が走れば埋まる）。
  // パネルは画面基準の fixed のままなので、ラッパー内に置いても位置は変わらない。
  return portalHost ? createPortal(badges, portalHost) : null;
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
  blockType,
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
  blockType: string | undefined;
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

  // パネル位置の調整（画面端対応）
  const adjustedTop = Math.min(top, window.innerHeight - 400);
  const adjustedLeft = Math.min(left, window.innerWidth - 260);

  const linkCount = outgoing.length + incoming.length;
  const color = label ? getLabelColor(label) : "var(--color-text-tertiary)";

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

            {/* PROV に乗らない自由タグ（フリーラベル）は廃止した。
                ブロックに付けられるのは PROV ラベルだけにして、
                「何のためのラベルか」を一つに絞る。
                既存ノートに付いている自由タグはデータとして残り、下の
                「ラベルを外す」で解除できる。 */}

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

        {/* ── 前手順リンク追加（procedure ラベル or step コンテナ） ── */}
        {(label === "procedure" || blockType === "step") && <>
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
                // 手順は「procedure ラベル付き見出し」と「step コンテナ」の 2 通り
                const isStep = !!el.querySelector(
                  '.bn-block-content[data-content-type="step"]',
                );
                if (labelMap.get(bid) !== "procedure" && !isStep) return;
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
  const [rect, setRect] = useState<DOMRect | null>(null);

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

  // ホバー対象ブロックの座標を計算する。position:fixed のオーバーレイは
  // スクロールしても再描画されないため、scroll（capture）/resize を購読して
  // 実ブロックと同じ位置に描き直す。購読しないとスクロール中に背景がズレる。
  useEffect(() => {
    if (!hoveredBlockId) {
      setRect(null);
      return;
    }
    const update = () => {
      const outer = document.querySelector(
        `[data-id="${hoveredBlockId}"][data-node-type="blockOuter"]`
      ) as HTMLElement | null;
      if (!outer) {
        setRect(null);
        return;
      }
      const content = outer.querySelector(".bn-block-content") as HTMLElement | null;
      setRect((content || outer).getBoundingClientRect());
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [hoveredBlockId]);

  if (!rect) return null;

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
