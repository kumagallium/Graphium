// ──────────────────────────────────────────────
// プロセスインデックス（.graphium-process-index.json）
//
// 各ノートの PROV グラフ（右パネルに出る手順フロー）を、ノートを開かずに
// 引けるようにした投影キャッシュ。プロセス一覧と、step 再利用の
// パラメータ候補がこれを土台にする。
//
// 設計は docs/internal/process-index-design.md。要点だけ再掲する:
//
//   P-1  graph は必ず provDocToFlowGraph(generateProvDocument(...)) の戻り値。
//        一覧のために別経路で構造を組み立てない（二つの真実を作らない）。
//   P-2  URL は保存しない。腐るので、表示時に media-index から引き直す。
//   P-3  編集経路はノート本文ただ一つ。一覧から graph を書き換えない。
//
// プロセスは素材と違い「ノートから導出されるもの」で、依存の向きが逆である点に
// 注意する（素材はノートが外の実体を参照する。プロセスはノートが正典）。
// ──────────────────────────────────────────────

import type { GraphiumDocument, GraphiumFile } from "../../lib/document-types";
import { generateProvDocument } from "../prov-generator/generator";
import { pageToGeneratorInput } from "../prov-generator/page-input";
import { provDocToFlowGraph, type FlowGraphData } from "./activity-graph-adapter";
import { t } from "../../i18n";
import { readAppDataFile, writeAppDataFile } from "../../lib/storage/app-data-file";

/**
 * 投影ロジック（generator + adapter）の版。
 * 出力の形が変わったら上げる → 読み込み時に全再投影される。
 * note-index の INDEX_SCHEMA_VERSION とは独立に上げてよい（別ファイルにした理由）。
 */
export const PROCESS_INDEX_VERSION = 1;

const APP_DATA_KEY = "process-index";
const DRIVE_FILE_NAME = ".graphium-process-index.json";

/** 一覧の行に出すサマリ。graph から導出できるが、毎回数え直さないための非正規化 */
export type ProcessSummary = {
  stepCount: number;
  materialCount: number;
  toolCount: number;
  outputCount: number;
  /**
   * グラフが枝分かれしているか（同じ素材が複数手順へ渡る／順序依存が分かれる）。
   * 直線の手順書と区別して一覧のアイコンを変える。
   */
  branching: boolean;
};

/** 写した瞬間のスナップショット。元ノートが後から変わっても追随しない */
export type ProcessForkOrigin = {
  noteId: string;
  /** フォーク時点の元ノートタイトル。元が改名・削除されても系譜が読める */
  title: string;
  forkedAt: string;
};

export type ProcessIndexEntry = {
  /**
   * プロセスのキー。v1 は 1ノート = 1プロセスなので noteId をそのまま使う。
   * ノート内を弱連結成分で分割するようになったら `${noteId}#${localId}` へ広げる
   * （そのときは PROCESS_INDEX_VERSION を上げて全再投影する）。
   */
  noteId: string;
  /** 一覧の表示名。v1 はノートタイトルを写す（プロセス独自の名前は持たせない） */
  title: string;
  /** 投影元ノートの modifiedTime。鮮度判定に使う */
  sourceModifiedAt: string;
  /** 投影を実行した時刻 */
  projectedAt: string;
  /** P-1 の産物。ただし URL は落としてある（P-2） */
  graph: FlowGraphData;
  summary: ProcessSummary;
  forkedFrom?: ProcessForkOrigin;
};

export type ProcessIndex = {
  version: number;
  updatedAt: string;
  processes: ProcessIndexEntry[];
};

export function createEmptyProcessIndex(): ProcessIndex {
  return {
    version: PROCESS_INDEX_VERSION,
    updatedAt: new Date().toISOString(),
    processes: [],
  };
}

// ── 投影 ──

/**
 * URL を落とす（P-2）。署名付き URL は時間で腐り、素材の差し替えでも変わる。
 * 表示に必要なら media-index から entityId / label で引き直す。
 */
