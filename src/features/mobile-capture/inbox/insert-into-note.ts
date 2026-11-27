// 受信箱から取り込んだものを、開いているノートの本文に入れる処理。
//
// 右パネルの受信箱（MobileInboxPanel）から呼ばれる。取り込み自体（Inbox → 素材・メモ）は
// 呼び出し側が済ませ、ここは「どこに・どのブロックとして入れるか」だけを持つ。
// エディタは BlockNote の実体を any で受ける（insert-memo-quote と同じ流儀。テストは偽物で足りる）。

import type { MediaIndexEntry } from "../../asset-browser/media-index";
import { materialBlockFor } from "../../material-offer/note-block";
import { insertMemoQuote, registerMemoQuote } from "../../memo-quote/insert-memo-quote";
import type { MemoQuoteStore } from "../../memo-quote/store";
import type { InboxSource } from "./InboxView";
import type { CaptureRef } from "./types";

/** 取り込みが済んで、ノートに入れられる形になった 1 件。 */
export type InboxInsertable =
  | {
      kind: "material";
      /** Inbox 上のファイル名（待ち表示の解除に使う）。 */
      name: string;
      entry: Pick<MediaIndexEntry, "type" | "url" | "name">;
    }
  | { kind: "memo"; name: string; captureId: string; text: string; createdAt?: string }
  | { kind: "url"; name: string; url: string; title: string; description: string; domain: string };

/** 取り込みのときに控えておく、メモ・URL の中身（着地先の ID から引く）。 */
export type InboxCapturedPayload =
  | { kind: "memo"; text: string; createdAt?: string }
  | { kind: "url"; url: string; title: string; description: string; domain: string };

/**
 * ノートのエディタに渡す、受信箱とのつなぎ。デスクトップで同期フォルダを接続している
 * ときだけ実体がある（それ以外では右パネルにタブを出さない）。
 */
export type MobileInboxBinding = {
  source: InboxSource;
  /** 未取り込みのアイテム（見張りが自動で更新する）。 */
  items: CaptureRef[];
  loading: boolean;
  refresh: () => void;
  /**
   * refs を取り込み（Inbox → 素材・メモ）、ノートに入れられる形で返す。渡した順を保つ。
   * 取り込めなかったものは返らない（Inbox に残り、知らせは呼び出し側が出す）。
   */
  importRefs: (refs: CaptureRef[]) => Promise<InboxInsertable[]>;
  /**
   * refs を取り込まずに Inbox から消す（同期フォルダのファイルを消す）。消せなかったものが
   * あれば throw する（消せたものは消えたまま）。終わったら一覧を数え直す。
   */
  discardRefs: (refs: CaptureRef[]) => Promise<void>;
};

/** 入れる場所。blockId のブロックの前か後ろ。 */
export type InboxInsertTarget = { blockId: string; placement: "before" | "after" };

function isEmptyParagraph(block: any): boolean {
  return (
    block?.type === "paragraph" &&
    (!Array.isArray(block.content) || block.content.length === 0) &&
    (!Array.isArray(block.children) || block.children.length === 0)
  );
}

/**
 * 入れる場所を、押した時点のエディタから決める（取り込みを待つ間にカーソルが動いても、
 * 押したときの場所に入れるため、取り込みの前に呼ぶ）。
 * - カーソルのあるブロックの後ろ
 * - そのブロックが空の段落なら手前（空行を下に残して、続きを書けるようにする）
 * - カーソルが引けなければ文書の末尾（末尾が空の段落ならその手前）
 */
export function cursorInsertTarget(editor: any): InboxInsertTarget | null {
  if (!editor) return null;
  let block: any = null;
  try {
    block = editor.getTextCursorPosition?.()?.block ?? null;
  } catch {
    // フォーカスが無い・選択が取れないときは末尾に倒す
  }
  if (!block) {
    const doc: any[] = editor.document ?? [];
    block = doc[doc.length - 1] ?? null;
  }
  if (!block?.id) return null;
  return { blockId: block.id, placement: isEmptyParagraph(block) ? "before" : "after" };
}

/**
 * 落とした座標から、入れる場所を決める。座標の下のブロックの上半分なら手前、下半分なら後ろ。
 * ブロックの外（余白）に落ちたら、縦位置がいちばん近いブロックで同じ判定をする。
 */
