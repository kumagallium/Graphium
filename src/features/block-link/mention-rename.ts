// ──────────────────────────────────────────────
// @メンションのラベル追従（タイトルリネーム伝播）
//
// メンションは本文上「@タイトル」の青文字テキスト（挿入時のスナップショット）として
// 保存され、ノート ID はリンクレコード（provLinks / knowledgeLinks の targetNoteId）
// 側にしか無い。そのためタイトルを変更しても参照元のラベルは自動では変わらない。
// このモジュールは、参照元ノートのラベルを新タイトルへ書き換えるための純関数群。
// ファイル IO・state 更新は呼び出し側（use-file-manager / note-app）が担う。
//
// ラベルの形式は 2 系統ある:
// - 通常ノート / 引用ピッカー経由の wiki: `@タイトル`
// - `@` メニュー経由の wiki: `@🤖 Summary: タイトル` / `@🤖 Concept: タイトル`
//   （mention-menu.ts の formatWikiMentionLabel が唯一のフォーマット源）
// そのため置換は「from → to のパターン集合」で行う。
// ──────────────────────────────────────────────

import type { GraphiumDocument } from "../../lib/document-types";
import type { BlockLink } from "../../lib/block-link-types";
import { formatWikiMentionLabel } from "./mention-menu";
import type { TableMeta } from "../../lib/document-types";
import { collectTableBlocks, readCellText } from "../table-meta/table-cells";
import { renamePlanRowInTable } from "../network-graph/plan-flow";

type InlineRun = {
  type?: string;
  text?: string;
  styles?: Record<string, string>;
  /** type: "link" run の内側コンテンツ */
  content?: InlineRun[];
  href?: string;
};

export type MentionPattern = {
  from: string;
  to: string;
  /** ラベルの装飾部（`@` / `@🤖 Summary: ` 等）。一意フォールバック時に、
   *  run の現在の装飾形式を保ったまま新タイトルへ書き換えるために使う。 */
  prefix: string;
};

/**
 * リネームに対応する置換パターン集合を組み立てる。
 * - 常に `@旧` → `@新`（通常ノートのメンション + 引用ピッカー経由の wiki 引用）
 * - includeWikiLabels 指定時は `@🤖 Summary: 旧` / `@🤖 Concept: 旧` も追加
 *   （`@` メニュー経由で挿入された wiki メンションの装飾付きラベル。挿入時点の
 *   kind が現在と異なる可能性を考慮し、kind を問わず両方をパターンに含める）
 */
export function buildMentionPatterns(
  oldTitle: string,
  newTitle: string,
  opts?: { includeWikiLabels?: boolean },
): MentionPattern[] {
  const patterns: MentionPattern[] = [
    { from: `@${oldTitle}`, to: `@${newTitle}`, prefix: "@" },
  ];
  if (opts?.includeWikiLabels) {
    for (const kind of ["summary", "concept", "topic"]) {
      const prefix = `@${formatWikiMentionLabel(kind, "")}`;
      patterns.push({
        from: `@${formatWikiMentionLabel(kind, oldTitle)}`,
        to: `@${formatWikiMentionLabel(kind, newTitle)}`,
        prefix,
      });
    }
  }
  return patterns;
}

/**
 * インラインコンテンツ内のメンション run（青文字で text がパターンの from に完全一致）を
 * to に置き換える。1 つも置き換わらなければ null を返す（保存不要の判定用）。
 * type: "link" run の内側（content）にも同じ規則で再帰する。
 *
 * 完全一致に限定する理由: 部分一致は本文中の偶然の文字列（青文字装飾で @旧タイトル を
 * 含む文など）を誤って書き換えるリスクがあるため。メンションは挿入時に「@ラベル」
 * 単独 run + 半角スペースの形で入る（insertNoteMentionInline）ので完全一致で拾える。
 */