function stripVolatileFields(graph: FlowGraphData): FlowGraphData {
  return {
    steps: graph.steps,
    edges: graph.edges,
    entities: graph.entities.map(({ mediaUrl: _url, mediaType: _type, ...rest }) => rest),
  };
}

/**
 * グラフが直線か、枝分かれしているか。
 *
 * 注意: 同じ名前でも material と output は別の Entity ノードになる
 * （インライン span は entityId 単位で、テキスト一致では merge されない）。
 * したがって「generates と used を繋いで step 間の連鎖を作る」ことはできない。
 * 実データ上、枝分かれは次の 2 通りで現れる:
 *
 *   - ある Entity が 2 つ以上の手順に used される（同じものが複数の工程へ渡る）
 *   - orderOnly（物質を特定しない順序依存）が 1 手順から複数へ分かれる／集まる
 */
function hasBranching(graph: FlowGraphData): boolean {
  const stepIds = new Set(graph.steps.map((s) => s.id));

  const consumersByEntity = new Map<string, Set<string>>();
  const orderOut = new Map<string, Set<string>>();
  const orderIn = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, value: string) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(value);
  };

  for (const e of graph.edges) {
    if (e.kind === "used" && stepIds.has(e.target)) {
      add(consumersByEntity, e.source, e.target);
    } else if (e.kind === "orderOnly" && stepIds.has(e.source) && stepIds.has(e.target)) {
      add(orderOut, e.source, e.target);
      add(orderIn, e.target, e.source);
    }
  }

  for (const set of consumersByEntity.values()) if (set.size >= 2) return true;
  for (const set of orderOut.values()) if (set.size >= 2) return true;
  for (const set of orderIn.values()) if (set.size >= 2) return true;
  return false;
}

function summarize(graph: FlowGraphData): ProcessSummary {
  let materialCount = 0;
  let toolCount = 0;
  let outputCount = 0;
  for (const e of graph.entities) {
    if (e.kind === "material") materialCount++;
    else if (e.kind === "tool") toolCount++;
    else if (e.kind === "output") outputCount++;
  }
  return {
    stepCount: graph.steps.length,
    materialCount,
    toolCount,
    outputCount,
    branching: hasBranching(graph),
  };
}

/**
 * ノート 1 件を投影する。手順を持たないノートは null（一覧に出さない）。
 *
 * ページは表示の単位であってプロセスの境界ではないので、全ページ分を連結する。
 * ノード id は blockId 由来なのでページを跨いでも衝突しない。
 */
export function buildProcessEntry(
  noteId: string,
  doc: GraphiumDocument,
  file: Pick<GraphiumFile, "modifiedTime">,
  prior?: ProcessIndexEntry,
): ProcessIndexEntry | null {
  const merged: FlowGraphData = { steps: [], entities: [], edges: [] };
  for (const page of doc.pages ?? []) {
    try {
      const graph = provDocToFlowGraph(generateProvDocument(pageToGeneratorInput(page)));
      merged.steps.push(...graph.steps);
      merged.entities.push(...graph.entities);
      merged.edges.push(...graph.edges);
    } catch {
      // 1 ページの投影に失敗しても他のページは拾う（note-prov-summary と同じ方針）
      continue;
    }
  }
  if (merged.steps.length === 0) return null;

  const graph = stripVolatileFields(merged);
  return {
    noteId,
    title: doc.title || "",
    sourceModifiedAt: file.modifiedTime,
    projectedAt: new Date().toISOString(),
    graph,
    summary: summarize(graph),
    // フォーク元は投影で作られる情報ではないので、既存エントリから引き継ぐ
    ...(prior?.forkedFrom ? { forkedFrom: prior.forkedFrom } : {}),
  };
}

// ── アプリが知っている最新の投影 ──
//
// step ブロックのパラメータピッカーは BlockNote の render の中から読む。
// Provider を増やすと SidePeek / Storybook で張り忘れが起きるので、
// media-index の latestIndex と同じくモジュール変数で配る（読む側は購読しない
// — ボタンを押した瞬間の内容が読めれば足りる）。

