// 判断の理由を書き込む純関数と薄い I/O（判断・規則・観察の frame, PR 2）。
//
// 人が書いた理由は LLM を通さず、そのまま
//   (1) 追記先ノートの末尾の段落
//   (2) 知見の decisionFrame.rationale
// に入れる。人の文なので「原文の引用」の不変条件は構成上満たす。
// 規則の出典: docs/internal/judgment-rule-frames-design-2026-10.md §4

import type { GraphiumDocument } from "../../lib/document-types";
import type { StorageProvider } from "../../lib/storage/types";
import { takeSnapshot } from "../version-snapshots/snapshot-store";
import { t } from "../../i18n";

/**
 * prefix 無しの通常ノート id だけ true。
 * `pdf:` / `document:` / `url:` / `chat:` / `memo:` などの外部由来は false。
 * 未知の prefix（`:` を含む）も、通常ノートとして追記してよいか分からないので false にする。
 */
export function isRegularNoteId(id: string): boolean {
  if (!id) return false;
  const colon = id.indexOf(":");
  if (colon <= 0) return true;
  // prefix 付きは外部由来（pdf / document / url / chat / memo）や wiki / skill。
  // 未知の prefix も、追記先を誤るより出さない方が安全なので通常ノートとは見なさない。
  return false;
}

export type RationaleTarget = {
  wikiId: string;
  title: string;
  /** decisionFrame.action（原文の引用） */
  action: string;
  /** 追記先の通常ノート id */
  targetNoteId: string;
};

type WikiLike = {
  id: string;
  title: string;
  wikiMeta?: GraphiumDocument["wikiMeta"] | null;
};

/**
 * 理由が null の判断知見のうち、通常ノート出典を持つものを抜き出す。
 * 追記先は originNoteId が通常ノートで derivedFromNotes に含まれればそれ、
 * 無ければ derivedFromNotes の最初の通常ノート。
 */
export function pickRationaleTargets(wikis: WikiLike[], originNoteId?: string): RationaleTarget[] {
  const out: RationaleTarget[] = [];
  for (const w of wikis) {
    const frame = w.wikiMeta?.decisionFrame;
    if (!frame || frame.rationale !== null) continue;
    const regular = (w.wikiMeta?.derivedFromNotes ?? []).filter(isRegularNoteId);
    if (regular.length === 0) continue;
    const targetNoteId =
      originNoteId && isRegularNoteId(originNoteId) && regular.includes(originNoteId)
        ? originNoteId
        : regular[0];
    out.push({ wikiId: w.id, title: w.title, action: frame.action, targetNoteId });
  }
  return out;
}

/** 追記する段落の本文: 「判断の理由（<知見タイトル>）: <入力>」 */
export function buildRationaleParagraphText(title: string, rationale: string): string {
  return `${t("decisionPrompt.noteAppendLabel", { title })}: ${rationale}`;
}

/** BlockNote の段落ブロック（ノート doc の blocks 末尾へ足す用） */
export function buildParagraphBlock(text: string): any {
  return {
    id: crypto.randomUUID(),
    type: "paragraph",
    props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
    content: [{ type: "text", text, styles: {} }],
    children: [],
  };
}

/** doc の最初のページ末尾に段落を足した新しい doc を返す（元は変更しない） */
export function appendParagraphToDoc(doc: GraphiumDocument, text: string): GraphiumDocument {
  const pages = doc.pages.length > 0 ? doc.pages : [];
  if (pages.length === 0) throw new Error("no page to append");
  const [first, ...rest] = pages;
  return {
    ...doc,
    pages: [{ ...first, blocks: [...first.blocks, buildParagraphBlock(text)] }, ...rest],
    modifiedAt: new Date().toISOString(),
  };
}

export type RationaleWriteDeps = {
  provider: StorageProvider;
  getCachedDoc: (noteId: string) => GraphiumDocument | undefined;
  loadDoc: (noteId: string) => Promise<GraphiumDocument | null>;
  handleSaveWikiFile: (wikiId: string, doc: GraphiumDocument) => Promise<boolean>;
};

const SAVE_RETRIES = 3;
const SAVE_RETRY_WAIT_MS = 300;

/**
 * 知見側に理由を入れる: 版を取る（frame_backfill）→ decisionFrame.rationale = 入力そのもの
 * （rationaleBy: "human" を付ける。reviewState は変えない — 人が確認したのは理由だけで、
 * 他の欄まで確認したことにしない。再生成では mergeFrame 規則 a が human の理由を守る）
 * → activityType なしで保存。保存中で false が返ったら 300ms 待って最大 3 回。失敗は例外。
 */