export function replaceMentionRunsInContent(
  content: unknown,
  patterns: MentionPattern[],
): InlineRun[] | null {
  if (!Array.isArray(content) || patterns.length === 0) return null;
  let changed = false;
  const next = (content as InlineRun[]).map((run) => {
    if (run?.type === "text" && run.styles?.textColor === "blue" && run.text) {
      const hit = patterns.find((p) => p.from === run.text);
      if (hit) {
        changed = true;
        return { ...run, text: hit.to };
      }
    }
    if (run?.type === "link" && Array.isArray(run.content)) {
      const inner = replaceMentionRunsInContent(run.content, patterns);
      if (inner) {
        changed = true;
        return { ...run, content: inner };
      }
    }
    return run;
  });
  return changed ? next : null;
}

/**
 * 1 ブロック分のインラインコンテンツを書き換える。
 * 1) まずパターン完全一致で置換（replaceMentionRunsInContent）。
 * 2) 一致が無い場合、uniqueFallback が真（= このブロックのノート参照リンクが
 *    リネーム対象宛てのみ、と呼び出し側が判定済み）かつ青文字の `@` run が
 *    ちょうど 1 個なら、その run を新ラベルへ書き換える。
 *
 * (2) は「skip 等でラベルが旧世代のまま取り残された」メンションの自動修復。
 * 参照リンクが対象宛てのみ + 候補 run が 1 個なら、テキストが何世代前でも
 * その run が対象のメンションであることは一意に決まるので安全に書き換えられる。
 * 装飾（🤖 Summary/Concept:）は run の現在の形式（prefix 最長一致）を保つ。
 */
export function rewriteMentionRunsForBlock(
  content: unknown,
  patterns: MentionPattern[],
  opts?: { uniqueFallback?: boolean },
): any | null {
  if (isTableContent(content)) return rewriteMentionRunsInTable(content, patterns, opts);
  const exact = replaceMentionRunsInContent(content, patterns);
  if (exact || !opts?.uniqueFallback || !Array.isArray(content)) return exact;
  const runs = content as InlineRun[];
  const candidateIdxs: number[] = [];
  runs.forEach((r, i) => {
    if (r?.type === "text" && r.styles?.textColor === "blue" && r.text?.startsWith("@")) {
      candidateIdxs.push(i);
    }
  });
  if (candidateIdxs.length !== 1) return null;
  const idx = candidateIdxs[0];
  const run = runs[idx];
  const byLongestPrefix = [...patterns].sort((a, b) => b.prefix.length - a.prefix.length);
  const pat = byLongestPrefix.find((p) => run.text!.startsWith(p.prefix)) ?? patterns[0];
  if (run.text === pat.to) return null; // 既に新ラベル
  const next = [...runs];
  next[idx] = { ...run, text: pat.to };
  return next;
}

type TableContentLike = { type: "tableContent"; rows: Array<{ cells?: unknown[] }> };

function isTableContent(content: unknown): content is TableContentLike {
  return (
    !!content &&
    typeof content === "object" &&
    (content as { type?: unknown }).type === "tableContent" &&
    Array.isArray((content as { rows?: unknown }).rows)
  );
}

/** セルのインライン配列（旧形式は配列そのもの、現形式は tableCell.content） */
function cellRuns(cell: unknown): unknown {
  if (Array.isArray(cell)) return cell;
  if (cell && typeof cell === "object" && (cell as { type?: unknown }).type === "tableCell") {
    return (cell as { content?: unknown }).content;
  }
  return null;
}

function withCellRuns(cell: unknown, runs: InlineRun[]): unknown {
  return Array.isArray(cell) ? runs : { ...(cell as object), content: runs };
}

/**
 * 表ブロック（tableContent）のセルに入った @メンションを書き換える。
 * 表のセルは行→セル→インライン配列の入れ子なので、段落と同じ置換をセルごとに当てる。
 * 一意フォールバックは「表全体で候補の `@` run がちょうど 1 個」のときだけ（表には
 * 別ノートへの参照が並ぶのが普通なので、セル単位で緩めると取り違えるおそれがある）。
 */