let latestProcessIndex: ProcessIndex | null = null;

/** 一覧の投影結果をアプリ全体へ配る */
export function setLatestProcessIndex(index: ProcessIndex | null): void {
  latestProcessIndex = index;
}

/** 直近の投影結果。まだ一度も投影・読み込みをしていなければ null */
export function getLatestProcessIndex(): ProcessIndex | null {
  return latestProcessIndex;
}

/** サインアウト時に捨てる */
export function clearLatestProcessIndex(): void {
  latestProcessIndex = null;
}

// ── 読み書き ──

export async function readProcessIndex(): Promise<ProcessIndex | null> {
  return readAppDataFile<ProcessIndex>(APP_DATA_KEY, DRIVE_FILE_NAME);
}

export async function saveProcessIndex(index: ProcessIndex): Promise<void> {
  await writeAppDataFile(APP_DATA_KEY, DRIVE_FILE_NAME, index);
}

// ── 鮮度判定と再投影 ──

/** ミリ秒の丸め差でループしないための許容幅（note-index と同じ） */
const MTIME_TOLERANCE_MS = 1000;

function isStale(entry: ProcessIndexEntry | undefined, file: GraphiumFile): boolean {
  if (!entry) return true;
  return (
    new Date(file.modifiedTime).getTime() >
    new Date(entry.sourceModifiedAt).getTime() + MTIME_TOLERANCE_MS
  );
}

/**
 * 投影が要るノートを洗い出す。UI 側はこの結果を見て、
 * 一覧を開いたときやアイドル時に少しずつ投影する（起動時に同期実行しない）。
 */
export function findStaleProcessFiles(
  index: ProcessIndex | null,
  files: GraphiumFile[],
): GraphiumFile[] {
  if (!index || index.version !== PROCESS_INDEX_VERSION) return [...files];
  const byId = new Map(index.processes.map((p) => [p.noteId, p]));
  return files.filter((f) => isStale(byId.get(f.id), f));
}

/**
 * インデックスを files に合わせて作り直す。
 *
 * - version 不一致 → 全件再投影（forkedFrom は引き継ぐ）
 * - 更新されたノート → そのノートだけ再投影
 * - 消えたノート → エントリ除去
 *
 * doc の読み込みは呼び出し側の docCache に委ねる（note-index の ensureIndex と同じ）。
 * 保存は fire-and-forget にせず await する — 投影は重いので取りこぼしたくない。
 */
export async function ensureProcessIndex(
  files: GraphiumFile[],
  docCache: Map<string, GraphiumDocument>,
  loadDoc: (fileId: string) => Promise<GraphiumDocument>,
  prefetched?: ProcessIndex | null,
): Promise<ProcessIndex> {
  const existing = prefetched !== undefined ? prefetched : await readProcessIndex();
  const versionMatches = existing?.version === PROCESS_INDEX_VERSION;
  const prior = new Map((existing?.processes ?? []).map((p) => [p.noteId, p]));

  const targets = versionMatches ? findStaleProcessFiles(existing!, files) : [...files];
  if (targets.length === 0 && versionMatches) {
    // 消えたノートの掃除だけ済ませる
    const fileIds = new Set(files.map((f) => f.id));
    const kept = existing!.processes.filter((p) => fileIds.has(p.noteId));
    if (kept.length === existing!.processes.length) return existing!;
    const pruned = { ...existing!, updatedAt: new Date().toISOString(), processes: kept };
    await saveProcessIndex(pruned);
    return pruned;
  }

  await Promise.allSettled(
    targets
      .filter((f) => !docCache.has(f.id))
      .map(async (f) => {
        docCache.set(f.id, await loadDoc(f.id));
      }),
  );

  const processes: ProcessIndexEntry[] = [];
  for (const file of files) {
    const needsRebuild = !versionMatches || targets.some((t) => t.id === file.id);
    if (!needsRebuild) {
      const kept = prior.get(file.id);
      if (kept) processes.push(kept);
      continue;
    }
    const doc = docCache.get(file.id);
    if (!doc) {
      // 読めなかったノートは古いエントリを残す（消すと一覧から突然消えて見える）
      const kept = prior.get(file.id);
      if (kept) processes.push(kept);
      continue;
    }
    // Wiki は人が書いた手順ではないので対象外
    if (doc.source === "ai") continue;
    const entry = buildProcessEntry(file.id, doc, file, prior.get(file.id));
    if (entry) processes.push(entry);
  }

  const index: ProcessIndex = {
    version: PROCESS_INDEX_VERSION,
    updatedAt: new Date().toISOString(),
    processes,
  };
  await saveProcessIndex(index);
  return index;
}