export async function writeRationaleToWiki(
  deps: RationaleWriteDeps,
  wikiId: string,
  rationale: string,
): Promise<void> {
  const key = `wiki:${wikiId}`;
  const doc = deps.getCachedDoc(key) ?? (await deps.loadDoc(key));
  if (!doc?.wikiMeta?.decisionFrame) throw new Error(`decisionFrame not found: ${wikiId}`);
  await takeSnapshot(deps.provider, wikiId, doc, t("version.frameBackfillLabel"), "frame_backfill", true);
  const next: GraphiumDocument = {
    ...doc,
    wikiMeta: {
      ...doc.wikiMeta,
      decisionFrame: {
        ...doc.wikiMeta.decisionFrame,
        rationale,
        rationaleBy: "human" as const,
      },
    },
  };
  await saveWikiWithRetry(deps.handleSaveWikiFile, wikiId, next);
}

/** 保存中ロックで false が返っても黙って捨てない: 300ms 待って最大 3 回。駄目なら例外 */
export async function saveWikiWithRetry(
  save: (wikiId: string, doc: GraphiumDocument) => Promise<boolean>,
  wikiId: string,
  doc: GraphiumDocument,
): Promise<void> {
  for (let i = 0; i < SAVE_RETRIES; i++) {
    if (await save(wikiId, doc)) return;
    if (i < SAVE_RETRIES - 1) await new Promise((r) => setTimeout(r, SAVE_RETRY_WAIT_MS));
  }
  throw new Error(`failed to save wiki: ${wikiId}`);
}

/** ノート追記済みの記録キー。入力文も含める（直した文の再送信で段落が食い違わないように） */
export function rationaleAppendKey(wikiId: string, targetNoteId: string, rationale: string): string {
  return `${wikiId}\u0000${targetNoteId}\u0000${rationale}`;
}

/** 現在の doc で再判定し、まだ理由が null の対象だけ残す（トーストの古いスナップショット対策） */
export function pickPendingTargets(wikis: WikiLike[], originNoteId?: string): RationaleTarget[] {
  return pickRationaleTargets(wikis, originNoteId);
}

export type SubmitRationaleDeps = {
  /** 追記先ノートが今開いている文書か */
  isActiveNote: (noteId: string) => boolean;
  /** 生きているエディタの末尾へ段落を挿入する。挿入できなければ false（保存経路へ落とす） */
  insertParagraphViaEditor: (text: string) => boolean;
  loadNoteDoc: (noteId: string) => Promise<GraphiumDocument | null>;
  /** 段落を足した doc を保存する。base は追記前の doc（来歴の記録用） */
  saveNoteDoc: (noteId: string, doc: GraphiumDocument, base: GraphiumDocument) => Promise<void>;
  writeWiki: (wikiId: string, rationale: string) => Promise<void>;
  /** ノート追記済みキーの集合（知見側だけ失敗した再送信で段落を二重に入れない） */
  appended: Set<string>;
};

// 同一ノートへの送信を直列に流すチェーン（noteId ごと）。追記が上書きし合わないように。
const noteChains = new Map<string, Promise<unknown>>();

function runSerialPerNote<T>(noteId: string, task: () => Promise<T>): Promise<T> {
  const prev = noteChains.get(noteId) ?? Promise.resolve();
  const run = prev.then(task);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  noteChains.set(noteId, tail);
  // 後続が無ければチェーンを掃除する
  void tail.then(() => {
    if (noteChains.get(noteId) === tail) noteChains.delete(noteId);
  });
  return run;
}

/**
 * 理由の送信: (a) 追記先ノートの末尾に段落を足す（同じキーは 1 回だけ）→ (b) 知見へ書く。
 * 知見側が失敗しても appended は残す（再送信で段落が二重にならない）。成功したらキーを消す。
 * 同一ノートへの呼び出しは直列化する。失敗は例外。
 */
export function submitRationale(
  deps: SubmitRationaleDeps,
  target: RationaleTarget,
  rationale: string,
): Promise<void> {
  return runSerialPerNote(target.targetNoteId, async () => {
    const key = rationaleAppendKey(target.wikiId, target.targetNoteId, rationale);
    if (!deps.appended.has(key)) {
      const text = buildRationaleParagraphText(target.title, rationale);
      const inserted = deps.isActiveNote(target.targetNoteId) && deps.insertParagraphViaEditor(text);
      if (!inserted) {
        const base = await deps.loadNoteDoc(target.targetNoteId);
        if (!base) throw new Error(`target note not loaded: ${target.targetNoteId}`);
        await deps.saveNoteDoc(target.targetNoteId, appendParagraphToDoc(base, text), base);
      }
      deps.appended.add(key);
    }
    await deps.writeWiki(target.wikiId, rationale);
    deps.appended.delete(key);
  });
}