function rewriteMentionRunsInTable(
  content: TableContentLike,
  patterns: MentionPattern[],
  opts?: { uniqueFallback?: boolean },
): TableContentLike | null {
  let fallbackCell: { r: number; c: number } | null = null;
  if (opts?.uniqueFallback) {
    let count = 0;
    content.rows.forEach((row, r) =>
      (row?.cells ?? []).forEach((cell, c) => {
        const runs = cellRuns(cell);
        if (!Array.isArray(runs)) return;
        for (const run of runs as InlineRun[]) {
          if (run?.type === "text" && run.styles?.textColor === "blue" && run.text?.startsWith("@")) {
            count++;
            fallbackCell = { r, c };
          }
        }
      }),
    );
    if (count !== 1) fallbackCell = null;
  }
  let changed = false;
  const rows = content.rows.map((row, r) => {
    const cells = row?.cells;
    if (!Array.isArray(cells)) return row;
    let rowChanged = false;
    const nextCells = cells.map((cell, c) => {
      const isFallback = fallbackCell !== null && fallbackCell.r === r && fallbackCell.c === c;
      const nc = rewriteMentionRunsForBlock(cellRuns(cell), patterns, { uniqueFallback: isFallback });
      if (!nc) return cell;
      rowChanged = true;
      return withCellRuns(cell, nc);
    });
    if (!rowChanged) return row;
    changed = true;
    return { ...row, cells: nextCells };
  });
  return changed ? { ...content, rows } : null;
}

/**
 * 表の @メンションをノートの改名で書き換えたあと、表の注釈（tableMeta）を追従させる。
 *
 * - noteLinks: 行の値（`@旧タイトル`）→ ノート ID の対応を `@新タイトル` へ付け替える。
 *   キーは行の名前セルの文字そのものなので、付け替えないと行とノートの対応が切れる
 *   （行のアイコン・工程グラフが「未リンク」になる）。値が改名したノートのものだけ触る。
 * - 付け替えた行名は、同じノートの全部の表の「入力元」列と線の名前にも当てる
 *   （network-graph/plan-flow.ts の renamePlanRowInTable）。
 *
 * rewrittenTableIds: セルの @メンションを実際に書き換えた表。書き換えていない表の
 * noteLinks は触らない（セルが旧ラベルのまま、キーだけ新しくなるずれを作らない）。
 * 戻り値: 書き換えた表の content / meta（blockId ごと）。
 */