// ── パラメータ辞書（step 再利用の候補） ──

/** パラメータ key がどこに書かれていたか。同じ「温度」でも装置の設定か素材の条件かで意味が違う */
export type ParamOrigin = "step" | "material" | "tool" | "output";

export type ParamKeyStat = {
  key: string;
  /** この key を使っているノート数 */
  noteCount: number;
  /** 直近に使われた値の例（そのまま入れるためではなく、何の欄か思い出すため） */
  sampleValue?: string;
  /** 代表的な書かれ方（最も多い由来）。同じ key が複数の由来に跨ることもある */
  origin?: ParamOrigin;
};

/**
 * step 名で横断検索し、その手順で使われたパラメータの key を件数順に返す。
 *
 * 集める先が 2 つあることに注意する。実データでは手順の条件が step 直結の
 * パラメータではなく、**その手順に入る素材や使う装置の属性**として書かれている
 * ことのほうが多い（「圧力: 100 MPa」が焼結装置ではなく投入する粉末に付く、など）。
 * step.params だけを見ると、実際に使われているノートで候補が 1 つも出ない。
 *
 *   - step 直結のパラメータ（`@activity` 束縛の attribute span）
 *   - その step が used / generates する Entity の属性
 *
 * 表記ゆれ（「温度」「焼成温度」「Temperature」）は正規化しない。意味の違うものを
 * まとめるほうが害が大きいので、全部出して件数順に並べ、選ぶのはユーザーに委ねる。
 * 集計結果はインデックスに保存しない（非正規化を増やすと鮮度のズレ先が増える）。
 */
export function collectParamKeysForStep(
  index: ProcessIndex | null,
  stepName: string,
  splitLabel: (label: string) => { key: string | null; value: string },
): ParamKeyStat[] {
  const target = stepName.trim();
  if (!index || !target) return [];
  const stats = new Map<
    string,
    { notes: Set<string>; sample?: string; origins: Map<ParamOrigin, number> }
  >();

  const record = (label: string, noteId: string, origin: ParamOrigin) => {
    const { key, value } = splitLabel(label);
    if (!key) return;
    const stat = stats.get(key) ?? {
      notes: new Set<string>(),
      sample: undefined as string | undefined,
      origins: new Map<ParamOrigin, number>(),
    };
    stat.notes.add(noteId);
    if (!stat.sample && value) stat.sample = value;
    stat.origins.set(origin, (stat.origins.get(origin) ?? 0) + 1);
    stats.set(key, stat);
  };

  for (const process of index.processes) {
    const matchedStepIds = new Set(
      process.graph.steps.filter((s) => s.name.trim() === target).map((s) => s.id),
    );
    if (matchedStepIds.size === 0) continue;

    for (const step of process.graph.steps) {
      if (!matchedStepIds.has(step.id)) continue;
      for (const param of step.params ?? []) record(param.label, process.noteId, "step");
    }

    // この手順に繋がる Entity の属性も、その手順で記録した項目として扱う
    const entityById = new Map(process.graph.entities.map((e) => [e.id, e]));
    const related = new Set<string>();
    for (const edge of process.graph.edges) {
      if (edge.kind === "used" && matchedStepIds.has(edge.target)) related.add(edge.source);
      else if (edge.kind === "generates" && matchedStepIds.has(edge.source)) related.add(edge.target);
    }
    for (const entityId of related) {
      const entity = entityById.get(entityId);
      if (!entity) continue;
      const origin: ParamOrigin =
        entity.kind === "tool" ? "tool" : entity.kind === "output" ? "output" : "material";
      for (const attr of entity.attrs ?? []) record(attr.label, process.noteId, origin);
    }
  }

  return [...stats.entries()]
    .map(([key, stat]) => {
      let origin: ParamOrigin | undefined;
      let best = 0;
      for (const [o, n] of stat.origins) {
        if (n > best) {
          best = n;
          origin = o;
        }
      }
      return {
        key,
        noteCount: stat.notes.size,
        ...(stat.sample ? { sampleValue: stat.sample } : {}),
        ...(origin ? { origin } : {}),
      };
    })
    .sort((a, b) => b.noteCount - a.noteCount || a.key.localeCompare(b.key));
}

