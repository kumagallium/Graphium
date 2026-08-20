// Step ブロック — 手順（Activity）を children を持つコンテナとして第一級化する
//
// 設計: docs/internal/step-container-block-design-2026-07.md
//
// - タイトルは block の content に持たせる（props ではない）。
//   generator が deriveActivityName(getBlockText(block)) で読むため。
// - children（本文・表・画像・コード）は BlockNote が nested blockGroup として描画する。
//   並べ替え・出し入れは標準のドラッグハンドルに委ねる。
// - 枠線とヘッダー地色は app.css（.bn-block:has(> .react-renderer.node-step)）にある。
//
// ヘッダーの「前手順」ボタンについて:
//   工程の連なり（informed_by）は、以前は左端の PROV インジケータからしか張れなかった。
//   カード自身に導線を置くのは、工程の順序が step の第一級の性質だから。
//   なお step の子ブロックのドラッグハンドルメニューは使えない — ハンドルへマウスを
//   寄せる途中でホバー対象が step 自身に切り替わってしまう（実測）。カード上の
//   コントロールはその制約も回避する。

import { createReactBlockSpec } from "@blocknote/react";
import { defaultProps } from "@blocknote/core";
import { TextSelection } from "prosemirror-state";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, History, Link2, ListChecks, Plus } from "lucide-react";
import { useLinkStore } from "../../features/block-link/store";
import { useLabelStore } from "../../features/context-label/store";
import { deriveActivityName } from "../../features/context-label/activity-name";
import { appendEntitySpanToStep, collectStepOutputs, stepHasInputText } from "./step-io";
import { StepHistoryPicker } from "../../features/network-graph/StepHistoryPicker";
import {
  collectParamKeysForStep,
  collectStepNames,
  getLatestProcessIndex,
} from "../../features/network-graph/process-index";
import { splitAttrLabel } from "../../features/network-graph/activity-graph-adapter";
import { t, useLocaleSubscription } from "../../i18n";

/** inline content からプレーンテキストを取り出す */
function inlineText(block: any): string {
  if (!Array.isArray(block?.content)) return "";
  return block.content
    .map((c: any) => (c?.type === "text" ? c.text : ""))
    .join("");
}

export type StepLinkCandidate = { blockId: string; title: string };

/**
 * 選択位置が step の中にあるか（ProseMirror の祖先を辿る）。
 * ハイライト（材料/ツール等）の付与 UI は step の中でだけ出す —
 * 工程の外の Entity は束縛先の Activity が無く宙に浮くだけなので、
 * 「ステップを使う人にだけ現れる」構造的な段階的開示にする。
 */
export function isSelectionInsideStep(editor: any): boolean {
  try {
    const $from =
      editor.prosemirrorState?.selection?.$from ??
      editor.prosemirrorView?.state?.selection?.$from;
    if (!$from) return false;
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d);
      // step のタイトル内: 祖先に step content ノードそのものがいる
      if (node?.type?.name === "step") return true;
      // step の子ブロック内: PM ツリーでは子は step ノードの中ではなく
      // blockContainer（先頭子が step content）の blockGroup 側にいる。
      // そのため「firstChild が step の blockContainer」を祖先に持つかで判定する。
      if (
        node?.type?.name === "blockContainer" &&
        node.firstChild?.type?.name === "step"
      ) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * 選択が step の「タイトル行」内にあるか。
 * タイトルは Activity の名前（rdfs:label）であって工程の中身ではないので、
 * インラインラベル（ハイライト）の付与対象から外すために使う。
 * isSelectionInsideStep はタイトルも本文も true になるため、
 * 本文限定の判定は `isSelectionInsideStep && !isSelectionInStepTitle` で行う。
 */
export function isSelectionInStepTitle(editor: any): boolean {
  try {
    const $from =
      editor.prosemirrorState?.selection?.$from ??
      editor.prosemirrorView?.state?.selection?.$from;
    if (!$from) return false;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d)?.type?.name === "step") return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** 指定ブロックが step の子孫か（ブロックツリーを辿る。テーブル/メディアのラベル導線用） */
export function isBlockInsideStep(doc: any[], blockId: string): boolean {
  let inside = false;
  const walk = (list: any[], inStep: boolean): boolean => {
    for (const b of list ?? []) {
      if (!b || typeof b !== "object") continue;
      if (b.id === blockId) {
        inside = inStep;
        return true;
      }
      if (
        Array.isArray(b.children) &&
        walk(b.children, inStep || b.type === "step")
      ) {
        return true;
      }
    }
    return false;
  };
  walk(doc, false);
  return inside;
}

/** 文書中の全 step を文書順に列挙する（除外なし。連番・タイトル解決用） */
export function collectAllSteps(doc: any[]): StepLinkCandidate[] {
  const out: StepLinkCandidate[] = [];
  const walk = (list: any[]) => {
    for (const b of list ?? []) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "step" && b.id) {
        const title = deriveActivityName(inlineText(b)).trim();
        out.push({ blockId: b.id, title: title || b.id.slice(0, 8) });
      }
      if (Array.isArray(b.children)) walk(b.children);
    }
  };
  walk(doc);
  return out;
}