export function renameMentionRowsInTables(
  tables: Map<string, any>,
  metas: Record<string, TableMeta>,
  rewrittenTableIds: ReadonlySet<string>,
  renamedNoteId: string,
  patterns: MentionPattern[],
): { contents: Map<string, any>; metas: Map<string, TableMeta> } {
  const nextContents = new Map<string, any>();
  const nextMetas = new Map<string, TableMeta>();
  const rowRenames: Array<{ from: string; to: string }> = [];
  for (const blockId of rewrittenTableIds) {
    const meta = metas[blockId];
    if (!meta?.noteLinks) continue;
    // 書き換え後の表に実在するセルの文字（新ラベルのセルがあるかの判定用）
    const cellTexts = new Set<string>();
    for (const row of tables.get(blockId)?.content?.rows ?? []) {
      for (const c of row?.cells ?? []) cellTexts.add(readCellText(c));
    }
    let changed = false;
    const noteLinks: Record<string, string> = {};
    for (const [key, noteId] of Object.entries(meta.noteLinks)) {
      // 完全一致（`@旧タイトル`）に加え、一意フォールバックで直した旧世代のラベル
      // （修正前に改名され、セルもキーも何世代か前の名前のまま）も拾う。ノート ID が
      // 一致し、新ラベルのセルが表に実在するときだけ（行を取り違えない）
      const hit =
        noteId !== renamedNoteId
          ? undefined
          : (patterns.find((p) => p.from === key) ??
            [...patterns]
              .sort((a, b) => b.prefix.length - a.prefix.length)
              .find((p) => key.startsWith(p.prefix) && key !== p.to && cellTexts.has(p.to)));
      if (hit && !Object.prototype.hasOwnProperty.call(meta.noteLinks, hit.to)) {
        noteLinks[hit.to] = noteId;
        rowRenames.push({ from: key, to: hit.to });
        changed = true;
      } else {
        noteLinks[key] = noteId;
      }
    }
    if (changed) nextMetas.set(blockId, { ...meta, noteLinks });
  }
  if (rowRenames.length === 0) return { contents: nextContents, metas: nextMetas };

  for (const [blockId, block] of tables) {
    let content = block?.content;
    let meta: TableMeta | undefined = nextMetas.get(blockId) ?? metas[blockId];
    let contentChanged = false;
    let metaChanged = false;
    for (const { from, to } of rowRenames) {
      const r = renamePlanRowInTable({ ...block, content }, meta, from, to);
      if (r.content) {
        content = r.content;
        contentChanged = true;
      }
      if (r.meta) {
        meta = r.meta;
        metaChanged = true;
      }
    }
    if (contentChanged) nextContents.set(blockId, content);
    if (metaChanged && meta) nextMetas.set(blockId, meta);
  }
  return { contents: nextContents, metas: nextMetas };
}

/**
 * 開いているエディタの表の注釈（tableMeta ストア）を読み書きする最小限の口。
 * applyMentionRenameToLiveEditor が表の noteLinks などを追従させるのに使う。
 */
export type MentionRenameTableMetaAccess = {
  getSnapshot: () => Record<string, TableMeta>;
  replaceMeta: (blockId: string, meta: TableMeta) => void;
};

/**
 * 開いているエディタ（BlockNote インスタンス）が実装すべき最小限の操作。
 * メイン・SidePeek はどちらも editorRef.current がこの形を満たす。
 */
export type MentionRenameLiveEditor = {
  getBlock: (id: string) => { id: string; type?: string; content?: unknown } | undefined;
  updateBlock: (block: { id: string }, update: { content: unknown }) => void;
  /** 全ブロック（表の「入力元」列の追従で、リンクの無い表も見るため） */
  document?: unknown[];
};

/**
 * 開いているエディタの中で、renamedNoteId への @メンションラベルを直接書き換える。
 * ファイルへの書き込みはしない — updateBlock が onChange を発火させるので、
 * 変更は呼び出し側の通常のオートセーブ経路（doSave/handleSave）で永続化される。
 *
 * mention-live: propagateMentionRename（use-file-manager.ts）が「参照元 R が
 * 開いているか」を判定した後にこの関数を呼ぶ。R が開いていればファイルは直書き
 * しない（次のオートセーブで巻き戻るため）。メイン・SidePeek（付随・一覧・
 * 素材ギャラリーのどれで開いたかを問わない）で同じ処理を共有する。
 *
 * - allLinks: このエディタの linkStore が持つ現在のリンク一覧（保存前の最新状態。
 *   ファイルに書き込まれたリンクレコードではなく、ライブなエディタの状態を使う）
 * - resolveCurrentTitle: 同名曖昧ガード用に、任意ノートの現在タイトルを引く
 * - 戻り値: 1 つ以上のブロックを書き換えたら true。false は「対象ラベルが
 *   見つからなかった」（本文が未読み込み・リンク未記録等）で、呼び出し側は
 *   このエディタに任せず、書き込み中の保存を待ってからファイルを直接書き換える。
 */
