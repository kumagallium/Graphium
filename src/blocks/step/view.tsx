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
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronRight,
  ExternalLink,
  History,
  Link2,
  ListChecks,
  Plus,
  Search,
} from "lucide-react";
import { useLinkStore } from "../../features/block-link/store";
import { useLabelStore } from "../../features/context-label/store";
import { deriveActivityName } from "../../features/context-label/activity-name";
import {
  appendEntitySpanToStep,
  appendExternalInputRowToStep,
  collectStepOutputs,
  findLabeledTableInStep,
  removeExternalInputRow,
  stepHasInputText,
  updateExternalInputRowText,
} from "./step-io";
import {
  addTableColumns,
  appendEntityRowToTable,
  ensureParameterTable,
  readTable,
} from "../../features/network-graph/table-row-edit";
import { StepHistoryPicker } from "../../features/network-graph/StepHistoryPicker";
import {
  getIndexTableCallbacks,
  openEditorSidePeek,
} from "../../features/index-table/context";
import {
  collectStepInheritance,
  collectStepNames,
  collectCrossNoteOutputs,
  getLatestProcessIndex,
  requestLatestProcessIndexRefresh,
  resolveCrossNoteOutput,
  subscribeLatestProcessIndex,
  wouldCreateCrossNoteCycle,
  type CrossNoteOutputOccurrence,
  type InheritableEntity,
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

export type CrossNoteOutputGroup = {
  noteId: string;
  noteTitle: string;
  steps: Array<{
    stepId: string;
    stepName: string;
    outputs: CrossNoteOutputOccurrence[];
  }>;
};

const CASCADE_ROOT_WIDTH = 280;
const CASCADE_PANEL_WIDTH = 240;
const CASCADE_PANEL_GAP = 4;
const CASCADE_VIEWPORT_MARGIN = 8;
const CASCADE_MAX_HEIGHT = 362;

export function calculateCascadePosition(
  trigger: Pick<DOMRect, "top" | "right" | "bottom">,
  viewport: { width: number; height: number },
  panelDepth: number,
): { top: number; left: number; width: number; maxHeight: number } {
  const totalWidth =
    CASCADE_ROOT_WIDTH + panelDepth * (CASCADE_PANEL_WIDTH + CASCADE_PANEL_GAP);
  const width = Math.min(
    totalWidth,
    Math.max(0, viewport.width - CASCADE_VIEWPORT_MARGIN * 2),
  );
  const preferredLeft = trigger.right - CASCADE_ROOT_WIDTH;
  const left = Math.max(
    CASCADE_VIEWPORT_MARGIN,
    Math.min(preferredLeft, viewport.width - width - CASCADE_VIEWPORT_MARGIN),
  );
  const maxHeight = Math.min(
    CASCADE_MAX_HEIGHT,
    Math.max(0, viewport.height - CASCADE_VIEWPORT_MARGIN * 2),
  );
  const below = trigger.bottom + CASCADE_PANEL_GAP;
  const top =
    below + maxHeight <= viewport.height - CASCADE_VIEWPORT_MARGIN
      ? below
      : trigger.top - maxHeight - CASCADE_PANEL_GAP >= CASCADE_VIEWPORT_MARGIN
        ? trigger.top - maxHeight - CASCADE_PANEL_GAP
        : CASCADE_VIEWPORT_MARGIN;
  return { top, left, width, maxHeight };
}

/** 大量の外部 output を、ピッカーのノート → step → output 階層へ整形する */
export function groupCrossNoteOutputs(
  outputs: CrossNoteOutputOccurrence[],
): CrossNoteOutputGroup[] {
  const notes = new Map<string, CrossNoteOutputGroup>();
  for (const output of outputs) {
    let note = notes.get(output.noteId);
    if (!note) {
      note = { noteId: output.noteId, noteTitle: output.noteTitle, steps: [] };
      notes.set(output.noteId, note);
    } else {
      note.noteTitle = output.noteTitle;
    }
    let step = note.steps.find((candidate) => candidate.stepId === output.stepId);
    if (!step) {
      step = { stepId: output.stepId, stepName: output.stepName, outputs: [] };
      note.steps.push(step);
    } else {
      step.stepName = output.stepName;
    }
    step.outputs.push(output);
  }
  return [...notes.values()];
}

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
      const [externalPickerLevel, setExternalPickerLevel] = useState<
        "notes" | "steps" | "outputs" | null
      >(null);
      const [selectedExternalNoteId, setSelectedExternalNoteId] = useState<string | null>(null);
      const [selectedExternalStepId, setSelectedExternalStepId] = useState<string | null>(null);
      const [externalNoteQuery, setExternalNoteQuery] = useState("");
      // 後続（次ステップ）側のピッカー
      const [nextOpen, setNextOpen] = useState(false);
      // 過去の手順からの引き継ぎピッカー（名前 → パラメータの 2 段）
      const [paramOpen, setParamOpen] = useState(false);
      // ピッカー内で選んだ手順名。タイトル反映が本文に届くまでの間もこちらを正とする
      const [pickedName, setPickedName] = useState<string | null>(null);
      // 循環でリンクを拒否されたとき、無反応に見えないよう理由を出す
      const [cycleWarn, setCycleWarn] = useState(false);
      const [pickerPosition, setPickerPosition] = useState<{
        top: number;
        left: number;
        width: number;
        maxHeight: number;
      } | null>(null);
      const rootRef = useRef<HTMLDivElement>(null);
      const pickerMenuRef = useRef<HTMLDivElement>(null);
      const pickerTriggerRef = useRef<HTMLButtonElement>(null);
      const processIndex = useSyncExternalStore(
        subscribeLatestProcessIndex,
        getLatestProcessIndex,
        getLatestProcessIndex,
      );
      const crossNoteOutputs = useMemo(
        () => collectCrossNoteOutputs(processIndex, { excludeNoteId: linkStore.noteId }),
        [processIndex, linkStore.noteId],
      );
      const crossNoteGroups = useMemo(
        () => groupCrossNoteOutputs(crossNoteOutputs),
        [crossNoteOutputs],
      );
      const selectedExternalNote =
        crossNoteGroups.find((note) => note.noteId === selectedExternalNoteId) ?? null;
      const selectedExternalStep =
        selectedExternalNote?.steps.find((step) => step.stepId === selectedExternalStepId) ?? null;
      const filteredExternalNotes = useMemo(() => {
        const query = externalNoteQuery.trim().toLocaleLowerCase();
        if (!query) return crossNoteGroups;
        return crossNoteGroups.filter((note) =>
          `${note.noteTitle} ${note.steps.map((step) => step.stepName).join(" ")}`
            .toLocaleLowerCase()
            .includes(query),
        );
      }, [crossNoteGroups, externalNoteQuery]);

      // 外側クリックでピッカーを閉じる（callout の variant ピッカーと同じ流儀）
      useEffect(() => {
        if (!pickerOpen && !nextOpen && !paramOpen) return;
        const onDown = (e: MouseEvent) => {
          if (
            !rootRef.current?.contains(e.target as Node) &&
            !pickerMenuRef.current?.contains(e.target as Node)
          ) {
            setPickerOpen(false);
            setNextOpen(false);
            setParamOpen(false);
            setOpenOutputsFor(null);
            setExternalPickerLevel(null);
            setSelectedExternalNoteId(null);
            setSelectedExternalStepId(null);
            setExternalNoteQuery("");
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
      const inheritance = useMemo(
        () =>
          collectStepInheritance(processIndex, effectiveName, splitAttrLabel, {
            excludeStepId: props.block.id,
          }),
        [effectiveName, paramOpen, processIndex, props.block.id],
      );
      const stepNameStats = useMemo(
        () => collectStepNames(processIndex, splitAttrLabel),
        [paramOpen, processIndex],
      );
      // 過去に書いた手順が 1 つでもあれば入口を出す。名前だけでも選ぶ価値がある
      // （記録の無い名前を打ったときに沈黙するのが、いちばん困る）
      const hasHistory = stepNameStats.length > 0;
      // まだ名前が無い step には、アイコンを押せることを言葉でも伝える
      const showHistoryHint = hasHistory && stepTitle.length === 0;

      /**
       * 引き継いだものを、書かれていた場所に合わせて本文へ足す。
       *
       * 本文に span を直書きせず表に書くのは、ノート側に「単語の羅列ではなく
       * 試料表が育つ」という F 案の決めごとに従うため（activity-graph-editor の
       * onAddEntity / onCreateSectionTable と同じ経路）。
       *
       * 書き先を由来で分けるのは、実データでは手順の条件が手順にではなく
       * 投入する素材や使う装置に付いているため。まとめて手順のパラメータに
       * すると、元のノートと構造が揃わなくなる。
       */
      const insertParamKeys = (keys: string[]) => {
        const editor = props.editor;
        if (!editor || keys.length === 0) return;
        const find = (stepId: string) =>
          findLabeledTableInStep(editor.document ?? [], labelStore.labels, stepId, "attribute");

        let tableId = find(props.block.id);
        let rest = keys;
        if (!tableId) {
          const created = ensureParameterTable(editor, props.block.id, keys[0], find);
          if (!created) {
            // step が見つからない等で表を作れないときの逃げ道（既存の作法）
            for (const key of keys) {
              appendEntitySpanToStep(editor, props.block.id, "attribute", `${key}:`);
            }
            return;
          }
          tableId = created.tableBlockId;
          // 新規表は generator にパラメータとして読ませるためラベルが要る
          if (created.created) labelStore.setLabel(tableId, "attribute");
          rest = keys.slice(1);
        }
        appendMissingColumns(tableId, rest);
      };

      /** 表にまだ無い列だけを 1 回で足す（1 列ずつ足すと後半が落ちる） */
      const appendMissingColumns = (tableId: string, keys: string[]) => {
        const editor = props.editor;
        const existing = new Set(
          (readTable(editor, tableId)?.headers ?? []).map((h: string) => h.trim()),
        );
        const missing: string[] = [];
        for (const key of keys) {
          const trimmed = key.trim();
          if (!trimmed || existing.has(trimmed)) continue;
          existing.add(trimmed);
          missing.push(trimmed);
        }
        if (missing.length > 0) addTableColumns(editor, tableId, missing);
      };

      /** 素材・道具・生成物を、その種類の表に行として足し、属性は列にする */
      const insertEntity = (entity: InheritableEntity) => {
        const editor = props.editor;
        if (!editor) return;
        const find = (stepId: string) =>
          findLabeledTableInStep(editor.document ?? [], labelStore.labels, stepId, entity.kind);
        const result = appendEntityRowToTable(
          editor,
          props.block.id,
          entity.label,
          find,
          t("graphTable.nameColumn"),
        );
        if (!result) {
          // 表を作れないときは span で書く（グラフからの追加と同じ逃げ道）
          appendEntitySpanToStep(editor, props.block.id, entity.kind, entity.label);
          return;
        }
        if (result.created) labelStore.setLabel(result.tableBlockId, entity.kind);
        appendMissingColumns(
          result.tableBlockId,
          entity.attrs.map((a) => a.key),
        );
      };

      const insertInheritance = (picked: {
        paramKeys: string[];
        entities: InheritableEntity[];
      }) => {
        insertParamKeys(picked.paramKeys);
        for (const entity of picked.entities) insertEntity(entity);
      };

      // この step の前手順（outgoing informed_by）と後続（incoming informed_by）。
      // どちらも複数可（合流・分岐する工程）。
      const prevLinks = linkStore
        .getOutgoing(props.block.id)
        .filter((l) => l.type === "informed_by");
      const nextLinks = linkStore
        .getIncoming(props.block.id)
        .filter((l) => l.type === "informed_by" && !l.targetNoteId);
      const localPrevLinks = prevLinks.filter((link) => !link.targetNoteId);
      const externalPrevLinks = prevLinks.filter((link) => !!link.targetNoteId);

      const doc: any[] = (props.editor as any).document ?? [];
      const candidates = collectStepPredecessorCandidates(doc, props.block.id);
      const selectedLocalCandidate =
        candidates.find((candidate) => candidate.blockId === openOutputsFor) ?? null;
      const selectedLocalOutputs = selectedLocalCandidate
        ? collectStepOutputs(doc, labelStore.labels, selectedLocalCandidate.blockId)
        : [];
      const cascadePanelDepth =
        externalPickerLevel === "outputs" && selectedExternalStep
          ? 3
          : (externalPickerLevel === "steps" || externalPickerLevel === "outputs") &&
              selectedExternalNote
            ? 2
            : externalPickerLevel || selectedLocalCandidate
              ? 1
              : 0;
      useLayoutEffect(() => {
        if (!pickerOpen) {
          setPickerPosition(null);
          return;
        }
        const placeCascade = () => {
          const trigger = pickerTriggerRef.current;
          if (!trigger) return;
          const rect = trigger.getBoundingClientRect();
          setPickerPosition(
            calculateCascadePosition(
              rect,
              { width: window.innerWidth, height: window.innerHeight },
              cascadePanelDepth,
            ),
          );
        };
        placeCascade();
        window.addEventListener("resize", placeCascade);
        window.addEventListener("scroll", placeCascade, true);
        return () => {
          window.removeEventListener("resize", placeCascade);
          window.removeEventListener("scroll", placeCascade, true);
        };
      }, [cascadePanelDepth, pickerOpen]);
      useLayoutEffect(() => {
        const menu = pickerMenuRef.current;
        if (!menu || !pickerOpen) return;
        menu.scrollLeft = menu.scrollWidth - menu.clientWidth;
      }, [cascadePanelDepth, pickerOpen, pickerPosition?.width]);
      const allSteps = collectAllSteps(doc);
      const titleOf = (blockId: string) =>
        allSteps.find((c) => c.blockId === blockId)?.title ?? blockId.slice(0, 8);

      const toggleCandidate = (blockId: string) => {
        const existing = localPrevLinks.find((l) => l.targetBlockId === blockId);
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

      const firstExternalLink = externalPrevLinks[0];
      const firstExternalOutput =
        firstExternalLink?.targetNoteId && firstExternalLink.targetEntityId
          ? resolveCrossNoteOutput(processIndex, {
              noteId: firstExternalLink.targetNoteId,
              sourceModifiedAt: firstExternalLink.targetSourceModifiedAt,
              stepId: firstExternalLink.targetBlockId,
              entityIdentity: firstExternalLink.targetEntityId,
              identityStable: firstExternalLink.targetEntityStable,
              outputIndex: firstExternalLink.targetEntityIndex,
              outputCount: firstExternalLink.targetEntityCount,
            })
          : null;
      const linked = prevLinks.length > 0;
      const chipText = firstExternalLink
        ? `← ${firstExternalOutput?.noteTitle ?? firstExternalLink.targetNoteTitle ?? firstExternalLink.targetNoteId} › ${firstExternalOutput?.stepName ?? firstExternalLink.targetStepTitle ?? firstExternalLink.targetBlockId.slice(0, 8)} › ${firstExternalOutput?.label ?? firstExternalLink.targetEntityLabel ?? t("step.externalUnknownOutput")}${firstExternalOutput ? "" : ` (${t("step.brokenLink")})`}${prevLinks.length > 1 ? ` +${prevLinks.length - 1}` : ""}`
        : linked
          ? `← ${titleOf(localPrevLinks[0].targetBlockId)}${prevLinks.length > 1 ? ` +${prevLinks.length - 1}` : ""}`
          : t("step.prevLink");

      // 出力を選んで受ける: 自分の本文に同名の材料 span を合成し（テキスト
      // 一致の unification が出力と 1 Entity に merge する）、手順順序
      // （informed_by）も張る。「どのバッチから」を本文側から特定する導線。
      const pickOutput = (prevBlockId: string, outputLabel: string) => {
        const editor = props.editor as any;
        appendEntitySpanToStep(editor, props.block.id, "material", outputLabel);
        if (!localPrevLinks.some((l) => l.targetBlockId === prevBlockId)) {
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

      const resolveExternalLink = (link: (typeof externalPrevLinks)[number]) => {
        if (!link.targetNoteId || !link.targetEntityId) return null;
        return resolveCrossNoteOutput(processIndex, {
          noteId: link.targetNoteId,
          sourceModifiedAt: link.targetSourceModifiedAt,
          stepId: link.targetBlockId,
          entityIdentity: link.targetEntityId,
          identityStable: link.targetEntityStable,
          outputIndex: link.targetEntityIndex,
          outputCount: link.targetEntityCount,
        });
      };

      const activeExternalLink = (output: CrossNoteOutputOccurrence) =>
        externalPrevLinks.find((link) => {
          if (
            link.targetNoteId !== output.noteId ||
            link.targetBlockId !== output.stepId
          ) {
            return false;
          }
          const resolved = resolveExternalLink(link);
          return resolved?.entityIdentity === output.entityIdentity;
        });

      const closeExternalPicker = () => {
        setPickerOpen(false);
        setExternalPickerLevel(null);
        setSelectedExternalNoteId(null);
        setSelectedExternalStepId(null);
        setExternalNoteQuery("");
      };

      const removeExternalLink = (link: (typeof externalPrevLinks)[number]) => {
        linkStore.removeLink(link.id);
        if (link.sourceEntityId) {
          removeExternalInputRow(props.editor, link.sourceEntityId);
        }
      };

      const toggleExternalOutput = (output: CrossNoteOutputOccurrence) => {
        const existing = activeExternalLink(output);
        if (existing) {
          removeExternalLink(existing);
          return;
        }
        if (
          wouldCreateCrossNoteCycle(
            processIndex,
            linkStore.noteId,
            output.noteId,
            linkStore.links,
          )
        ) {
          setCycleWarn(true);
          return;
        }
        setCycleWarn(false);
        // 受け取りは [インプット] 表の行にする（D-1 / 2026-08-23 合意）。
        // 行は tableRowIdentity で追跡し、それをリンクの sourceEntityId に持つ
        const appended = appendExternalInputRowToStep(
          props.editor,
          props.block.id,
          output.label,
          (stepId) =>
            findLabeledTableInStep(
              (props.editor as any).document ?? [],
              labelStore.labels,
              stepId,
              "material",
            ),
          t("graphTable.nameColumn"),
        );
        if (!appended) return;
        if (appended.created) labelStore.setLabel(appended.tableBlockId, "material");
        const sourceEntityId = appended.rowIdentity;
        const result = linkStore.addLink({
          sourceBlockId: props.block.id,
          targetBlockId: output.stepId,
          targetNoteId: output.noteId,
          targetEntityId: output.entityIdentity,
          targetEntityIndex: output.outputIndex,
          targetEntityCount: output.outputCount,
          targetEntityStable: output.identityStable,
          targetSourceModifiedAt: output.sourceModifiedAt,
          sourceEntityId,
          targetEntityLabel: output.label,
          targetNoteTitle: output.noteTitle,
          targetStepTitle: output.stepName,
          type: "informed_by",
          createdBy: "human",
        });
        if (result.error) {
          removeExternalInputRow(props.editor, sourceEntityId);
          return;
        }
        closeExternalPicker();
      };

      // 参照元 output の改名は、保存後に届く process index 更新へ追随する。
      // editor mutation は React render 中ではなく effect で行う。
      useEffect(() => {
        for (const link of externalPrevLinks) {
          if (!link.sourceEntityId) continue;
          const resolved = resolveExternalLink(link);
          if (!resolved) continue;
          updateExternalInputRowText(props.editor, link.sourceEntityId, resolved.label);
          if (
            link.targetEntityId !== resolved.entityIdentity ||
            link.targetEntityIndex !== resolved.outputIndex ||
            link.targetEntityCount !== resolved.outputCount ||
            link.targetEntityStable !== resolved.identityStable ||
            link.targetSourceModifiedAt !== resolved.sourceModifiedAt ||
            link.targetEntityLabel !== resolved.label ||
            link.targetNoteTitle !== resolved.noteTitle ||
            link.targetStepTitle !== resolved.stepName
          ) {
            linkStore.updateLink(link.id, {
              targetEntityId: resolved.entityIdentity,
              targetEntityIndex: resolved.outputIndex,
              targetEntityCount: resolved.outputCount,
              targetEntityStable: resolved.identityStable,
              targetSourceModifiedAt: resolved.sourceModifiedAt,
              targetEntityLabel: resolved.label,
              targetNoteTitle: resolved.noteTitle,
              targetStepTitle: resolved.stepName,
            });
          }
        }
      }, [processIndex, linkStore.links, props.block.id, props.editor]);

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
                  inheritance={inheritance}
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
                  onInsert={insertInheritance}
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
                requestLatestProcessIndexRefresh();
                setPickerOpen((v) => {
                  const next = !v;
                  if (!next) {
                    setExternalPickerLevel(null);
                    setSelectedExternalNoteId(null);
                    setSelectedExternalStepId(null);
                    setExternalNoteQuery("");
                  }
                  return next;
                });
                setNextOpen(false);
                setCycleWarn(false);
                setOpenOutputsFor(null);
              }}
              title={linked ? chipText : t("labelUi.prevStepLink")}
              aria-expanded={pickerOpen}
              data-test="step-prev-link"
              ref={pickerTriggerRef}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                marginTop: 1,
                padding: "0 8px",
                height: 20,
                maxWidth: firstExternalLink ? 300 : 180,
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
            {pickerOpen &&
              pickerPosition &&
              typeof document !== "undefined" &&
              createPortal(
                <div
                  ref={pickerMenuRef}
                  role="menu"
                  style={{
                    ...pickerStyles.cascadeMenu,
                    top: pickerPosition.top,
                    left: pickerPosition.left,
                    width: pickerPosition.width,
                    maxHeight: pickerPosition.maxHeight,
                  }}
                >
                  <div style={pickerStyles.cascadeRootPanel}>
                    <div
                      style={{
                        ...pickerStyles.cascadeColumn,
                        maxHeight: Math.max(0, pickerPosition.maxHeight - 2),
                      }}
                    >
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
                    const active = localPrevLinks.some((l) => l.targetBlockId === c.blockId);
                    const outputs = collectStepOutputs(doc, labelStore.labels, c.blockId);
                    const submenuOpen = outputs.length > 0 && openOutputsFor === c.blockId;
                    return (
                      <div key={c.blockId}>
                        <button
                          type="button"
                          role={outputs.length > 0 ? "menuitem" : "menuitemcheckbox"}
                          aria-checked={outputs.length > 0 ? undefined : active}
                          aria-haspopup={outputs.length > 0 || undefined}
                          aria-expanded={outputs.length > 0 ? submenuOpen : undefined}
                          onClick={() => {
                            if (outputs.length === 0) {
                              toggleCandidate(c.blockId);
                              return;
                            }
                            setExternalPickerLevel(null);
                            setSelectedExternalNoteId(null);
                            setSelectedExternalStepId(null);
                            setOpenOutputsFor(submenuOpen ? null : c.blockId);
                          }}
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
                          <span style={pickerStyles.itemActions}>
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
                      </div>
                    );
                  })}
                  <div style={pickerStyles.header}>{t("step.externalOutputsHeader")}</div>
                  {externalPrevLinks.map((link) => {
                    const resolved = resolveExternalLink(link);
                    const broken = !resolved;
                    return (
                      <button
                        key={link.id}
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked
                        onClick={() => removeExternalLink(link)}
                        style={{
                          ...pickerStyles.item,
                          width: "100%",
                          background: "var(--color-label-activity-bg)",
                          color: broken
                            ? "var(--color-error)"
                            : "var(--color-label-activity)",
                        }}
                      >
                        <span style={pickerStyles.itemDetails}>
                          <span style={pickerStyles.itemLabel}>
                            {resolved?.label ??
                              link.targetEntityLabel ??
                              t("step.externalUnknownOutput")}
                          </span>
                          <span style={pickerStyles.itemMeta}>
                            {resolved?.noteTitle ??
                              link.targetNoteTitle ??
                              link.targetNoteId}{" "}
                            ›{" "}
                            {resolved?.stepName ??
                              link.targetStepTitle ??
                              link.targetBlockId.slice(0, 8)}
                            {broken ? ` — ${t("step.brokenLink")}` : ""}
                          </span>
                        </span>
                        <Check size={13} strokeWidth={2.4} />
                      </button>
                    );
                  })}
                  {crossNoteGroups.length === 0 ? (
                    externalPrevLinks.length === 0 && (
                      <div style={pickerStyles.empty}>{t("step.noExternalOutputs")}</div>
                    )
                  ) : (
                    <button
                     type="button"
                     role="menuitem"
                     onClick={() => {
                       setOpenOutputsFor(null);
                       setExternalPickerLevel((level) => (level ? null : "notes"));
                       setSelectedExternalNoteId(null);
                       setSelectedExternalStepId(null);
                     }}
                     style={{
                       ...pickerStyles.item,
                       width: "100%",
                       background: externalPickerLevel
                         ? "var(--color-label-activity-bg)"
                         : "transparent",
                       color: "var(--color-foreground)",
                     }}
                   >
                     <span style={pickerStyles.itemLabel}>
                       {t("step.chooseExternalNote")}
                     </span>
                     <ChevronRight size={13} strokeWidth={2.2} />
                   </button>
                 )}
                   </div>
                 </div>
                 {selectedLocalCandidate && externalPickerLevel === null && (
                   <div role="menu" style={pickerStyles.cascadePanel}>
                     <div style={pickerStyles.cascadePanelColumn}>
                       <div style={pickerStyles.header}>
                         {selectedLocalCandidate.title} › {t("step.pickerOutputsHeader")}
                       </div>
                       {selectedLocalOutputs.map((output) => {
                         const active = localPrevLinks.some(
                           (link) => link.targetBlockId === selectedLocalCandidate.blockId,
                         );
                         const received =
                           active && stepHasInputText(doc, props.block.id, output);
                         return (
                           <button
                             key={`${selectedLocalCandidate.blockId}:${output}`}
                             type="button"
                             role="menuitemcheckbox"
                             aria-checked={received}
                             onClick={() =>
                               !received && pickOutput(selectedLocalCandidate.blockId, output)
                             }
                             style={{
                               ...pickerStyles.item,
                               width: "100%",
                               cursor: received ? "default" : "pointer",
                               color: "var(--color-foreground)",
                             }}
                           >
                             <span style={pickerStyles.outputDot} />
                             <span
                               style={{
                                 ...pickerStyles.itemLabel,
                                 flex: 1,
                                 textAlign: "left",
                               }}
                             >
                               {output}
                             </span>
                             {received && <Check size={13} strokeWidth={2.4} />}
                           </button>
                         );
                       })}
                       <button
                         type="button"
                         role="menuitemcheckbox"
                         aria-checked={localPrevLinks.some(
                           (link) => link.targetBlockId === selectedLocalCandidate.blockId,
                         )}
                         onClick={() => toggleCandidate(selectedLocalCandidate.blockId)}
                         style={{
                           ...pickerStyles.item,
                           width: "100%",
                           background: localPrevLinks.some(
                             (link) => link.targetBlockId === selectedLocalCandidate.blockId,
                           )
                             ? "var(--color-label-activity-bg)"
                             : "transparent",
                           color: localPrevLinks.some(
                             (link) => link.targetBlockId === selectedLocalCandidate.blockId,
                           )
                             ? "var(--color-label-activity)"
                             : "var(--color-text-tertiary)",
                         }}
                       >
                         <span style={pickerStyles.itemLabel}>{t("step.unspecifiedOutput")}</span>
                         {localPrevLinks.some(
                           (link) => link.targetBlockId === selectedLocalCandidate.blockId,
                         ) && <Check size={13} strokeWidth={2.4} />}
                       </button>
                     </div>
                   </div>
                 )}
                 {externalPickerLevel && (
                   <div role="menu" style={pickerStyles.cascadePanel}>
                     <div style={pickerStyles.cascadePanelColumn}>
                       <div style={pickerStyles.header}>{t("step.chooseExternalNote")}</div>
                       <label style={pickerStyles.searchBox}>
                         <Search size={13} strokeWidth={2} />
                         <input
                           autoFocus
                           value={externalNoteQuery}
                           onChange={(event) => setExternalNoteQuery(event.target.value)}
                           placeholder={t("step.searchExternalNotes")}
                           style={pickerStyles.searchInput}
                         />
                       </label>
                       {filteredExternalNotes.length === 0 ? (
                         <div style={pickerStyles.empty}>
                           {t("step.noMatchingExternalNotes")}
                         </div>
                       ) : (
                         filteredExternalNotes.map((note) => (
                           <button
                             key={note.noteId}
                             type="button"
                             role="menuitem"
                             onClick={() => {
                               setSelectedExternalNoteId(note.noteId);
                               setSelectedExternalStepId(null);
                               setExternalPickerLevel("steps");
                             }}
                             style={{
                               ...pickerStyles.item,
                               width: "100%",
                               background:
                                 selectedExternalNoteId === note.noteId
                                   ? "var(--color-label-activity-bg)"
                                   : "transparent",
                               color: "var(--color-foreground)",
                             }}
                           >
                             <span style={pickerStyles.itemDetails}>
                               <span style={pickerStyles.itemLabel}>{note.noteTitle}</span>
                               <span style={pickerStyles.itemMeta}>
                                 {t("step.externalNoteSummary", {
                                   steps: String(note.steps.length),
                                   outputs: String(
                                     note.steps.reduce(
                                       (count, step) => count + step.outputs.length,
                                       0,
                                     ),
                                   ),
                                 })}
                               </span>
                             </span>
                             <ChevronRight size={13} strokeWidth={2.2} />
                           </button>
                         ))
                       )}
                     </div>
                     {(externalPickerLevel === "steps" ||
                       externalPickerLevel === "outputs") &&
                       selectedExternalNote && (
                       <div role="menu" style={pickerStyles.cascadePanel}>
                         <div style={pickerStyles.cascadePanelColumn}>
                           <div style={pickerStyles.header}>
                             {selectedExternalNote.noteTitle} › {t("step.chooseExternalStep")}
                           </div>
                           {(selectedExternalNote?.steps ?? []).map((step) => (
                             <button
                               key={step.stepId}
                               type="button"
                               role="menuitem"
                               onClick={() => {
                                 setSelectedExternalStepId(step.stepId);
                                 setExternalPickerLevel("outputs");
                               }}
                               style={{
                                 ...pickerStyles.item,
                                 width: "100%",
                                 background:
                                   selectedExternalStepId === step.stepId
                                     ? "var(--color-label-activity-bg)"
                                     : "transparent",
                                 color: "var(--color-foreground)",
                               }}
                             >
                               <span style={pickerStyles.itemDetails}>
                                 <span style={pickerStyles.itemLabel}>{step.stepName}</span>
                                 <span style={pickerStyles.itemMeta}>
                                   {t("step.externalOutputCount", {
                                     count: String(step.outputs.length),
                                   })}
                                 </span>
                               </span>
                               <ChevronRight size={13} strokeWidth={2.2} />
                             </button>
                           ))}
                         </div>
                         {externalPickerLevel === "outputs" && selectedExternalStep && (
                           <div role="menu" style={pickerStyles.cascadePanel}>
                             <div style={pickerStyles.cascadePanelColumn}>
                               <div style={pickerStyles.header}>
                                 {selectedExternalStep.stepName} ›{" "}
                                 {t("step.pickerOutputsHeader")}
                               </div>
                               {(selectedExternalStep?.outputs ?? []).map((output) => {
                                 const activeLink = activeExternalLink(output);
                                 return (
                                   <button
                                     key={`${output.noteId}:${output.stepId}:${output.entityIdentity}`}
                                     type="button"
                                     role="menuitemcheckbox"
                                     aria-checked={!!activeLink}
                                     onClick={() => toggleExternalOutput(output)}
                                     style={{
                                       ...pickerStyles.item,
                                       width: "100%",
                                       background: activeLink
                                         ? "var(--color-label-activity-bg)"
                                         : "transparent",
                                       color: activeLink
                                         ? "var(--color-label-activity)"
                                         : "var(--color-foreground)",
                                     }}
                                   >
                                     <span style={pickerStyles.outputDot} />
                                     <span
                                       style={{
                                         ...pickerStyles.itemLabel,
                                         flex: 1,
                                         textAlign: "left",
                                       }}
                                     >
                                       {output.label}
                                     </span>
                                     {activeLink && <Check size={13} strokeWidth={2.4} />}
                                   </button>
                                 );
                               })}
                             </div>
                           </div>
                         )}
                       </div>
                     )}
                   </div>
                 )}
                </div>,
              document.body,
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
  cascadeMenu: {
    position: "fixed",
    zIndex: 120,
    display: "flex",
    alignItems: "flex-start",
    gap: CASCADE_PANEL_GAP,
    overflowX: "auto",
    overflowY: "hidden",
  },
  cascadeRootPanel: {
    flex: `0 0 ${CASCADE_ROOT_WIDTH}px`,
    overflow: "hidden",
    borderRadius: 8,
    background: "var(--color-card)",
    border: "1px solid var(--color-border)",
    boxShadow: "var(--shadow-2)",
  },
  cascadeColumn: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: 6,
    maxHeight: 360,
    overflowY: "auto",
    overflowX: "hidden",
  },
  cascadePanel: {
    display: "contents",
  },
  cascadePanelColumn: {
    flex: `0 0 ${CASCADE_PANEL_WIDTH}px`,
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: 6,
    maxHeight: "min(360px, calc(100vh - 16px))",
    overflowY: "auto",
    overflowX: "hidden",
    borderRadius: 8,
    background: "var(--color-card)",
    border: "1px solid var(--color-border)",
    boxShadow: "var(--shadow-2)",
  },
  menu: {
    position: "absolute",
    top: "calc(100% + 4px)",
    right: 0,
    zIndex: 20,
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: 6,
    minWidth: 220,
    width: 280,
    maxWidth: "min(320px, calc(100vw - 24px))",
    maxHeight: 360,
    overflowY: "auto",
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
  itemActions: {
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
    flex: "0 0 auto",
  },
  itemDetails: {
    minWidth: 0,
    display: "flex",
    flex: 1,
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 1,
  },
  itemMeta: {
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 10,
    fontWeight: 400,
    color: "var(--color-text-tertiary)",
  },
  outputDot: {
    flex: "0 0 auto",
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "var(--color-label-result, #c26356)",
  },
  searchBox: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    margin: "2px 2px 4px",
    padding: "5px 7px",
    border: "1px solid var(--color-border)",
    borderRadius: 6,
    color: "var(--color-text-tertiary)",
  },
  searchInput: {
    minWidth: 0,
    width: "100%",
    border: "none",
    outline: "none",
    background: "transparent",
    color: "var(--color-foreground)",
    fontSize: 12,
  },
};
