// @ をトリガーの参照リンクオートコンプリート
// 知識層リンク（reference）を作成する

import type { GraphiumFile } from "../../lib/document-types";
import type { GraphiumIndex, NoteIndexEntry } from "../navigation/index-file";
import { bestHitsBySource, lexicalSearch, queryTerms } from "../lexical-search";
import type { MediaIndex } from "../asset-browser/media-index";
import { t } from "../../i18n";

// 参照候補の型
export type ReferenceSuggestion = {
  /** 候補の種類。"asset" は取り込んだドキュメント素材（PDF/docx）本体を指す */
  type: "heading" | "note" | "asset";
  /** ブロック ID（同ノート内見出し）/ ノートファイル ID / 素材 fileId */
  id: string;
  /** 表示名 */
  label: string;
  /** グループ名 */
  group: string;
  /**
   * 「新規ノートを作成」候補のとき、作成するノートのタイトル。
   * label は装飾文（例「『〇〇』を新規ノートに」）になるため、
   * 実際に作るノート名・本文に挿入する @テキストはこちらを使う。
   */
  createTitle?: string;
  /**
   * 補助表示（2 行目）。同名ノートが複数あるときだけ更新日時を入れて区別できるようにする。
   * shadcn の SuggestionMenu.Item が item.subtext をそのまま描画する。
   */
  subtext?: string;
  /**
   * type === "asset" のときの素材の種類（"pdf" / "document" / "data"）。
   * 選択時に外部ソース ID（pdf:/document:/data:）のプレフィックスを決めるために使う。
   */
  assetType?: string;
  /**
   * 表示名のほかに打って当たる語（BlockNote の SuggestionMenu が aliases として照合する）。
   * 素材の取り込み元フォルダを入れ、`@S2` のようにフォルダ名でも絞れるようにする。
   */
  aliases?: string[];
  /**
   * 候補を作る側で入力語による絞り込みを済ませている印。
   * editor.tsx はこれが付いた候補を再び絞らず素通しにする（題名以外の見出し・本文で
   * 当てた候補を、題名だけの照合で落とさないため）。
   */
  prefiltered?: true;
};

/** 入力を空白（全角含む）で語に分ける（小文字化済み） */
function mentionTerms(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/[\s\u3000]+/)
    .filter(Boolean);
}

/** 文字列 s に語 term が含まれるか（小文字化したうえで、NFC にそろえた比較も見る） */
function textHasTerm(s: string, term: string): boolean {
  const lower = s.toLowerCase();
  return lower.includes(term) || lower.normalize("NFC").includes(term.normalize("NFC"));
}

/** 照合用に小文字化 + NFC 正規化する（語側も同じ形にそろえて includes だけで比べる） */
function foldForMatch(s: string): string {
  return s.toLowerCase().normalize("NFC");
}

/** ノート 1 件ぶんの照合用文字列（事前正規化済み）。索引の入れ替えで entry が変わればキャッシュも外れる */
type FoldedEntry = {
  label: string;
  labelN: string;
  /** フォルダ名（noteContexts） */
  contextsN: string[];
  /** 見出し・step。理由表示に元の文字列が要るので両方持つ */
  headings: { text: string; n: string }[];
};
const foldedCache = new WeakMap<NoteIndexEntry, FoldedEntry>();
function foldedOf(n: NoteIndexEntry, label: string): FoldedEntry {
  const hit = foldedCache.get(n);
  // 題名や表示名が変わった（同じ entry を書き換えた）場合は作り直す
  if (hit && hit.label === label) return hit;
  const made: FoldedEntry = {
    label,
    labelN: foldForMatch(label),
    contextsN: (n.noteContexts ?? []).map(foldForMatch),
    headings: [...(n.headings ?? []).map((h) => h.text), ...(n.steps ?? []).map((st) => st.text)].map(
      (text) => ({ text, n: foldForMatch(text) }),
    ),
  };
  foldedCache.set(n, made);
  return made;
}

