// つながり（線）のメモ — 純関数
//
// 作業手順グラフ・工程グラフの「線」に付けるメモの、付け先の判定と件数の集計。
// 描画の線の ID（kind:source->target 由来）は使わない。ID は手順の間のつながりが
// 順序のみ ⇄ 材料を挟む形に切り替わる・材料が併合されるたびに変わるため、
// 両端の手順（工程）の組で指す（MemoSourceEdge）。
//
// - steps（作業手順グラフ）: 手順ブロックの blockId の組。次の 2 つを同じ組として扱う
//     orderOnly（手順 → 手順）
//     generates ＋ used（手順が作った材料を別の手順が使う。どちらの線を押しても同じ組）
//   手順が作っていない材料・道具の線、derived、external、broken は対象外
// - plan（工程グラフ）: 工程の表の行の安定 ID（tableRowIdentity）の組（FlowEdge.pair の両端の行）。
//   予定の線と実績の線は同じ組。ノートの有無・ノート名・行の名前や並びに依らない。
//   行の安定 ID が取れない端点（古い表など）の線は対象外

import type { FlowEdge, FlowGraphData } from "./activity-graph-adapter";
import type { Rect } from "../../ui/floating-position";
import type { CaptureEntry, CaptureIndex, MemoSourceEdge } from "../mobile-capture";

export type EdgeMemoGraphKind = MemoSourceEdge["graph"];

/** 線のメモを判定するのに要る線の情報（FlowEdge の部分） */
export type EdgeMemoEdgeInput = Pick<FlowEdge, "id" | "kind" | "source" | "target"> &
  Partial<Pick<FlowEdge, "broken" | "pair">>;

/**
 * StepFlowView に渡す「線のメモ」の口。渡さなければ何も変わらない
 * （系譜・プロセス一覧・共有表示は渡さない。手順グラフと工程グラフの編集だけが渡す）
 */
export type EdgePopoverActions = {
  /** 名前を付けられる工程の組（無ければ名前のボタンを出さない） */
  pair: { from: string; to: string } | null;
  /** 今の線の名前（空 = 名前なし） */
  userLabel: string;
  /** 名前を付ける・変える（空文字 = 外す） */
  onSetLabel?: (label: string) => void;
  /** 入力欄の候補 */
  labelSuggestions?: string[];
  /** 削除できる線の種類（無ければ削除のボタンを出さない） */
  remove: "orderOnly" | "planned" | null;
  /** 削除（予定を外す）を実行する */
  onRemove?: () => void;
};

export type EdgeMemos = {
  /** 線 → その組の付け先。メモの対象外の線は null */
  target(edge: EdgeMemoEdgeInput): MemoSourceEdge | null;
  /** その組のメモの件数 */
  count(edge: MemoSourceEdge): number;
  /** メモを書ける画面か（false = 読むだけ。0 件の線はメニューにメモの項目を出さない） */
  canWrite: boolean;
  /**
   * メモの小窓を開く。anchor は起点の矩形（画面座標。印を押したときは印の矩形、メニューからは押した位置の点）。
   * 同じ組の小窓が開いているときに印を押したら閉じる（開閉の切り替え）。
   * actions は小窓の見出しに置く線の操作（名前・削除）。読むだけの画面では渡さない
   */
  onOpen(edge: MemoSourceEdge, anchor: Rect, actions?: EdgePopoverActions): void;
  /** 開いている小窓を閉じる（線のメニューを開くとき、重ならないように呼ぶ） */
  close?(): void;
};

/** 画面座標の 1 点を、幅 0 の矩形にする（小窓の起点） */
export function pointToRect(x: number, y: number): Rect {
  return { top: y, bottom: y, left: x, right: x };
}

// ── 手順の組の判定（steps）──

/** 線 → 手順の組（from / to は手順の id）。対象外は null */
export type PairResolver = (edge: EdgeMemoEdgeInput) => { from: string; to: string } | null;