export function dropInsertTarget(
  root: ParentNode | null | undefined,
  clientX: number,
  clientY: number,
  doc: Pick<Document, "elementFromPoint"> = document,
): InboxInsertTarget | null {
  if (!root) return null;
  const selector = '[data-node-type="blockContainer"][data-id]';
  const hit = doc.elementFromPoint(clientX, clientY)?.closest?.(selector) as HTMLElement | null;
  let el: HTMLElement | null = hit && (root as Node).contains(hit) ? hit : null;
  if (!el) {
    let best = Infinity;
    for (const cand of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
      const box = cand.getBoundingClientRect();
      const dist = clientY < box.top ? box.top - clientY : clientY > box.bottom ? clientY - box.bottom : 0;
      // 入れ子では内側（後から出てくる方）を優先する
      if (dist <= best) {
        best = dist;
        el = cand;
      }
    }
  }
  const blockId = el?.getAttribute("data-id");
  if (!el || !blockId) return null;
  const box = el.getBoundingClientRect();
  return { blockId, placement: clientY < box.top + box.height / 2 ? "before" : "after" };
}

/** ドラッグで運ばれた Inbox のファイル名を読む。形が違えば空（外から来た値なので信用しない）。 */
export function readInboxDragNames(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is string => typeof n === "string" && n.length > 0);
  } catch {
    return [];
  }
}

export type InboxInsertResult = {
  /** 入れたブロックの id（入れた順）。 */
  blockIds: string[];
  /** 引用ブロックとして入れたメモの id。呼び出し側が usedIn を記録する。 */
  memoIds: string[];
};

/**
 * items を target の位置に、渡された順で縦に並べて入れる。
 * 素材は素材のブロック（画像・動画・音声・PDF・ファイル）、メモは引用ブロック（元のメモと紐づく）、
 * URL はブックマークのカード。
 * target のブロックが消えていたら文書の末尾に入れる。
 */
export function insertInboxItems(
  editor: any,
  items: readonly InboxInsertable[],
  target: InboxInsertTarget | null,
  memoStore: Pick<MemoQuoteStore, "setQuote">,
): InboxInsertResult {
  const result: InboxInsertResult = { blockIds: [], memoIds: [] };
  if (!editor || items.length === 0) return result;

  const doc: any[] = editor.document ?? [];
  let anchor: any = target ? editor.getBlock?.(target.blockId) : null;
  let placement: "before" | "after" = target?.placement ?? "after";
  if (!anchor) {
    anchor = doc[doc.length - 1];
    placement = isEmptyParagraph(anchor) && doc.length > 1 ? "before" : "after";
  }
  if (!anchor) return result;

  // 「手前」は、仮の空段落を手前に置いてその後ろへ順に入れ、最後に仮の段落を外す。
  // メモの引用（insertMemoQuote）が「後ろに入れる」しか持たないので、入れ方を 1 つに揃える
  let scaffold: any = null;
  if (placement === "before") {
    scaffold = editor.insertBlocks([{ type: "paragraph" }], anchor, "before")?.[0] ?? null;
    if (!scaffold) return result;
    anchor = scaffold;
  }

  for (const item of items) {
    let newId: string | null = null;
    if (item.kind === "memo") {
      const entry = {
        id: item.captureId,
        text: item.text,
        createdAt: item.createdAt ?? new Date().toISOString(),
      };
      newId = insertMemoQuote(editor, entry, { after: anchor.id });
      if (newId) {
        registerMemoQuote(memoStore, newId, entry);
        result.memoIds.push(item.captureId);
      }
    } else if (item.kind === "url") {
      // URL はブックマークのカード（/url のピッカーと同じ形）。og:image の配信元 URL は
      // ブロックに持たせない（描画のたびに外へ GET が飛ぶ。画像はローカルのキャッシュから引く）
      const block = {
        type: "bookmark",
        props: { url: item.url, title: item.title, description: item.description, ogImage: "", domain: item.domain },
      };
      newId = editor.insertBlocks([block], anchor, "after")?.[0]?.id ?? null;
    } else {
      newId = editor.insertBlocks([materialBlockFor(item.entry)], anchor, "after")?.[0]?.id ?? null;
    }
    if (!newId) continue;
    result.blockIds.push(newId);
    anchor = editor.getBlock?.(newId) ?? { id: newId };
  }

  if (scaffold) {
    const current = editor.getBlock?.(scaffold.id);
    if (current) editor.removeBlocks([current]);
  }
  return result;
}