/**
 * 本文検索（語彙索引）の直近の結果を覚えておく。IME の変換中は editor.tsx が
 * 同じ query で getMentionSuggestions を続けて呼ぶので、2 回目以降は引き直さない。
 * キーは (クエリ, 種類, 索引の世代・文書数・状態)。索引が変わればキーも変わる。
 */
const BODY_CACHE_SIZE = 6;
const bodyCache: { key: string; value: MentionBodyHits }[] = [];
function cachedBodyHits(q: string, kind: "note" | "wiki"): MentionBodyHits {
  const st = lexicalSearch.getStatus();
  const key = `${kind}\u0000${st.generation}:${st.documents}:${st.state}\u0000${q}`;
  const hit = bodyCache.find((c) => c.key === key);
  if (hit) return hit.value;
  // @ は語の全部が本文に出るものだけを当てる（⌘K の OR とは違い、AND の絞り込みに合わせる）
  const value = bestHitsBySource(q, [kind], {
    limit: BODY_HIT_LIMIT * 5,
    minTermMatches: Math.max(1, queryTerms(q).length),
  });
  bodyCache.push({ key, value });
  if (bodyCache.length > BODY_CACHE_SIZE) bodyCache.shift();
  return value;
}

/**
 * @ メニューの候補を、入力文字で絞るための照合を作る（editor.tsx の絞り込みと共有）。
 *
 * 入力を空白で語に分け、全部の語が「題名・補助語のどこかに」含まれれば当たる
 * （AND・語順不問）。語が別々の補助語に分かれて当たってもよい。
 * 渡す前に新しい順の上位だけに切ると、古いノートや素材は名前を打っても出てこないので、
 * 入力があれば全件から先に絞ってから切る。BlockNote の照合より狭くならないよう、
 * 小文字の部分一致に、NFC にそろえた比較（macOS の NFD ファイル名向け）を足して見る。
 */
export function mentionQueryMatcher(
  query: string,
): (label: string, aliases?: readonly string[]) => boolean {
  const terms = mentionTerms(query);
  if (terms.length === 0) return () => true;
  return (label, aliases) => {
    const texts = [label, ...(aliases ?? [])];
    return terms.every((term) => texts.some((s) => textHasTerm(s, term)));
  };
}

/**
 * @ メニューの候補を絞るのに使う文字列を返す。
 *
 * IME の変換中は、まだ確定していない読み（「けんきゅう」やローマ字の「k」）まで
 * query に入ってくる。それで絞ると漢字のノート名にはどれも当たらず、候補が消える
 * （候補が 0 件になる note-link 列では BlockNote がメニューごと閉じる）。
 * そこで変換中は、変換を始める前に確定していた部分だけで絞る。
 * @param query `@` の後の文字列（変換中の文字を含む）
 * @param composing いま IME で変換中か
 * @param lastCommitted 変換していないときに最後に見た query
 */
export function mentionFilterQuery(
  query: string,
  composing: boolean,
  lastCommitted: string,
): string {
  if (!composing) return query;
  // 確定済みの部分を書き換えながら変換している等で前方一致しないときは、絞らずに全件を出す
  return query.startsWith(lastCommitted) ? lastCommitted : "";
}

/** modifiedAt(ISO) を YYYY-MM-DD HH:mm（ローカル日時）に整形する。不正値は空文字。 */
export function formatMentionDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

/**
 * 候補リスト中で「実タイトルが重複しているノート」だけに更新日時の subtext を付与する。
 * 一意なタイトルには付けない（メニューを無駄にうるさくしないため）。
 */
function attachDuplicateSubtext(
  items: { suggestion: ReferenceSuggestion; title: string; modifiedAt: string }[],
): void {
  const titleCount = new Map<string, number>();
  for (const it of items) {
    titleCount.set(it.title, (titleCount.get(it.title) ?? 0) + 1);
  }
  for (const it of items) {
    if ((titleCount.get(it.title) ?? 0) > 1) {
      const date = formatMentionDate(it.modifiedAt);
      if (date) it.suggestion.subtext = date;
    }
  }
}