/**
 * 手順グラフの線から「渡す手順 → 受け取る手順」の組を出す判定器を作る。
 * graph ごとに 1 回だけ索引（自ノートの手順の集合・材料ごとの作った手順 / 使う手順）を組み、
 * 線ごとの判定は索引を引くだけにする（線数 × 手順数・線数 の走査にしない）。
 *
 * - orderOnly: source / target がそのまま手順
 * - used（材料 → 手順）: 材料を作った手順が 1 つに決まるときだけ、その手順と押した線の使う側の手順
 * - generates（手順 → 材料）: 材料を使う手順が 1 つに決まるときだけ、押した線の作る側の手順とその手順
 *   （2 つ以上の手順が使う材料は、どの組か決められないので対象外。使う側の線 used を押す）
 * - 別ノート由来の手順（externalOrigin）・工程ノード（noteRef）は端点にしない
 */
export function buildStepPairResolver(graph: Pick<FlowGraphData, "steps" | "edges">): PairResolver {
  const ownSteps = new Set(graph.steps.filter((s) => !s.externalOrigin && !s.noteRef).map((s) => s.id));
  // 材料 id → その材料を作った手順 / 使う手順（重複なし）
  const producers = new Map<string, Set<string>>();
  const consumers = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, key: string, value: string) => {
    const set = m.get(key);
    if (set) set.add(value);
    else m.set(key, new Set([value]));
  };
  for (const e of graph.edges) {
    if (e.kind === "generates") add(producers, e.target, e.source);
    else if (e.kind === "used") add(consumers, e.source, e.target);
  }
  const ok = (from: string, to: string) =>
    from !== to && ownSteps.has(from) && ownSteps.has(to) ? { from, to } : null;
  const only = (set: Set<string> | undefined): string | null =>
    set && set.size === 1 ? [...set][0] : null;

  return (edge) => {
    if (edge.broken) return null;
    switch (edge.kind) {
      case "orderOnly":
        return ok(edge.source, edge.target);
      case "used": {
        // entity → step。entity を作った手順が 1 つに決まるとき
        const producer = only(producers.get(edge.source));
        return producer ? ok(producer, edge.target) : null;
      }
      case "generates": {
        // step → entity。entity を使う手順が 1 つに決まるとき
        const consumer = only(consumers.get(edge.target));
        return consumer ? ok(edge.source, consumer) : null;
      }
      default:
        return null;
    }
  };
}

/** 1 本だけ判定したいとき用（テスト・単発）。線が多い画面は buildStepPairResolver を 1 回作って使う */
export function resolveStepPair(
  graph: Pick<FlowGraphData, "steps" | "edges">,
  edge: EdgeMemoEdgeInput,
): { from: string; to: string } | null {
  return buildStepPairResolver(graph)(edge);
}

// ── 工程の組の判定（plan）──

/**
 * 工程グラフの線から「渡す工程 → 受け取る工程」の組（工程の表の行の安定 ID）を出す判定器を作る。
 * 組は FlowEdge.pair（予定の線と実績の線で同じ）の端点（工程ノード id）を、
 * 工程ノードの noteRef.rowId に引き直したもの。ノート未作成の行（`row:...`）も対象。
 * 行の安定 ID が無い端点・broken・自分自身への線は対象外
 */
export function buildPlanPairResolver(graph: Pick<FlowGraphData, "steps">): PairResolver {
  const rowIdByStep = new Map<string, string>();
  for (const s of graph.steps) {
    const rowId = s.noteRef?.rowId;
    if (rowId) rowIdByStep.set(s.id, rowId);
  }
  return (edge) => {
    if (edge.broken) return null;
    if (edge.kind !== "used" && edge.kind !== "planned") return null;
    const pair = edge.pair;
    if (!pair) return null;
    const from = rowIdByStep.get(pair.from);
    const to = rowIdByStep.get(pair.to);
    if (!from || !to || from === to) return null;
    return { from, to };
  };
}

/** 1 本だけ判定したいとき用（テスト・単発） */
export function resolvePlanPair(
  graph: Pick<FlowGraphData, "steps">,
  edge: EdgeMemoEdgeInput,
): { from: string; to: string } | null {
  return buildPlanPairResolver(graph)(edge);
}

// ── 付け先 ──

