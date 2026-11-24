// 共有する文書が「共有先に無い資料」をどれだけ持っているかを数え、共有の前に聞く。
//
// なぜ要るか:
//   トピック・回答などのナレッジは、複数のノートから作られる。ページには、元ノートの一節
//   （引用の targetQuote・passageContexts・topicMarkdown の `[[source:<id>|一節]]`）と、
//   元ノートの題（本文の `@<題>`）がそのまま入る。ノートでも、@ でつないだ相手の題が
//   読める写しの来歴（.prov.jsonld）に出る。共有したのはこのページだけなのに、
//   共有していないノートの一節や題が共有フォルダの読み手に見えてしまう。
//   作った本人もそれに気づけないので、共有の前に数を出して選んでもらう。
//
// 「共有先にある」とは:
//   手元のノート・ナレッジを開いて sharedRef があり、その共有エントリが共有先と同じ共有フォルダに
//   あること。別の共有フォルダにあるものは、共有先の読み手が読めるとは限らないので「無い」に数える
//   （どちらが広いかは Graphium には分からない。cross-folder.ts と同じ立場）。
//   開けない id（PDF・URL などの素材、消したノート）も「無い」に数える。素材の中身は共有フォルダに無い。
//   メモ（`memo:`）は数えない。共有の共通処理が常に外す（strip-memo-traces.ts）。
//
// 外すかどうかは利用者が選ぶ（既定は「外して共有」）。外すのは共有コピーと読める写しだけで、
// 手元の文書は変えない（share-note.ts の hideSourceIds）。

import type { GraphiumDocument } from "../../lib/document-types";
import { parseSourceCitations } from "../../lib/source-citations";
import { chooseAction, type ChoiceAnswer } from "../../ui/confirm-dialog";

/** 一度に開いて確かめる数の上限。超えた分は確かめずに「無い」に数える（共有を待たせない） */
export const MAX_SOURCES_TO_CHECK = 200;

function isMemoId(id: string): boolean {
  return id.startsWith("memo:");
}

/**
 * 文書が指している資料の id を集める（重複なし・出てきた順）。
 * 自分自身とメモは除く。
 */
export function collectReferencedSourceIds(doc: GraphiumDocument, selfIds: readonly string[] = []): string[] {
  const out: string[] = [];
  const seen = new Set<string>(selfIds);
  const add = (id: unknown) => {
    if (typeof id !== "string") return;
    const v = id.trim();
    if (!v || seen.has(v) || isMemoId(v)) return;
    seen.add(v);
    out.push(v);
  };
  for (const page of doc.pages ?? []) {
    if (!page) continue;
    for (const l of page.knowledgeLinks ?? []) add(l?.targetNoteId);
    for (const l of page.provLinks ?? []) add(l?.targetNoteId);
    for (const l of (page as { links?: { targetNoteId?: unknown }[] }).links ?? []) add(l?.targetNoteId);
  }
  for (const l of doc.noteLinks ?? []) add(l?.targetNoteId);
  const meta = doc.wikiMeta;
  if (meta) {
    for (const id of meta.derivedFromNotes ?? []) add(id);
    for (const id of meta.procedureContext?.derivedFromNotes ?? []) add(id);
    for (const p of meta.passageContexts ?? []) add(p?.sourceId);
    for (const e of meta.sourceCheck?.entries ?? []) add(e?.sourceId);
    for (const c of parseSourceCitations(meta.topicMarkdown ?? "")) add(c.sourceId);
  }
  return out;
}

export type ResolveUnsharedDeps = {
  /** 手元のノート・ナレッジを id で開く。開けなければ null（例外は投げてもよい。null と同じ扱い） */
  loadDoc: (id: string) => Promise<GraphiumDocument | null>;
  /** 共有エントリ id → その共有フォルダ（shared-library-store のスナップショット） */
  entryRoots: Record<string, string>;
  /**
   * 登録している共有フォルダ（root の一覧）。1 件だけのときは、一覧の読み直しを待たずに
   * 「sharedRef があれば共有先にある」と決める（ensureSharedEntryRoots は 1 件では読み直さず、
   * 共有した直後のエントリがスナップショットにまだ無いことがある）
   */
  roots?: readonly string[];
};