/** 「新規ノートを作成」候補を識別するための sentinel ID */
export const CREATE_NEW_NOTE_ID = "__graphium_create_new_note__";

/**
 * ノートメンションを青い `@タイトル` テキストとして本文に挿入する。
 * ノート ID は呼び出し側が linkStore.addLink({sourceBlockId, targetNoteId}) で
 * 別途記録しており、クリック解決はその linkStore を参照して厳密な ID を得る
 * （同名ノートでも正しく解決するため。resolveMentionTargetFromLinks 参照）。
 * 末尾に半角スペースを足して続けて書けるようにする。
 */
export function insertNoteMentionInline(editor: any, _noteId: string, title: string): void {
  editor?.insertInlineContent?.([
    { type: "text", text: `@${title}`, styles: { textColor: "blue" } },
    { type: "text", text: " ", styles: {} },
  ]);
}

/**
 * クリックされたメンション（青文字 `@タイトル`）を、記録済みリンクから厳密な
 * ノート ID に解決する。タイトル逆引き（同名で曖昧）と違い、挿入時に linkStore へ
 * 記録した targetNoteId を使うので、同名ノートが複数あっても正しいノートを開ける。
 *
 * @param blockId クリックされたメンションが属するブロック ID（DOM の data-id）
 * @param mentionText 先頭の `@` を除いたメンション表示テキスト（＝タイトル）
 * @param links そのエディタの linkStore.getAllLinks()
 * @param noteIndex source（human/ai）判定とタイトル照合に使う
 */
export function resolveMentionTargetFromLinks(
  blockId: string | null | undefined,
  mentionText: string,
  links: ReadonlyArray<{ sourceBlockId: string; targetNoteId?: string; type?: string }>,
  noteIndex: GraphiumIndex | null | undefined,
  /**
   * 素材名 → その名前を持つ素材の外部ソース ID（"pdf:<fileId>" / "data:<fileId>" 等）すべて。
   * 素材メンションのラベルは noteIndex で照合できないため、これで照合する。
   * 装置の出力（data.txt 等）は同名の別ファイルが普通にあるので、1 件に決め打ちしない
   */
  resolveAssetIds?: (name: string) => readonly string[],
  options?: {
    /**
     * 表のセル内のメンションか。表は 1 ブロックに全セルのメンションのリンクが並ぶので、
     * 先頭候補は別のセルの行き先であることが多い（インデックステーブルの行ノートは
     * 紐づけを tableMeta 側に持ち、表ブロックのリンクに記録されないことがある）
     */
    inTableCell?: boolean;
  },
): { noteId: string; isWiki: boolean } | null {
  if (!blockId) return null;
  const candidates = links.filter(
    (l) => l.sourceBlockId === blockId && !!l.targetNoteId,
  );
  if (candidates.length === 0) return null;
  // 同一ブロックに複数メンションがある場合は、タイトル一致で対応リンクを選ぶ。
  for (const c of candidates) {
    const entry = noteIndex?.notes.find((n) => n.noteId === c.targetNoteId);
    if (entry && entry.title === mentionText) {
      return { noteId: c.targetNoteId as string, isWiki: entry.source === "ai" };
    }
  }
  // 素材メンション: ラベル（素材名）を持つ素材の外部ソース ID と候補を照合する。
  // 同名の素材が複数あっても、このブロックに記録したリンクの先が正解になる。
  // 一致が無ければ null — 素材名として解決できる mentionText を下の先頭候補
  // （同じブロックの別メンションのリンク）へ倒すと、クリックで無関係なノートが
  // 開いてしまう。null なら呼び出し側の素材名逆引きが拾う
  const assetIds = resolveAssetIds?.(mentionText) ?? [];
  if (assetIds.length > 0) {
    const c = candidates.find((l) => assetIds.includes(l.targetNoteId as string));
    return c ? { noteId: c.targetNoteId as string, isWiki: false } : null;
  }
  // 表のセルで、ラベルが別のノートのタイトルそのものなら、そのノートへのリンク記録が
  // 表ブロックに無いだけ。下の先頭候補へ倒すと別のセルの行き先（@素材 等）が開くので、
  // 呼び出し側のタイトル逆引きに委ねる。表の外（References の「Source: @ラベル」など
  // 1 ブロック 1 リンクの行）は、ラベルが同名ノートと重なっても従来どおり記録したリンクを採る
  if (options?.inTableCell && noteIndex?.notes.some((n) => n.title === mentionText)) return null;
  // タイトル一致が無い（作成後にタイトル変更された等）→ 先頭候補にフォールバック。
  const first = candidates[0];
  const entry = noteIndex?.notes.find((n) => n.noteId === first.targetNoteId);
  return { noteId: first.targetNoteId as string, isWiki: entry?.source === "ai" };
}