/**
 * 線 → 付け先（MemoSourceEdge）の判定器を作る。graph ごとに 1 回だけ索引を組み、
 * 線ごとの判定は索引を引くだけにする。名前は今のグラフの手順名・工程名（作成時のスナップショットになる）
 */
export function buildEdgeMemoResolver(
  kind: EdgeMemoGraphKind,
  graph: Pick<FlowGraphData, "steps" | "edges">,
): (edge: EdgeMemoEdgeInput) => MemoSourceEdge | null {
  const pairOf: PairResolver = kind === "plan" ? buildPlanPairResolver(graph) : buildStepPairResolver(graph);
  // 名前は線の組が決まったときに引く。最初に使うときに 1 回だけ索引にする
  // （steps = 手順の id、plan = 行の安定 ID で引く）
  let names: Map<string, string | undefined> | null = null;
  const nameOf = (id: string) => {
    if (!names) {
      names = new Map();
      for (const s of graph.steps) names.set(kind === "plan" ? (s.noteRef?.rowId ?? s.id) : s.id, s.name?.trim());
    }
    return names.get(id);
  };
  return (edge) => {
    const pair = pairOf(edge);
    if (!pair) return null;
    const fromLabel = nameOf(pair.from);
    const toLabel = nameOf(pair.to);
    return {
      graph: kind,
      from: pair.from,
      to: pair.to,
      ...(fromLabel ? { fromLabel } : {}),
      ...(toLabel ? { toLabel } : {}),
    };
  };
}

/** 線 1 本の付け先（単発・テスト用）。線が多い画面は buildEdgeMemoResolver を 1 回作って使う */
export function resolveEdgeMemoTarget(
  kind: EdgeMemoGraphKind,
  graph: Pick<FlowGraphData, "steps" | "edges">,
  edge: EdgeMemoEdgeInput,
): MemoSourceEdge | null {
  return buildEdgeMemoResolver(kind, graph)(edge);
}

// ── 件数の集計 ──

/** 線の組の識別キー（graph / from / to。名前は含めない） */
export function edgeMemoKey(edge: Pick<MemoSourceEdge, "graph" | "from" | "to">): string {
  return `${edge.graph}\u0000${edge.from}\u0000${edge.to}`;
}

/** wiki: / skill: の接頭辞を外す（NoteMemosSection.filterMemosByNote と同じ規則。疎結合のためここに置く） */
function stripDocKeyPrefixLocal(id: string): string {
  return id.replace(/^(wiki|skill):/, "");
}

/**
 * ノート `noteFileId` の線のメモを、組ごとに集める（新しい順）。captureIndex を 1 回だけ走査する —
 * 描画のたびに線ごとに全メモを舐めないよう、呼び出し側は結果を memo して持つ。
 * 対象: アーカイブ・ゴミ箱でないメモで、sourceNote.fileId がこのノートかつ sourceEdge を持つもの
 */
export function buildEdgeMemoIndex(
  captureIndex: CaptureIndex | null | undefined,
  noteFileId: string | null | undefined,
): Map<string, CaptureEntry[]> {
  const index = new Map<string, CaptureEntry[]>();
  if (!captureIndex || !noteFileId) return index;
  const own = stripDocKeyPrefixLocal(noteFileId);
  for (const c of captureIndex.captures) {
    if (c.archivedAt || c.deletedAt) continue;
    const edge = c.sourceEdge;
    if (!edge) continue;
    const noteId = c.sourceNote?.fileId;
    if (!noteId || stripDocKeyPrefixLocal(noteId) !== own) continue;
    const key = edgeMemoKey(edge);
    const list = index.get(key);
    if (list) list.push(c);
    else index.set(key, [c]);
  }
  for (const list of index.values()) list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return index;
}

// ── 線をクリックしたときのメニュー ──

export type EdgeMenuDecision = {
  /**
   * popover = メモの小窓を直接開く（付け先のある線。memo が入る。remove / pair は小窓の見出しの操作）
   * menu = 従来のメニュー（メモの項目は無い）
   */
  mode: "popover" | "menu";
  remove: "orderOnly" | "planned" | null;
  pair: { from: string; to: string } | null;
  /** 小窓の付け先（mode が popover のときだけ）。count は今のメモの件数 */
  memo: { target: MemoSourceEdge; count: number } | null;
};