/**
 * 新しい step のデフォルトタイトル（「ステップ N」）。
 * 空タイトルのままだと Activity 名が空になり、右パネルのグラフにノードが
 * 立たない。実テキストを入れておけば作った瞬間からグラフに現れる。
 */
export function buildDefaultStepTitle(doc: any[]): string {
  return t("step.defaultTitle", { n: String(collectAllSteps(doc).length + 1) });
}

/**
 * step のタイトル全体を選択してフォーカスする（リネーム UX）。
 * デフォルトタイトルはそのまま打てば置き換わる。選択に失敗したら末尾カーソル。
 */
export function selectStepTitle(editor: any, blockId: string): void {
  setTimeout(() => {
    try {
      const view = editor.prosemirrorView;
      let found: { pos: number; node: any } | null = null;
      view.state.doc.descendants((node: any, pos: number) => {
        if (found) return false;
        if (node.attrs?.id === blockId) {
          found = { pos, node };
          return false;
        }
        return true;
      });
      if (!found) return;
      // blockContainer(+1) > step content(+1) → inline の先頭
      const content = (found as { pos: number; node: any }).node.firstChild;
      const from = (found as { pos: number; node: any }).pos + 2;
      const to = from + (content?.content?.size ?? 0);
      view.dispatch(
        view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)),
      );
      view.focus();
    } catch {
      try {
        editor.setTextCursorPosition(blockId, "end");
        editor.focus();
      } catch {
        /* no-op */
      }
    }
  }, 0);
}

/**
 * 前手順の候補（step ブロック）を文書順に集める。
 * タイトルは Activity 名と同じ流儀（連番プレフィックスを除く）で整える。
 *
 * 自分自身に加えて、自分の子孫（内部工程）と祖先（自分を包む工程）も除外する。
 * 親子関係は containment として既に PROV に乗っており、そこへ informed_by を
 * 重ねると「含む」と「先行する」が同じ 2 つの工程に両立してしまう。
 */
export function collectStepPredecessorCandidates(
  doc: any[],
  selfId: string,
): StepLinkCandidate[] {
  const out: StepLinkCandidate[] = [];
  // 戻り値: このサブツリーに自分がいたか（いたら呼び出し元の step は祖先）
  const walk = (list: any[]): boolean => {
    let containsSelf = false;
    for (const b of list ?? []) {
      if (!b || typeof b !== "object") continue;
      if (b.id === selfId) {
        containsSelf = true;
        continue; // 自分の子孫には入らない
      }
      let entry: StepLinkCandidate | null = null;
      if (b.type === "step" && b.id) {
        const title = deriveActivityName(inlineText(b)).trim();
        entry = { blockId: b.id, title: title || b.id.slice(0, 8) };
        out.push(entry);
      }
      if (Array.isArray(b.children) && walk(b.children)) {
        containsSelf = true;
        // 自分を含むサブツリーの根 = 祖先 step。候補から外す
        if (entry) out.splice(out.indexOf(entry), 1);
      }
    }
    return containsSelf;
  };
  walk(doc);
  return out;
}