/**
 * 新規ノート作成候補を返す。常に 1 件返す（`@` 直後の空クエリでも出す）。
 *
 * - 空クエリ: `createTitle=""` の「新しいノートを作成…」。選ぶと名前入力ダイアログを開く。
 *   IME で名前を打つと変換確定でメニューが閉じてしまうため、`@` 直後にこれを選び、
 *   名前は通常の入力欄（ダイアログ）で打てるようにするのが日本語入力での確実な経路。
 * - 非空クエリで既存ノートにタイトル完全一致が無いとき: `createTitle=query` の
 *   「『〇〇』を新規ノートに」。英語などインラインで打ち切れた場合はダイアログ無しで即作成。
 * - 非空クエリで完全一致があるとき: null（既存を選ばせる。同名ノートの量産も防ぐ）。
 *
 * この候補は呼び出し側（editor.tsx）で絞り込みを通さずに常に付与する
 * （prefiltered な候補は素通し、それ以外は mentionQueryMatcher で絞る）。
 * そうしないと変換中に query へ紛れるスペース等でフィルタ脱落してしまう。
 * @param query `@` の後にユーザーが入力中の文字列
 * @param existing すでに集めた候補（重複判定に使う）
 */
export function getCreateNoteSuggestion(
  query: string,
  existing: ReferenceSuggestion[],
): ReferenceSuggestion | null {
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      type: "note",
      id: CREATE_NEW_NOTE_ID,
      label: t("mention.createNoteEllipsis"),
      group: t("mention.groupCreate"),
      createTitle: "",
    };
  }
  const normalized = trimmed.toLowerCase();
  const hasExact = existing.some(
    (s) => s.type === "note" && !s.createTitle && s.label.trim().toLowerCase() === normalized,
  );
  if (hasExact) return null;
  return {
    type: "note",
    id: CREATE_NEW_NOTE_ID,
    label: t("mention.createNamed", { title: trimmed }),
    group: t("mention.groupCreate"),
    createTitle: trimmed,
  };
}

/**
 * 同ノート内の見出しブロックを候補として収集する。
 * DOM から見出し要素を取得し、候補リストを構築する。
 * @param currentBlockId 現在のカーソルがあるブロック ID（自分自身を除外するため）
 */
export function getHeadingSuggestions(currentBlockId?: string): ReferenceSuggestion[] {
  const suggestions: ReferenceSuggestion[] = [];
  const headingEls = document.querySelectorAll('[data-node-type="blockOuter"]');

  headingEls.forEach((el) => {
    const blockId = el.getAttribute("data-id");
    if (!blockId || blockId === currentBlockId) return;

    // H1, H2, H3 を検出
    const h1 = el.querySelector("h1");
    const h2 = el.querySelector("h2");
    const h3 = el.querySelector("h3");
    const heading = h1 || h2 || h3;
    if (!heading) return;

    const text = heading.textContent?.trim() || "";
    if (!text) return;

    const level = h1 ? 1 : h2 ? 2 : 3;
    suggestions.push({
      type: "heading",
      id: blockId,
      label: `${"#".repeat(level)} ${text}`,
      group: t("mention.groupThisNote"),
    });
  });

  return suggestions;
}