/**
 * 線をクリックしたとき、何を開くか。何も開くものが無ければ null。
 *
 * - 付け先がある線で、メモがあるか書ける画面のとき: メモの小窓を直接開く（popover）。
 *   メニューは出さない。名前・削除は小窓の見出しの操作になる
 * - それ以外（付け先が無い線・edgeMemos を渡さない画面）: 従来のメニュー（menu）
 *   - 削除: 削除できる orderOnly / planned（planned を優先）
 *   - 名前を付ける: 工程の組を持つ線（onSetEdgeLabel があるときだけ pair を渡す）
 *
 * `memo` を渡さなければ（= edgeMemos を渡さない画面）従来の判定と同じ。
 */
export function decideEdgeMenu(input: {
  kind: string | undefined;
  deletable: boolean;
  canRemoveOrder: boolean;
  canRemovePlanned: boolean;
  pair: { from: string; to: string } | null;
  memo?: { target: MemoSourceEdge | null; count: number; canWrite: boolean } | null;
}): EdgeMenuDecision | null {
  const removeOrder = input.kind === "orderOnly" && input.deletable && input.canRemoveOrder;
  const removePlanned = input.kind === "planned" && input.deletable && input.canRemovePlanned;
  const memo =
    input.memo && input.memo.target && (input.memo.count > 0 || input.memo.canWrite)
      ? { target: input.memo.target, count: input.memo.count }
      : null;
  if (!removeOrder && !removePlanned && !input.pair && !memo) return null;
  return {
    mode: memo ? "popover" : "menu",
    remove: removePlanned ? "planned" : removeOrder ? "orderOnly" : null,
    pair: input.pair,
    memo,
  };
}

// ── 描画の線へのメモの付与 ──

/** 描画の線（React Flow の Edge）のうち、メモの付与が触る部分 */
export type MemoDecoratableEdge = {
  type?: string;
  label?: unknown;
  labelStyle?: { fontSize?: number | string };
  data?: Record<string, unknown>;
};

/**
 * 描画の線にメモの情報を足す。edgeMemos が無い・付け先が無い線は、**渡した線をそのまま返す**
 * （同じ参照。edgeMemos を渡さない画面の線は従来から何も変わらない）。
 *
 * - 付け先のある線: data に memoTarget / memoCount を持たせる（線を押したときの判定が読む）
 * - メモが 1 件以上: 印つきの種類（memoType）にし、印を押したときの onOpenMemo、
 *   線の中央に文字があるか（hasLabel。印の位置に使う）、書ける画面か（canWrite。印の案内文に使う）を持たせる
 */
export function withEdgeMemo<E extends MemoDecoratableEdge>(
  rfEdge: E,
  flowEdge: EdgeMemoEdgeInput,
  memos: EdgeMemos | undefined,
  memoType: string,
  /** 印を押したときに呼ぶ。他のメニューを閉じ、小窓の見出しに置く線の操作を返す */
  beforeOpen?: () => EdgePopoverActions | undefined,
): E {
  const memoTarget = memos ? memos.target(flowEdge) : null;
  if (!memos || !memoTarget) return rfEdge;
  const memoCount = memos.count(memoTarget);
  const next: E = { ...rfEdge, data: { ...rfEdge.data, memoTarget, memoCount } };
  if (memoCount > 0) {
    next.type = memoType;
    next.data = {
      ...next.data,
      hasLabel: rfEdge.label != null && rfEdge.label !== "",
      // 印を文字の右に並べるため、文字と大きさも渡す（文字の幅を見積もる）
      labelText: typeof rfEdge.label === "string" ? rfEdge.label : "",
      labelFontSize: rfEdge.labelStyle?.fontSize,
      canWrite: memos.canWrite,
      onOpenMemo: (anchor: Rect) => memos.onOpen(memoTarget, anchor, beforeOpen?.()),
    };
  }
  return next;
}