/** 過去の手順から引き継げるものを、書かれていた場所ごとにまとめたもの */
export type StepInheritance = {
  /** step 直結のパラメータ（`@activity` 束縛の attribute span / パラメータ表の列） */
  stepParams: ParamKeyStat[];
  /** その手順が使った・生んだ Entity と、そこに付いていた属性 */
  entities: InheritableEntity[];
};

export type InheritableEntity = {
  label: string;
  kind: "material" | "tool" | "output";
  /** この Entity を書いたノート数 */
  noteCount: number;
  /** この Entity に付いていた属性の key */
  attrs: ParamKeyStat[];
};

/**
 * 同名の手順から引き継げるものを、書かれていた場所ごとに分けて返す。
 *
 * 場所を混ぜてはいけない。実データでは「圧力: 100 MPa」は手順にではなく
 * 投入する素材に付いている。まとめて手順のパラメータとして引き継ぐと、
 * 元のノートと書き方が変わってしまい、同じ実験の記録なのに構造が揃わなくなる。
 * 引き継ぎ先も、素材の属性は素材表の列、手順のパラメータは手順の表の列と分ける。
 *
 * 表記ゆれは正規化しない（[[collectParamKeysForStep]] と同じ理由）。
 */
export function collectStepInheritance(
  index: ProcessIndex | null,
  stepName: string,
  splitLabel: (label: string) => { key: string | null; value: string },
  options: {
    /**
     * 除外する step のブロック ID。いま書いている step 自身を指す。
     * 自分の記録が自分の候補に出ても選ぶ意味が無いうえ、引き継ぎで入った内容が
     * 次の投影で候補として戻り、同じものが増え続ける。
     */
    excludeStepId?: string;
  } = {},
): StepInheritance {
  const target = stepName.trim();
  const empty: StepInheritance = { stepParams: [], entities: [] };
  if (!index || !target) return empty;

  type Acc = { notes: Set<string>; sample?: string; origins: Map<ParamOrigin, number> };
  const stepAcc = new Map<string, Acc>();
  // Entity は「名前 + 種類」で同一視する。同じ名前でも素材と道具は別物
  const entityAcc = new Map<
    string,
    { label: string; kind: "material" | "tool" | "output"; notes: Set<string>; attrs: Map<string, Acc> }
  >();

  const record = (acc: Map<string, Acc>, label: string, noteId: string, origin: ParamOrigin) => {
    const { key, value } = splitLabel(label);
    if (!key) return;
    const stat = acc.get(key) ?? {
      notes: new Set<string>(),
      sample: undefined as string | undefined,
      origins: new Map<ParamOrigin, number>(),
    };
    stat.notes.add(noteId);
    if (!stat.sample && value) stat.sample = value;
    stat.origins.set(origin, (stat.origins.get(origin) ?? 0) + 1);
    acc.set(key, stat);
  };

  for (const process of index.processes) {
    const matched = new Set(
      process.graph.steps
        .filter((s) => s.name.trim() === target && s.id !== options.excludeStepId)
        .map((s) => s.id),
    );
    if (matched.size === 0) continue;

    for (const step of process.graph.steps) {
      if (!matched.has(step.id)) continue;
      for (const param of step.params ?? []) record(stepAcc, param.label, process.noteId, "step");
    }

    const entityById = new Map(process.graph.entities.map((e) => [e.id, e]));
    const related = new Set<string>();
    for (const edge of process.graph.edges) {
      if (edge.kind === "used" && matched.has(edge.target)) related.add(edge.source);
      else if (edge.kind === "generates" && matched.has(edge.source)) related.add(edge.target);
    }
    for (const entityId of related) {
      const entity = entityById.get(entityId);
      if (!entity) continue;
      const label = entity.label.trim();
      if (!label) continue;
      const kind: "material" | "tool" | "output" =
        entity.kind === "tool" ? "tool" : entity.kind === "output" ? "output" : "material";
      const acc =
        entityAcc.get(`${kind}:${label}`) ??
        { label, kind, notes: new Set<string>(), attrs: new Map<string, Acc>() };
      acc.notes.add(process.noteId);
      for (const attr of entity.attrs ?? []) record(acc.attrs, attr.label, process.noteId, kind);
      entityAcc.set(`${kind}:${label}`, acc);
    }
  }

  const toStats = (acc: Map<string, Acc>): ParamKeyStat[] =>
    [...acc.entries()]
      .map(([key, stat]) => {
        let origin: ParamOrigin | undefined;
        let best = 0;
        for (const [o, n] of stat.origins) {
          if (n > best) {
            best = n;
            origin = o;
          }
        }
        return {
          key,
          noteCount: stat.notes.size,
          ...(stat.sample ? { sampleValue: stat.sample } : {}),
          ...(origin ? { origin } : {}),
        };
      })
      .sort((a, b) => b.noteCount - a.noteCount || a.key.localeCompare(b.key));

  return {
    stepParams: toStats(stepAcc),
    entities: [...entityAcc.values()]
      .map((e) => ({
        label: e.label,
        kind: e.kind,
        noteCount: e.notes.size,
        attrs: toStats(e.attrs),
      }))
      // 引き継げるものが多い順。道具は設定が多く、素材は名前だけのことも多い
      .sort(
        (a, b) => b.attrs.length - a.attrs.length || b.noteCount - a.noteCount ||
          a.label.localeCompare(b.label),
      ),
  };
}