/**
 * Wiki ドキュメントのメンションラベル（タイトル部を除く装飾込み）を組み立てる。
 * `@` メニューの候補ラベルと、挿入される青文字テキスト（@ の後ろ）はこの形式になる。
 * リネーム伝播（mention-rename.ts の buildMentionPatterns）が同じ形式で置換パターンを
 * 組むため、フォーマットはここで一元管理する。変更時は両方に効く。
 */
export function formatWikiMentionLabel(wikiKind: string | undefined, title: string): string {
  // 既存 kind（"Summary" / "Concept"）のラベルは変えない — 既存ノート内のメンション
  // 文字列と rename パターン（mention-rename.ts）を壊さないため。topic のみ新規追加。
  const kindPrefix = wikiKind === "summary" ? "Summary" : wikiKind === "topic" ? "Topic" : "Concept";
  return `🤖 ${kindPrefix}: ${title}`;
}

/** 理由表示用に抜粋を切り詰める（空白は 1 つに潰す） */
const REASON_MAX_CHARS = 40;
function clipReason(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  return chars.length > REASON_MAX_CHARS ? `${chars.slice(0, REASON_MAX_CHARS).join("")}…` : flat;
}

/** 本文ヒット（語彙索引）の上限と、本文照合を始める最小文字数 */
const BODY_HIT_LIMIT = 8;
const BODY_HIT_MIN_CHARS = 2;

/** 本文ヒットの注入用の型（noteId → 抜粋） */
export type MentionBodyHits = ReadonlyMap<string, { snippet: { text: string } }>;

export type NoteSuggestionOptions = {
  /**
   * 本文（語彙索引）でヒットしたノート。未指定なら bestHitsBySource で引く
   * （索引が未ロードなら空 = 本文照合は無効）。テストでは注入して使う。
   * note = 人のノート / wiki = AI ナレッジ。
   */
  bodyHits?: { note?: MentionBodyHits; wiki?: MentionBodyHits };
};

/**
 * 他ノートの候補を構築する。
 * インデックスがあればそこから取得（見出し付き）、なければ files から取得。
 *
 * 当たり方に段を付ける（並びは 段 → 更新が新しい順、上限は段の合計に対して）:
 *  - 段0: 題名で全語一致
 *  - 段1: 題名＋フォルダ名（noteContexts）＋見出し・step タイトルを合わせて全語一致
 *  - 段2: 本文（語彙索引）でヒット
 * @param files Google Drive のファイル一覧
 * @param currentFileId 現在開いているファイル ID（除外用）
 * @param noteIndex インデックスファイル（オプション）
 */