/** ids のうち、共有先（targetRoot）に無いものを返す */
export async function resolveUnsharedSourceIds(
  ids: readonly string[],
  targetRoot: string,
  deps: ResolveUnsharedDeps,
): Promise<Set<string>> {
  const unshared = new Set<string>();
  const checked = ids.slice(0, MAX_SOURCES_TO_CHECK);
  for (const id of ids.slice(MAX_SOURCES_TO_CHECK)) unshared.add(id);
  const onlyRoot = deps.roots?.length === 1 ? deps.roots[0] : null;
  const inTarget = (sharedId: string) => {
    const root = deps.entryRoots[sharedId];
    return root === targetRoot || (root === undefined && onlyRoot === targetRoot);
  };
  await Promise.all(
    checked.map(async (id) => {
      // 共有エントリの id を直接指している（他の人の共有など）。手元では開けないので、置き場所だけで決める
      if (deps.entryRoots[id] === targetRoot) return;
      let doc: GraphiumDocument | null = null;
      try {
        doc = await deps.loadDoc(id);
      } catch {
        doc = null;
      }
      const sharedId = doc?.sharedRef?.id;
      if (!sharedId || !inTarget(sharedId)) unshared.add(id);
    }),
  );
  return unshared;
}

type Translate = (key: string, vars?: Record<string, string>) => string;

/** 確認の本文（テストからも使う） */
export function unsharedSourcesWarningText(count: number, isKnowledge: boolean, t: Translate): string {
  return t(isKnowledge ? "share.unsharedSources.knowledge" : "share.unsharedSources.note", {
    count: String(count),
  });
}

/** 共有の前に聞いた答え。strip = 外して共有、keep = そのまま共有、cancel = 共有しない */
export type UnsharedSourcesDecision = "strip" | "keep" | "cancel";

/**
 * 共有先に無い資料があれば、外すか聞く。無ければ聞かずに "keep"（外すものが無い）。
 * 既定はアプリ内の 3 択（主のボタン =「外して共有」）
 */
export async function confirmUnsharedSources(
  unshared: ReadonlySet<string>,
  isKnowledge: boolean,
  t: Translate,
  ask: (message: string) => ChoiceAnswer | Promise<ChoiceAnswer> = (m) =>
    chooseAction(m, {
      confirmLabel: t("share.unsharedSources.strip"),
      secondaryLabel: t("share.unsharedSources.keep"),
    }),
): Promise<UnsharedSourcesDecision> {
  if (unshared.size === 0) return "keep";
  const answer = await ask(unsharedSourcesWarningText(unshared.size, isKnowledge, t));
  return answer === "confirm" ? "strip" : answer === "secondary" ? "keep" : "cancel";
}

export type DecideHiddenSourcesOptions = ResolveUnsharedDeps & {
  /** この文書自身の id（数えない） */
  selfIds: readonly string[];
  /** ナレッジ（トピック・回答など）か。確認の文が変わる */
  isKnowledge: boolean;
  t: Translate;
  /** テスト用（省くとアプリ内の 3 択） */
  ask?: (message: string) => ChoiceAnswer | Promise<ChoiceAnswer>;
};

/**
 * 共有の前の一連の判断。共有先に無い資料を数え、あれば聞く。
 * 戻り値: 外す id の集合（外さない・外すものが無いときは空）。共有をやめたときは null
 */
export async function decideHiddenSources(
  doc: GraphiumDocument,
  targetRoot: string,
  opts: DecideHiddenSourcesOptions,
): Promise<Set<string> | null> {
  const ids = collectReferencedSourceIds(doc, opts.selfIds);
  if (ids.length === 0) return new Set();
  const unshared = await resolveUnsharedSourceIds(ids, targetRoot, opts);
  const decision = await confirmUnsharedSources(unshared, opts.isKnowledge, opts.t, opts.ask);
  if (decision === "cancel") return null;
  return decision === "strip" ? unshared : new Set();
}