export const StepBlock = createReactBlockSpec(
  {
    type: "step" as const,
    propSchema: {
      // 配置は BlockNote 標準の既定プロパティを流用
      textAlignment: defaultProps.textAlignment,
      // 表示バリアント（構造メタ）。タイトルはここに入れない
      variant: { default: "step" as const },
    },
    content: "inline" as const,
  },
  {
    render: (props) => {
      // 言語切替でラベルを引き直す（BlockNote の render は Context を辿れないため購読する）
      useLocaleSubscription();
      const linkStore = useLinkStore();
      const labelStore = useLabelStore();
      const [pickerOpen, setPickerOpen] = useState(false);
      // 前手順ピッカーで出力サブメニューを開いているステップ（blockId）
      const [openOutputsFor, setOpenOutputsFor] = useState<string | null>(null);
      // 後続（次ステップ）側のピッカー
      const [nextOpen, setNextOpen] = useState(false);
      // 過去の手順からの引き継ぎピッカー（名前 → パラメータの 2 段）
      const [paramOpen, setParamOpen] = useState(false);
      // ピッカー内で選んだ手順名。タイトル反映が本文に届くまでの間もこちらを正とする
      const [pickedName, setPickedName] = useState<string | null>(null);
      // 循環でリンクを拒否されたとき、無反応に見えないよう理由を出す
      const [cycleWarn, setCycleWarn] = useState(false);
      const rootRef = useRef<HTMLDivElement>(null);

      // 外側クリックでピッカーを閉じる（callout の variant ピッカーと同じ流儀）
      useEffect(() => {
        if (!pickerOpen && !nextOpen && !paramOpen) return;
        const onDown = (e: MouseEvent) => {
          if (!rootRef.current?.contains(e.target as Node)) {
            setPickerOpen(false);
            setNextOpen(false);
            setParamOpen(false);
            setOpenOutputsFor(null);
          }
        };
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
      }, [pickerOpen, nextOpen, paramOpen]);

      // 過去の同名手順で使われたパラメータの key。
      // 開いた瞬間だけ読めばよいので購読しない（投影は一覧を開いたときに更新される）。
      const stepTitle = deriveActivityName(inlineText(props.block)).trim();
      // paramOpen を依存に入れているのは、開くときに最新の投影を読み直すため
      // （投影は一覧を開いた時点で更新され、こちらは購読していない）。
      const effectiveName = pickedName ?? stepTitle;
      const paramStats = useMemo(
        () => collectParamKeysForStep(getLatestProcessIndex(), effectiveName, splitAttrLabel),
        [effectiveName, paramOpen],
      );
      const stepNameStats = useMemo(
        () => collectStepNames(getLatestProcessIndex(), splitAttrLabel),
        [paramOpen],
      );
      // 過去に書いた手順が 1 つでもあれば入口を出す。名前だけでも選ぶ価値がある
      // （記録の無い名前を打ったときに沈黙するのが、いちばん困る）
      const hasHistory = stepNameStats.length > 0;
      // まだ名前が無い step には、アイコンを押せることを言葉でも伝える
      const showHistoryHint = hasHistory && stepTitle.length === 0;

      // この step の前手順（outgoing informed_by）と後続（incoming informed_by）。
      // どちらも複数可（合流・分岐する工程）。
      const prevLinks = linkStore
        .getOutgoing(props.block.id)
        .filter((l) => l.type === "informed_by");
      const nextLinks = linkStore
        .getIncoming(props.block.id)
        .filter((l) => l.type === "informed_by");

      const doc: any[] = (props.editor as any).document ?? [];
      const candidates = collectStepPredecessorCandidates(doc, props.block.id);
      const allSteps = collectAllSteps(doc);
      const titleOf = (blockId: string) =>
        allSteps.find((c) => c.blockId === blockId)?.title ?? blockId.slice(0, 8);

      const toggleCandidate = (blockId: string) => {
        const existing = prevLinks.find((l) => l.targetBlockId === blockId);
        if (existing) {
          linkStore.removeLink(existing.id);
          setCycleWarn(false);
          return;
        }
        const result = linkStore.addLink({
          sourceBlockId: props.block.id,
          targetBlockId: blockId,
          type: "informed_by",
          createdBy: "human",
        });
        // 循環（A←B かつ B←A 等）は store が拒否する。チェックが付かない理由を示す
        setCycleWarn(result.error === "cycle_detected");
      };

      const linked = prevLinks.length > 0;
      const chipText = linked
        ? `← ${titleOf(prevLinks[0].targetBlockId)}${prevLinks.length > 1 ? ` +${prevLinks.length - 1}` : ""}`
        : t("step.prevLink");

      // 出力を選んで受ける: 自分の本文に同名の材料 span を合成し（テキスト
      // 一致の unification が出力と 1 Entity に merge する）、手順順序
      // （informed_by）も張る。「どのバッチから」を本文側から特定する導線。
      const pickOutput = (prevBlockId: string, outputLabel: string) => {
        const editor = props.editor as any;
        appendEntitySpanToStep(editor, props.block.id, "material", outputLabel);
        if (!prevLinks.some((l) => l.targetBlockId === prevBlockId)) {
          const result = linkStore.addLink({
            sourceBlockId: props.block.id,
            targetBlockId: prevBlockId,
            type: "informed_by",
            createdBy: "human",
          });
          setCycleWarn(result.error === "cycle_detected");
          if (result.error === "cycle_detected") return;
        }
        setPickerOpen(false);
      };

      // 後続側の候補: 前手順候補と同じ除外規則（自分・祖先・子孫を除く）に、
      // 既にリンク済みだが候補外の後続（旧 UI で張られた等）を足して外せるようにする
      const nextRows: StepLinkCandidate[] = [
        ...candidates,
        ...nextLinks
          .filter((l) => !candidates.some((c) => c.blockId === l.sourceBlockId))
          .map((l) => ({ blockId: l.sourceBlockId, title: titleOf(l.sourceBlockId) })),
      ];

      const toggleNext = (blockId: string) => {
        const existing = nextLinks.find((l) => l.sourceBlockId === blockId);
        if (existing) {
          linkStore.removeLink(existing.id);
          setCycleWarn(false);
          return;
        }
        // 後続リンク = 相手の前手順を自分にする（source が相手・target が自分）
        const result = linkStore.addLink({
          sourceBlockId: blockId,
          targetBlockId: props.block.id,
          type: "informed_by",
          createdBy: "human",
        });
        setCycleWarn(result.error === "cycle_detected");
      };

      // 次ステップ: この step の直後に新しい step を作り、前手順を自分に張った
      // 状態で渡す。工程は連なって書かれるものなので、次を作るたびに
      // 「挿入 → タイトル → 前手順を選ぶ」を繰り返させない。
      // タイトルは「ステップ N」を実テキストで入れて全選択で渡す
      // （空タイトルだとグラフにノードが立たない。打てばそのまま置き換わる）。
      const createNextStep = () => {
        const editor = props.editor as any;
        const inserted = editor.insertBlocks(
          [
            {
              type: "step",
              content: [
                { type: "text", text: buildDefaultStepTitle(doc), styles: {} },
              ],
              children: [{ type: "paragraph" }],
            },
          ],
          props.block.id,
          "after",
        );
        const newId = inserted?.[0]?.id;
        if (!newId) return;
        linkStore.addLink({
          sourceBlockId: newId,
          targetBlockId: props.block.id,
          type: "informed_by",
          createdBy: "human",
        });
        setNextOpen(false);
        selectStepTitle(editor, newId);
      };

      return (
        <div
          ref={rootRef}
          data-test="step-block"
          style={{
            display: "flex",
            // 幅が足りないときはチップ群が下の行へ落ちる（タイトルを潰さない）
            flexWrap: "wrap",
            gap: 8,
            alignItems: "flex-start",
            fontWeight: 600,
            width: "100%",
          }}
        >
          {/* アイコン + ステップ名を 1 ユニットで折り返す（アイコンだけ孤立させない）。
              minWidth を確保しないと、狭幅でチップに押されてタイトルが
              1 文字ずつ縦に折り返す（実測）。足りなければチップ側が下の行へ wrap する */}
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
              flex: "1 1 auto",
              minWidth: "12ch",
            }}
          >
            {/* ステップアイコン。過去の手順からの引き継ぎ入口を兼ねる。
                名前を打ち終わるまで出ないチップだと、書く前に選べず、
                記録の無い名前では沈黙するだけだった（実データで確認）。
                アイコンなら位置が動かず、タイトルが空でも押せる。 */}
            <span
              contentEditable={false}
              style={{ flex: "0 0 auto", position: "relative", marginTop: 2 }}
            >
              <button
                type="button"
                onClick={() => {
                  if (!hasHistory) return;
                  setParamOpen((v) => !v);
                  setPickerOpen(false);
                  setNextOpen(false);
                  setOpenOutputsFor(null);
                }}
                title={hasHistory ? t("stepHistory.namesTitle") : undefined}
                aria-expanded={hasHistory ? paramOpen : undefined}
                aria-label={hasHistory ? t("stepHistory.namesTitle") : undefined}
                data-test="step-history-icon"
                style={{
                  display: "inline-flex",
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  color: "var(--color-primary)",
                  cursor: hasHistory ? "pointer" : "default",
                }}
              >
                <ListChecks size={18} strokeWidth={2} />
              </button>
              {paramOpen && (
                <StepHistoryPicker
                  stepName={effectiveName}
                  stepNames={stepNameStats}
                  stats={paramStats}
                  onPickName={(name) => {
                    setPickedName(name);
                    try {
                      props.editor.updateBlock(props.block.id, {
                        content: [{ type: "text", text: name, styles: {} }],
                      } as any);
                    } catch {
                      // タイトルを書けなくてもパラメータは選べる（致命ではない）
                    }
                  }}
                  onInsert={(keys: string[]) => {
                    // 空欄の行として本文末尾に足す。値はユーザーが書く
                    for (const key of keys) {
                      appendEntitySpanToStep(props.editor, props.block.id, "attribute", `${key}:`);
                    }
                  }}
                  onClose={() => setParamOpen(false)}
                />
              )}
            </span>
            {/* ステップ名（インライン編集領域＝タイトルは content） */}
            <div style={{ flex: "1 1 auto", minWidth: 0, position: "relative" }}>
              <div ref={props.contentRef} style={{ lineHeight: "1.6" }} />
              {showHistoryHint && (
                <span
                  contentEditable={false}
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    lineHeight: "1.6",
                    fontWeight: 400,
                    fontSize: 13,
                    color: "var(--color-text-tertiary)",
                    pointerEvents: "none",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: "100%",
                  }}
                >
                  {t("stepHistory.titlePlaceholder")}
                </span>
              )}
            </div>
          </div>
          {/* 名前がまだ無いときだけ、言葉でも入口を出す。アイコンは場所が安定して
              いる代わりに気づかれにくく、最初の一度をここで助ける。名前を書き始め
              れば消えるので、チップが常に 3 つ並ぶことにはならない。 */}
          {showHistoryHint && (
            <button
              type="button"
              contentEditable={false}
              onClick={() => {
                setParamOpen(true);
                setPickerOpen(false);
                setNextOpen(false);
                setOpenOutputsFor(null);
              }}
              data-test="step-history-chip"
              style={{
                flex: "0 0 auto",
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                marginTop: 1,
                padding: "0 8px",
                height: 20,
                borderRadius: 10,
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
                lineHeight: "18px",
                whiteSpace: "nowrap",
                border: "1px dashed var(--color-border)",
                background: "transparent",
                color: "var(--color-text-tertiary)",
              }}
            >
              <History size={11} strokeWidth={2.2} />
              {t("stepHistory.button")}
            </button>
          )}
          {/* 前手順リンク（編集不可）。informed_by を張る・外す */}
          <div
            contentEditable={false}
            style={{ position: "relative", flex: "0 0 auto" }}
          >
            <button
              type="button"
              onClick={() => {
                setPickerOpen((v) => !v);
                setNextOpen(false);
                setCycleWarn(false);
                setOpenOutputsFor(null);
              }}
              title={t("labelUi.prevStepLink")}
              aria-expanded={pickerOpen}
              data-test="step-prev-link"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                marginTop: 1,
                padding: "0 8px",
                height: 20,
                maxWidth: 180,
                borderRadius: 10,
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
                lineHeight: "18px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                border: `1px solid ${linked ? "var(--color-label-activity)" : "var(--color-border)"}`,
                background: linked ? "var(--color-label-activity-bg)" : "transparent",
                color: linked ? "var(--color-label-activity)" : "var(--color-text-tertiary)",
              }}
            >
              <Link2 size={11} strokeWidth={2.2} style={{ flex: "0 0 auto" }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                {chipText}
              </span>
            </button>
            {pickerOpen && (
              <div role="menu" style={pickerStyles.menu}>
                <div style={pickerStyles.header}>{t("step.pickerStepsHeader")}</div>
                {candidates.length === 0 && (
                  <div style={pickerStyles.empty}>{t("step.noOtherSteps")}</div>
                )}
                {cycleWarn && (
                  <div style={{ ...pickerStyles.empty, color: "var(--color-error)" }}>
                    {t("step.cycleBlocked")}
                  </div>
                )}
                {candidates.map((c) => {
                  const active = prevLinks.some((l) => l.targetBlockId === c.blockId);
                  const outputs = collectStepOutputs(doc, labelStore.labels, c.blockId);
                  // 第 1 階層はステップだけ。出力を持つステップはホバー（クリックでも）で
                  // サブメニューを開き、そこで「どの出力を受けるか」を選ぶ。
                  // 出力を持たないステップは従来どおりクリックで順序リンクの付け外し。
                  const submenuOpen = outputs.length > 0 && openOutputsFor === c.blockId;
                  return (
                    <div
                      key={c.blockId}
                      style={{ position: "relative" }}
                      onMouseEnter={() => outputs.length > 0 && setOpenOutputsFor(c.blockId)}
                      onMouseLeave={() =>
                        setOpenOutputsFor((prev) => (prev === c.blockId ? null : prev))
                      }
                    >
                      <button
                        type="button"
                        role={outputs.length > 0 ? "menuitem" : "menuitemcheckbox"}
                        aria-checked={outputs.length > 0 ? undefined : active}
                        aria-haspopup={outputs.length > 0 || undefined}
                        aria-expanded={outputs.length > 0 ? submenuOpen : undefined}
                        onClick={() =>
                          outputs.length > 0
                            ? setOpenOutputsFor(submenuOpen ? null : c.blockId)
                            : toggleCandidate(c.blockId)
                        }
                        style={{
                          ...pickerStyles.item,
                          width: "100%",
                          background:
                            active || submenuOpen
                              ? "var(--color-label-activity-bg)"
                              : "transparent",
                          color: active
                            ? "var(--color-label-activity)"
                            : "var(--color-foreground)",
                        }}
                      >
                        <span style={pickerStyles.itemLabel}>{c.title}</span>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 2, flex: "0 0 auto" }}>
                          {active && <Check size={13} strokeWidth={2.4} />}
                          {outputs.length > 0 && (
                            <ChevronRight
                              size={13}
                              strokeWidth={2.2}
                              style={{ color: "var(--color-text-tertiary)" }}
                            />
                          )}
                        </span>
                      </button>
                      {submenuOpen && (
                        <div role="menu" style={pickerStyles.submenu}>
                          <div style={pickerStyles.header}>{t("step.pickerOutputsHeader")}</div>
                          {outputs.map((o) => {
                            const received = stepHasInputText(doc, props.block.id, o);
                            return (
                              <button
                                key={`${c.blockId}:${o}`}
                                type="button"
                                role="menuitemcheckbox"
                                aria-checked={received}
                                onClick={() => !received && pickOutput(c.blockId, o)}
                                style={{
                                  ...pickerStyles.item,
                                  width: "100%",
                                  cursor: received ? "default" : "pointer",
                                  color: "var(--color-foreground)",
                                }}
                              >
                                <span
                                  style={{
                                    flex: "0 0 auto",
                                    width: 7,
                                    height: 7,
                                    borderRadius: "50%",
                                    background: "var(--color-label-result, #c26356)",
                                  }}
                                />
                                {/* 丸印の隣に寄せる（item は space-between なので flex:1 が要る） */}
                                <span style={{ ...pickerStyles.itemLabel, flex: 1, textAlign: "left" }}>
                                  {o}
                                </span>
                                {received && <Check size={13} strokeWidth={2.4} />}
                              </button>
                            );
                          })}
                          <button
                            type="button"
                            role="menuitemcheckbox"
                            aria-checked={active}
                            onClick={() => toggleCandidate(c.blockId)}
                            style={{
                              ...pickerStyles.item,
                              width: "100%",
                              background: active
                                ? "var(--color-label-activity-bg)"
                                : "transparent",
                              color: active
                                ? "var(--color-label-activity)"
                                : "var(--color-text-tertiary)",
                            }}
                          >
                            <span style={pickerStyles.itemLabel}>
                              {t("step.unspecifiedOutput")}
                            </span>
                            {active && <Check size={13} strokeWidth={2.4} />}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {/* 次ステップ（編集不可）。
              後続なし → クリックで新規作成（前手順を自分にして渡す）。
              後続あり → 「タイトル →」チップ。クリックでピッカー（付け外し + 新規作成）。 */}
          <div
            contentEditable={false}
            style={{ position: "relative", flex: "0 0 auto" }}
          >
            <button
              type="button"
              onClick={() => {
                if (nextLinks.length === 0) {
                  createNextStep();
                  return;
                }
                setNextOpen((v) => !v);
                setPickerOpen(false);
                setCycleWarn(false);
              }}
              title={t("step.nextStep")}
              aria-expanded={nextOpen}
              data-test="step-next"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                marginTop: 1,
                padding: "0 8px",
                height: 20,
                maxWidth: 180,
                borderRadius: 10,
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
                lineHeight: "18px",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                border: `1px solid ${nextLinks.length > 0 ? "var(--color-label-activity)" : "var(--color-border)"}`,
                background:
                  nextLinks.length > 0 ? "var(--color-label-activity-bg)" : "transparent",
                color:
                  nextLinks.length > 0
                    ? "var(--color-label-activity)"
                    : "var(--color-text-tertiary)",
              }}
            >
              {nextLinks.length === 0 && (
                <Plus size={11} strokeWidth={2.4} style={{ flex: "0 0 auto" }} />
              )}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                {nextLinks.length > 0
                  ? `${titleOf(nextLinks[0].sourceBlockId)}${nextLinks.length > 1 ? ` +${nextLinks.length - 1}` : ""} →`
                  : t("step.nextStep")}
              </span>
            </button>
            {nextOpen && (
              <div role="menu" style={pickerStyles.menu}>
                <div style={pickerStyles.header}>{t("step.nextStep")}</div>
                {cycleWarn && (
                  <div style={{ ...pickerStyles.empty, color: "var(--color-error)" }}>
                    {t("step.cycleBlocked")}
                  </div>
                )}
                {/* 新規作成（前手順を自分にした step を直後に作る） */}
                <button
                  type="button"
                  role="menuitem"
                  onClick={createNextStep}
                  style={{ ...pickerStyles.item, color: "var(--color-primary)" }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Plus size={12} strokeWidth={2.4} />
                    {t("step.createNext")}
                  </span>
                </button>
                {nextRows.map((c) => {
                  const active = nextLinks.some((l) => l.sourceBlockId === c.blockId);
                  return (
                    <button
                      key={c.blockId}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={active}
                      onClick={() => toggleNext(c.blockId)}
                      style={{
                        ...pickerStyles.item,
                        background: active
                          ? "var(--color-label-activity-bg)"
                          : "transparent",
                        color: active
                          ? "var(--color-label-activity)"
                          : "var(--color-foreground)",
                      }}
                    >
                      <span style={pickerStyles.itemLabel}>{c.title}</span>
                      {active && <Check size={13} strokeWidth={2.4} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      );
    },
  }
);

const pickerStyles: Record<string, React.CSSProperties> = {
  menu: {
    position: "absolute",
    top: "calc(100% + 4px)",
    right: 0,
    zIndex: 20,
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: 6,
    minWidth: 180,
    maxWidth: 260,
    borderRadius: 8,
    background: "var(--color-card)",
    border: "1px solid var(--color-border)",
    boxShadow: "var(--shadow-2)",
  },
  header: {
    padding: "2px 8px 4px",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.03em",
    color: "var(--color-text-tertiary)",
  },
  // 出力サブメニュー。シェブロン（›）の向きに合わせて右へ開く。
  // 左開きにするとエディタ列の左端で切れる（実測）。
  submenu: {
    position: "absolute",
    top: -6,
    left: "100%",
    marginLeft: 4,
    zIndex: 21,
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: 6,
    minWidth: 160,
    maxWidth: 240,
    borderRadius: 8,
    background: "var(--color-card)",
    border: "1px solid var(--color-border)",
    boxShadow: "var(--shadow-2)",
  },
  empty: {
    padding: "4px 8px 6px",
    fontSize: 12,
    fontWeight: 400,
    color: "var(--color-text-tertiary)",
  },
  item: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "5px 8px",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    textAlign: "left",
    fontSize: 12,
    fontWeight: 500,
    lineHeight: 1.4,
  },
  itemLabel: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
};