export function getNoteSuggestions(
  files: GraphiumFile[],
  currentFileId?: string,
  noteIndex?: GraphiumIndex | null,
  /** `@` の後に打っている文字。あれば全ノートから先に絞り、その中の新しい順に出す */
  query = "",
  options: NoteSuggestionOptions = {},
): ReferenceSuggestion[] {
  const matches = mentionQueryMatcher(query);
  const terms = mentionTerms(query);
  const hasQuery = terms.length > 0;
  // 同名ノートを区別するための subtext 付与に使う (suggestion, 実タイトル, modifiedAt) の組
  const entries: { suggestion: ReferenceSuggestion; title: string; modifiedAt: string }[] = [];

  // インデックスがあればノート + Wiki の候補を返す
  if (noteIndex) {
    const suggestions: ReferenceSuggestion[] = [];
    const bodyEnabled = query.trim().length >= BODY_HIT_MIN_CHARS;
    const bodyOf = (kind: "note" | "wiki"): MentionBodyHits =>
      !bodyEnabled ? new Map() : options.bodyHits?.[kind] ?? cachedBodyHits(query, kind);
    const foldedTerms = terms.map(foldForMatch);

    type Ranked = { entry: NoteIndexEntry; label: string; tier: 0 | 1 | 2; reason?: string };
    const rank = (
      source: "human" | "ai",
      labelOf: (n: NoteIndexEntry) => string,
      limit: number,
    ): Ranked[] => {
      const ranked: Ranked[] = [];
      // 段0/1 で拾い済みの noteId と、この種類のノートの引き当て（本文ヒットの数え直しに使う）
      const taken = new Set<string>();
      const sameSource = new Map<string, { entry: NoteIndexEntry; label: string }>();
      for (const n of noteIndex.notes) {
        if (n.noteId === currentFileId) continue;
        if ((n.source === "ai") !== (source === "ai")) continue;
        const label = labelOf(n);
        sameSource.set(n.noteId, { entry: n, label });
        if (!hasQuery) {
          ranked.push({ entry: n, label, tier: 0 });
          taken.add(n.noteId);
          continue;
        }
        const f = foldedOf(n, label);
        // 語の 1 つでも題名・フォルダ名・見出しのどこにも無ければ、そこで打ち切る
        if (foldedTerms.every((term) => f.labelN.includes(term))) {
          ranked.push({ entry: n, label, tier: 0 });
          taken.add(n.noteId);
          continue;
        }
        const inOthers = (term: string) =>
          f.labelN.includes(term) ||
          f.contextsN.some((c) => c.includes(term)) ||
          f.headings.some((h) => h.n.includes(term));
        if (foldedTerms.every(inOthers)) {
          // 題名に無い語を含む見出しがあれば、それを理由に出す（フォルダ名一致は理由不要）
          const missing = foldedTerms.filter((term) => !f.labelN.includes(term));
          const heading = f.headings.find((h) => missing.some((term) => h.n.includes(term)));
          ranked.push({
            entry: n,
            label,
            tier: 1,
            reason: heading ? t("mention.matchHeading", { text: clipReason(heading.text) }) : undefined,
          });
          taken.add(n.noteId);
        }
      }
      // 段2: 本文ヒット。現在のノートと段0/1 で拾い済みのものを除いてから上位 BODY_HIT_LIMIT 件を数える
      if (hasQuery) {
        const body = bodyOf(source === "ai" ? "wiki" : "note");
        let counted = 0;
        for (const [id, hit] of body) {
          if (counted >= BODY_HIT_LIMIT) break;
          const found = sameSource.get(id);
          if (!found || taken.has(id)) continue;
          counted++;
          const text = hit.snippet.text ?? "";
          ranked.push({
            entry: found.entry,
            label: found.label,
            tier: 2,
            reason: text ? t("mention.matchBody", { text: clipReason(text) }) : undefined,
          });
        }
      }
      return ranked
        .sort(
          (a, b) =>
            a.tier - b.tier ||
            new Date(b.entry.modifiedAt).getTime() - new Date(a.entry.modifiedAt).getTime(),
        )
        .slice(0, limit);
    };

    // 人間のノート → Wiki ドキュメント（🤖 アイコンで区別）。Wiki の照合は表示名
    // （「🤖 Concept: 題」）で見る — 種類名で打っても当たる
    const groups: { ranked: Ranked[]; group: string }[] = [
      { ranked: rank("human", (n) => n.title, 25), group: t("mention.groupOtherNotes") },
      {
        ranked: rank("ai", (n) => formatWikiMentionLabel(n.wikiKind, n.title), 10),
        group: t("mention.groupKnowledge"),
      },
    ];
    const reasons = new Map<ReferenceSuggestion, string>();
    for (const { ranked, group } of groups) {
      for (const r of ranked) {
        const s: ReferenceSuggestion = {
          type: "note",
          id: r.entry.noteId,
          label: r.label,
          group,
          prefiltered: true,
        };
        suggestions.push(s);
        entries.push({ suggestion: s, title: r.entry.title, modifiedAt: r.entry.modifiedAt });
        if (r.reason) reasons.set(s, r.reason);
      }
    }

    // 実タイトルが重複するものだけ更新日時を添えて区別できるようにする
    attachDuplicateSubtext(entries);
    // 題名以外で当たった理由は、区別用の日時があればその後ろに続ける
    for (const [s, reason] of reasons) {
      s.subtext = s.subtext ? `${s.subtext} · ${reason}` : reason;
    }
    return suggestions;
  }

  // フォールバック: files から取得
  const titleOf = (f: GraphiumFile) => f.name.replace(/\.(graphium|provnote)\.json$/, "");
  const suggestions: ReferenceSuggestion[] = files
    .filter((f) => f.id !== currentFileId && matches(titleOf(f)))
    .sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime())
    .slice(0, 20)
    .map((f) => {
      const title = titleOf(f);
      const s: ReferenceSuggestion = {
        type: "note",
        id: f.id,
        label: title,
        group: t("mention.groupOtherNotes"),
        prefiltered: true,
      };
      entries.push({ suggestion: s, title, modifiedAt: f.modifiedTime });
      return s;
    });
  attachDuplicateSubtext(entries);
  return suggestions;
}