export function applyMentionRenameToLiveEditor(
  editor: MentionRenameLiveEditor,
  allLinks: Array<Pick<BlockLink, "sourceBlockId" | "targetNoteId">>,
  resolveCurrentTitle: (noteId: string) => string | undefined,
  renamedNoteId: string,
  oldTitle: string,
  newTitle: string,
  opts?: { includeWikiLabels?: boolean; tableMeta?: MentionRenameTableMetaAccess },
): boolean {
  if (!oldTitle || !newTitle || oldTitle === newTitle) return false;
  const patterns = buildMentionPatterns(oldTitle, newTitle, opts);
  const blockIds = new Set<string>();
  const blockTargets = new Map<string, Set<string>>();
  for (const l of allLinks) {
    if (!l.sourceBlockId || !l.targetNoteId) continue;
    let set = blockTargets.get(l.sourceBlockId);
    if (!set) blockTargets.set(l.sourceBlockId, (set = new Set()));
    set.add(l.targetNoteId);
    if (l.targetNoteId === renamedNoteId) blockIds.add(l.sourceBlockId);
  }
  // 同名曖昧ガード（applyMentionRenameToDoc と同じ基準）: 同じブロックに
  // 「別ノートだが現タイトルが旧タイトルと同じ」参照が同居していたら触らない
  for (const l of allLinks) {
    if (!l.sourceBlockId || !blockIds.has(l.sourceBlockId)) continue;
    if (l.targetNoteId && l.targetNoteId !== renamedNoteId) {
      if (resolveCurrentTitle(l.targetNoteId) === oldTitle) blockIds.delete(l.sourceBlockId);
    }
  }
  let changed = false;
  const rewrittenTableIds = new Set<string>();
  for (const bid of blockIds) {
    try {
      const block = editor.getBlock?.(bid);
      if (!block || !block.content) continue;
      const nc = rewriteMentionRunsForBlock(block.content, patterns, {
        uniqueFallback: blockTargets.get(bid)?.size === 1,
      });
      if (nc) {
        editor.updateBlock(block, { content: nc });
        changed = true;
        if (isTableContent(nc)) rewrittenTableIds.add(bid);
      }
    } catch {
      // ブロックが削除済み等は無視（伝播はベストエフォート）
    }
  }
  // 表の注釈（noteLinks・入力元・線の名前）の追従。メタは updateBlock と同じ tick で
  // ストアへ書くので、次のオートセーブが本文と一緒に書き出す
  if (rewrittenTableIds.size > 0 && opts?.tableMeta) {
    try {
      const tables = collectTableBlocks((editor.document ?? []) as any[]);
      const r = renameMentionRowsInTables(
        tables,
        opts.tableMeta.getSnapshot(),
        rewrittenTableIds,
        renamedNoteId,
        patterns,
      );
      for (const [blockId, meta] of r.metas) opts.tableMeta.replaceMeta(blockId, meta);
      for (const [blockId, content] of r.contents) {
        const block = editor.getBlock?.(blockId);
        if (block) editor.updateBlock(block, { content });
      }
    } catch {
      // 伝播はベストエフォート
    }
  }
  return changed;
}

/**
 * mention-live: 「準備ができていないエディタ」に届いた改名 1 件分。準備ができた時点で
 * 届いた順にエディタへ当てるために覚えておく。
 */
export type PendingMentionRename = {
  renamedNoteId: string;
  oldTitle: string;
  newTitle: string;
  includeWikiLabels: boolean;
};