export type StepNameStat = {
  name: string;
  /** この名前の手順を書いたノート数 */
  noteCount: number;
  /** 引き継げるパラメータ key の数。0 なら名前だけ選べる */
  paramCount: number;
};

/**
 * 過去に書いた手順の名前を、引き継げるパラメータの数とともに返す。
 *
 * パラメータの無い手順も落とさない。名前だけでも選べることに意味がある —
 * 「SPS」と打つ前に「放電プラズマ焼結」が目に入れば表記ゆれが起きない。
 * 並びはパラメータを持つものが先、次に記録の多い順。
 */
export function collectStepNames(
  index: ProcessIndex | null,
  splitLabel?: (label: string) => { key: string | null; value: string },
): StepNameStat[] {
  if (!index) return [];
  const byName = new Map<string, Set<string>>();
  // 題を付けていない手順は投影の時点で「(無題)」という名前になる。
  // 引き継ぎ先の名前としては意味を持たないので候補から外す
  const untitled = t("nav.untitled").trim();
  for (const process of index.processes) {
    for (const step of process.graph.steps) {
      const name = step.name.trim();
      if (!name || name === untitled) continue;
      if (!byName.has(name)) byName.set(name, new Set());
      byName.get(name)!.add(process.noteId);
    }
  }
  return [...byName.entries()]
    .map(([name, notes]) => ({
      name,
      noteCount: notes.size,
      paramCount: splitLabel ? collectParamKeysForStep(index, name, splitLabel).length : 0,
    }))
    .sort(
      (a, b) =>
        b.paramCount - a.paramCount || b.noteCount - a.noteCount || a.name.localeCompare(b.name),
    );
}