/**
 * @ で引用できる素材の種類。候補に出すのも、クリックで @素材名 を素材として
 * 解決するのもこの種類だけ（動画・音声などは外部ソース ID の形を持たない）。
 */
export const MENTIONABLE_ASSET_TYPES: readonly string[] = ["pdf", "document", "data", "image"];

/**
 * 取り込んだドキュメント素材（PDF / docx / 区切りテキスト等）を @ 候補として収集する。
 * ノート由来ではなく「素材そのもの」を引用したい場合（論文 PDF の引用、測定データの
 * 参照等）に使う。選択すると本文に @素材名 を挿入し、doc.citedAssetFileIds に fileId を
 * 記録する（データ素材はテーブルのセル内から測定ファイルを指すのが主な用途）。
 */
export function getAssetSuggestions(
  mediaIndex?: MediaIndex | null,
  /** `@` の後に打っている文字。あれば全素材から先に絞り（名前・取り込み元フォルダ）、その中の新しい順に出す */
  query = "",
): ReferenceSuggestion[] {
  if (!mediaIndex) return [];
  const matches = mentionQueryMatcher(query);
  const assets = mediaIndex.media
    .filter((m) => MENTIONABLE_ASSET_TYPES.includes(m.type) && matches(m.name, m.noteContexts))
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
    .slice(0, 15);
  // 同名の素材が並ぶときだけ、2 行目に出どころを添える（ノートの同名と同じ扱い）。
  // 装置の出力は同じ名前が普通にある（試料ごとの XRD.txt）。フォルダごと取り込んだ
  // 素材は取り込み元のフォルダを持つのでそれを、無ければ登録日時を出す — まとめて
  // 取り込むと登録日時はほぼ同じになり、区別の手がかりにならない
  const nameCount = new Map<string, number>();
  for (const m of assets) {
    const key = m.name.normalize("NFC");
    nameCount.set(key, (nameCount.get(key) ?? 0) + 1);
  }
  return assets.map((m) => {
    const duplicated = (nameCount.get(m.name.normalize("NFC")) ?? 0) > 1;
    const origin = m.noteContexts?.length ? m.noteContexts.join(", ") : formatMentionDate(m.uploadedAt);
    return {
      type: "asset" as const,
      id: m.fileId,
      // 絵文字はピッカーのサムネイルと同じ使い分け（データ素材は 🧾）。
      // 画像（🖼）は選ぶとリンク文字ではなくインライン画像として埋まる。
      // 名前は NFC にそろえる — BlockNote はそのまま比べるので、macOS の NFD の
      // ファイル名は打った文字（NFC）と一致せず候補から落ちていた
      label: `${m.type === "data" ? "🧾" : m.type === "image" ? "🖼" : "📄"} ${m.name.normalize("NFC")}`,
      group: t("mention.groupAssets"),
      assetType: m.type,
      prefiltered: true as const,
      ...(duplicated && origin ? { subtext: origin } : {}),
      ...(m.noteContexts?.length ? { aliases: [...m.noteContexts] } : {}),
    };
  });
}