export type LiveMentionRenameQueue = {
  /**
   * registerLivePeek の applyMentionRename 本体から呼ぶ。ready なら apply をその場で呼んで
   * 結果を返す。ready でなければ改名を覚えて false を返す（呼び出し側 propagateMentionRename
   * は今までどおりファイルを直接書き換える。表示はファイルの書き換えで新しくなる）。
   */
  applyOrDefer: (
    ready: boolean,
    apply: (rename: PendingMentionRename) => boolean,
    renamedNoteId: string,
    oldTitle: string,
    newTitle: string,
    includeWikiLabels: boolean,
  ) => boolean;
  /**
   * エディタの実体とリンクの復元の両方が揃った時点で呼ぶ。覚えていた改名を届いた順に当てる
   * （無ければ何もしない）。同じ id への複数回の改名（A→B→C）が準備前に届いていても、
   * 届いた順に適用するので最終的に C になる（A→B を当てた本文に B→C を当てるだけで
   * 自然に畳み込まれる。特別な合成は不要）。
   */
  flushPending: (apply: (rename: PendingMentionRename) => boolean) => void;
  /**
   * ピークが準備ができる前に閉じたときに呼ぶ。覚えていた改名は捨てる
   * （ファイルは propagateMentionRename 側がすでに直接書き換えている）。
   */
  dispose: () => void;
};

/**
 * mention-live: 開いた直後でまだ準備ができていないエディタ（(a) エディタの実体がある、
 * (b) 開いた本文のリンクがそのエディタの linkStore に復元済み、の両方を満たす前）に届いた
 * 改名を覚えておくための小さな列。サイドピーク（side-peek.tsx）とメインエディタ
 * （note-app.tsx）の両方が同じ実装を使う（口を作り直さない）。
 *
 * ready の判定はこの関数の外（呼び出し側）が行う。エディタ・リンクストアの実体は
 * コンポーネントごとに異なる形（editorRef / linkStoreRef 等）を持つため、ここでは
 * 「ready かどうか」と「実際に当てる関数」を毎回受け取るだけにして、判定ロジックを
 * 重複させない。
 */
export function createLiveMentionRenameQueue(): LiveMentionRenameQueue {
  let pending: PendingMentionRename[] = [];
  return {
    applyOrDefer(ready, apply, renamedNoteId, oldTitle, newTitle, includeWikiLabels) {
      const entry: PendingMentionRename = { renamedNoteId, oldTitle, newTitle, includeWikiLabels };
      if (!ready) {
        pending.push(entry);
        return false;
      }
      return apply(entry);
    },
    flushPending(apply) {
      if (pending.length === 0) return;
      const queued = pending;
      pending = [];
      for (const rename of queued) apply(rename);
    },
    dispose() {
      pending = [];
    },
  };
}

export type MentionRenameResult = {
  doc: GraphiumDocument;
  /** ラベルを書き換えたブロック ID（ライブエディタへの反映用） */
  changedBlockIds: string[];
};

/**
 * 参照元ノートの doc に対して、renamedNoteId へのメンションラベルを newTitle へ追従させる。
 *
 * - renamedNoteId はプレフィックス無しの raw id（リンクレコードの targetNoteId と同じ形）。
 * - 対象ブロックはリンクレコード（provLinks / knowledgeLinks / v1 互換 links）の
 *   targetNoteId === renamedNoteId で特定する。タイトル文字列だけに頼らないので、
 *   同名の別ノートを誤って書き換えない。
 * - 同名曖昧ガード: 同じブロックに「別ノートだが現在のタイトルが oldTitle と同じ」参照が
 *   同居している場合、どの「@旧タイトル」がどちらを指すか run 単位では判別できないため、
 *   そのブロックには触らない（誤った付け替えより不追従を選ぶ）。
 * - 何も変わらなければ null（保存不要）。
 */
