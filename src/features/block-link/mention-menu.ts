// @ をトリガーの参照リンクオートコンプリート
// 知識層リンク（reference）を作成する

import type { GraphiumFile } from "../../lib/document-types";
import type { GraphiumIndex } from "../navigation/index-file";
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
};

/**
 * @ メニューの候補を、入力文字で先に絞るための照合を作る。
 *
 * BlockNote は候補の表示名（と aliases）に入力が含まれるかで絞る（filterSuggestionItems）が、
 * それは渡した候補の中での話 — 渡す前に新しい順の上位だけに切ると、古いノートや素材は
 * 名前を打っても出てこない（「新規ノートに」だけが出て、同名ノートを作る余地まであった）。
 * そこで入力があれば全件から先に絞ってから切る。BlockNote の照合より狭くならないよう、
 * 小文字の部分一致に、NFC にそろえた比較（macOS の NFD ファイル名向け）を足して見る。
 */
function mentionQueryMatcher(
  query: string,
): (label: string, aliases?: readonly string[]) => boolean {
  const q = query.trim().toLowerCase();
  if (!q) return () => true;
  const qn = q.normalize("NFC");
  const hit = (s: string) => {
    const lower = s.toLowerCase();
    return lower.includes(q) || lower.normalize("NFC").includes(qn);
  };
  return (label, aliases) => hit(label) || (aliases ?? []).some(hit);
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
 * この候補は呼び出し側（editor.tsx）で `_filterSuggestionItems` を通さずに常に付与する。
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

/**
 * 他ノートの候補を構築する。
 * インデックスがあればそこから取得（見出し付き）、なければ files から取得。
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
): ReferenceSuggestion[] {
  const matches = mentionQueryMatcher(query);
  // 同名ノートを区別するための subtext 付与に使う (suggestion, 実タイトル, modifiedAt) の組
  const entries: { suggestion: ReferenceSuggestion; title: string; modifiedAt: string }[] = [];

  // インデックスがあればノート + Wiki の候補を返す
  if (noteIndex) {
    const suggestions: ReferenceSuggestion[] = [];

    // 人間のノート
    const notes = noteIndex.notes
      .filter((n) => n.noteId !== currentFileId && n.source !== "ai" && matches(n.title))
      .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())
      .slice(0, 25);

    for (const note of notes) {
      const s: ReferenceSuggestion = {
        type: "note",
        id: note.noteId,
        label: note.title,
        group: t("mention.groupOtherNotes"),
      };
      suggestions.push(s);
      entries.push({ suggestion: s, title: note.title, modifiedAt: note.modifiedAt });
    }

    // Wiki ドキュメント（🤖 アイコンで区別）。照合は表示名（「🤖 Concept: 題」）で見る —
    // BlockNote が絞るのも表示名なので、種類名で打っても当たる
    const wikis = noteIndex.notes
      .filter((n) => n.source === "ai" && matches(formatWikiMentionLabel(n.wikiKind, n.title)))
      .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())
      .slice(0, 10);

    for (const wiki of wikis) {
      const s: ReferenceSuggestion = {
        type: "note",
        id: wiki.noteId,
        label: formatWikiMentionLabel(wiki.wikiKind, wiki.title),
        group: t("mention.groupKnowledge"),
      };
      suggestions.push(s);
      entries.push({ suggestion: s, title: wiki.title, modifiedAt: wiki.modifiedAt });
    }

    // 実タイトルが重複するものだけ更新日時を添えて区別できるようにする
    attachDuplicateSubtext(entries);
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
      ...(duplicated && origin ? { subtext: origin } : {}),
      ...(m.noteContexts?.length ? { aliases: [...m.noteContexts] } : {}),
    };
  });
}