export function applyMentionRenameToDoc(
  doc: GraphiumDocument,
  renamedNoteId: string,
  oldTitle: string,
  newTitle: string,
  resolveCurrentTitle: (noteId: string) => string | undefined,
  opts?: { includeWikiLabels?: boolean },
): MentionRenameResult | null {
  if (!oldTitle || !newTitle || oldTitle === newTitle) return null;
  const page = doc.pages?.[0];
  if (!page) return null;
  const links: Array<Pick<BlockLink, "sourceBlockId" | "targetNoteId">> = [
    ...(page.provLinks ?? []),
    ...(page.knowledgeLinks ?? []),
    ...(page.links ?? []),
  ];
  const targetBlockIds = new Set<string>();
  // ブロックごとのノート参照先集合（一意フォールバック判定用）
  const blockTargets = new Map<string, Set<string>>();
  for (const l of links) {
    if (!l?.sourceBlockId || !l.targetNoteId) continue;
    let set = blockTargets.get(l.sourceBlockId);
    if (!set) blockTargets.set(l.sourceBlockId, (set = new Set()));
    set.add(l.targetNoteId);
    if (l.targetNoteId === renamedNoteId) targetBlockIds.add(l.sourceBlockId);
  }
  if (targetBlockIds.size === 0) return null;

  // 同名曖昧ガード
  for (const l of links) {
    if (!l?.sourceBlockId || !targetBlockIds.has(l.sourceBlockId)) continue;
    if (
      l.targetNoteId &&
      l.targetNoteId !== renamedNoteId &&
      resolveCurrentTitle(l.targetNoteId) === oldTitle
    ) {
      targetBlockIds.delete(l.sourceBlockId);
    }
  }
  if (targetBlockIds.size === 0) return null;

  const patterns = buildMentionPatterns(oldTitle, newTitle, opts);
  const changedBlockIds: string[] = [];
  const mapBlocks = (blocks: any[]): any[] => {
    let anyChanged = false;
    const next = blocks.map((b) => {
      let nb = b;
      if (b?.id && targetBlockIds.has(b.id)) {
        const nc = rewriteMentionRunsForBlock(b.content, patterns, {
          // 参照リンクがリネーム対象宛てのみのブロックは、完全一致しない旧世代
          // ラベルも一意に特定できるため修復する
          uniqueFallback: blockTargets.get(b.id)?.size === 1,
        });
        if (nc) {
          nb = { ...nb, content: nc };
          changedBlockIds.push(b.id);
        }
      }
      if (Array.isArray(b?.children) && b.children.length > 0) {
        const nch = mapBlocks(b.children);
        if (nch !== b.children) {
          nb = nb === b ? { ...b, children: nch } : { ...nb, children: nch };
        }
      }
      if (nb !== b) anyChanged = true;
      return nb;
    });
    return anyChanged ? next : blocks;
  };

  let newBlocks = mapBlocks(page.blocks ?? []);
  if (changedBlockIds.length === 0) return null;

  // 表の注釈（noteLinks・入力元・線の名前）の追従（applyMentionRenameToLiveEditor と同じ）
  let tableMeta = page.tableMeta;
  const tables = collectTableBlocks(newBlocks);
  const rewrittenTableIds = new Set(changedBlockIds.filter((id) => tables.has(id)));
  if (rewrittenTableIds.size > 0 && tableMeta) {
    const r = renameMentionRowsInTables(tables, tableMeta, rewrittenTableIds, renamedNoteId, patterns);
    if (r.metas.size > 0) {
      tableMeta = { ...tableMeta };
      for (const [blockId, meta] of r.metas) tableMeta[blockId] = meta;
    }
    if (r.contents.size > 0) {
      const replaceContents = (blocks: any[]): any[] =>
        blocks.map((b) => {
          let nb = b;
          if (b?.id && r.contents.has(b.id)) {
            nb = { ...nb, content: r.contents.get(b.id) };
            if (!changedBlockIds.includes(b.id)) changedBlockIds.push(b.id);
          }
          if (Array.isArray(b?.children) && b.children.length > 0) {
            nb = { ...nb, children: replaceContents(b.children) };
          }
          return nb;
        });
      newBlocks = replaceContents(newBlocks);
    }
  }
  return {
    doc: {
      ...doc,
      pages: [
        { ...page, blocks: newBlocks, ...(tableMeta !== page.tableMeta ? { tableMeta } : {}) },
        ...doc.pages.slice(1),
      ],
      modifiedAt: new Date().toISOString(),
    },
    changedBlockIds,
  };
}
