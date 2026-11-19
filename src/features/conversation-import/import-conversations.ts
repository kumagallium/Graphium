// AI との会話を素材として取り込む。
//
// 会話 1 本を素材 1 件にする。本文（本人の発言の原文と AI の返答の抜粋）は
// saveMediaText に置き、素材の一覧（media-index）には来歴と数字だけを持つ。
// 素材 id は provider と sessionId から決まるので、同じ会話を取り込み直しても
// 二重にならず、本文と数字が差し替わる（会話は伸びる）。
//
// ここでは AI を呼ばない。ナレッジ化は、利用者が申し出を受けたときに別の経路で走る。
// 読むのは渡された共通の形だけで、会話の記録のファイルには触らない。

import {
  createEmptyIndex,
  MEDIA_INDEX_CHANGED_EVENT,
  readMediaIndex,
  saveMediaIndex,
  type ConversationMeta,
  type MediaIndex,
  type MediaIndexEntry,
} from "../asset-browser/media-index";
import { getActiveProvider } from "../../lib/storage/registry";
import {
  conversationFallbackTitle,
  conversationFolder,
  conversationTitle,
  renderConversationBody,
  summarizeConversation,
  type ConversationBodyLang,
} from "../../lib/conversation/render";
import {
  conversationFileId,
  conversationSourceId,
  type ConversationMaterial,
} from "../../lib/conversation/types";

export type ImportConversationsOptions = {
  /** 素材を入れるフォルダの親の名前（画面の言語で決める。日本語なら「AI 会話」） */
  folderRoot: string;
  /** 本文の見出しの言語（既定は ja） */
  lang?: ConversationBodyLang;
  /** 日付と時刻のずれ（分）。省くと端末の時刻帯 */
  utcOffsetMinutes?: number;
};

/** 保存先と時計。テストでは差し替える */
export type ImportConversationsDeps = {
  saveMediaText: (fileId: string, text: string) => Promise<void>;
  /**
   * 保存済みの本文を読む（無ければ undefined）。渡すと、前回から変わっていない会話でも
   * 本文が失われていれば書き直す（一覧だけが同期されて本文の無い端末など）
   */
  loadMediaText?: (fileId: string) => Promise<string | undefined>;
  /**
   * 本文を消す。渡すと、一覧の保存に失敗したときに、今回新しく作った会話の本文を戻す
   * （一覧に無い本文がディスクに残ると、画面から消せない）
   */
  deleteMediaText?: (fileId: string) => Promise<void>;
  readIndex: () => Promise<MediaIndex | null>;
  saveIndex: (index: MediaIndex) => Promise<void>;
  now?: () => Date;
};

export type ImportSkipReason =
  /** sessionId が素材 id に使えない形 */
  | "invalid-id"
  /** 本人の発言も依頼文も無い（残すものが無い） */
  | "empty"
  /** 同じ id の、会話でない素材が既にある */
  | "id-conflict"
  /** 本文を保存できなかった */
  | "save-failed";

export type ImportConversationsResult = {
  /** 新しく作った素材の id */
  created: string[];
  /** 本文と数字を差し替えた素材の id */
  updated: string[];
  /** 前回の取り込みから変わっていなかった素材の id */
  unchanged: string[];
  skipped: { sessionId: string; reason: ImportSkipReason }[];
};

/** 会話の来歴（素材の一覧に持つ数字）を組む */
export function buildConversationMeta(
  material: ConversationMaterial,
  bodyChars: number,
  importedAt: string,
): ConversationMeta {
  const summary = summarizeConversation(material);
  return {
    provider: material.provider,
    sessionId: material.sessionId,
    workdir: material.workdir,
    startedAt: material.startedAt,
    endedAt: material.endedAt,
    ownTurns: summary.ownTurns,
    ownChars: summary.ownChars,
    ...(summary.hasBrief ? { hasBrief: true } : {}),
    bodyChars,
    importedAt,
  };
}

/** 前回の取り込みと中身が同じか（importedAt を除いて比べる） */
function sameConversation(a: ConversationMeta | undefined, b: ConversationMeta): boolean {
  if (!a) return false;
  return (
    a.provider === b.provider &&
    a.sessionId === b.sessionId &&
    a.workdir === b.workdir &&
    a.startedAt === b.startedAt &&
    a.endedAt === b.endedAt &&
    a.ownTurns === b.ownTurns &&
    a.ownChars === b.ownChars &&
    !!a.hasBrief === !!b.hasBrief &&
    a.bodyChars === b.bodyChars
  );
}

/** 新しく取り込む会話の、素材の一覧のエントリ */
export function buildConversationEntry(
  fileId: string,
  material: ConversationMaterial,
  meta: ConversationMeta,
  options: ImportConversationsOptions,
): MediaIndexEntry {
  // url は「この素材を指す値」として出典 id と同じ形にする。空にすると、url で素材を引く
  // 走査（索引の再構築）が、url の空いたブロックをこの素材の利用と取り違える
  const ref = conversationSourceId(fileId);
  const name = conversationTitle(material, options);
  return {
    fileId,
    name,
    type: "conversation",
    mimeType: "text/plain",
    url: ref,
    thumbnailUrl: "",
    uploadedAt: meta.importedAt,
    usedIn: [],
    noteContexts: [conversationFolder(options.folderRoot, material.workdir)],
    conversation: { ...meta, autoName: name },
  };
}

type Pending = { fileId: string; material: ConversationMaterial; meta: ConversationMeta };

/**
 * 素材の一覧に、取り込んだ会話を反映する（純関数）。
 * 既にある会話は、フォルダ・登録日時・利用ノート・アーカイブの状態を残し、来歴だけ差し替える
 * （人が付け直したフォルダを、取り込み直しで元に戻さない）。
 *
 * 題は、取り込みが付けた題のままなら新しい題に差し替え、利用者が付け直していれば触らない。
 * 題だけが変わった会話は retitled に入れる（本文は同じなので、報告では「変わっていない」に数える）。
 */
export function upsertConversationEntries(
  index: MediaIndex,
  items: readonly Pending[],
  options: ImportConversationsOptions,
  updatedAt: string,
): { index: MediaIndex; created: string[]; updated: string[]; unchanged: string[]; retitled: string[]; conflicts: string[] } {
  const retitled: string[] = [];
  const created: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];
  const conflicts: string[] = [];
  const byId = new Map(index.media.map((m, i) => [m.fileId, i]));
  const media = [...index.media];
  for (const item of items) {
    const at = byId.get(item.fileId);
    if (at === undefined) {
      byId.set(item.fileId, media.length);
      media.push(buildConversationEntry(item.fileId, item.material, item.meta, options));
      created.push(item.fileId);
      continue;
    }
    const existing = media[at];
    if (existing.type !== "conversation") {
      conflicts.push(item.fileId);
      continue;
    }
    const title = conversationTitle(item.material, options);
    // v0.147 までの素材は autoName を持たないので、当時の付け方（最初の発言）と比べる
    const lastAuto = existing.conversation?.autoName ?? conversationFallbackTitle(item.material, options);
    const name = existing.name === lastAuto ? title : existing.name;
    if (sameConversation(existing.conversation, item.meta)) {
      unchanged.push(item.fileId);
      const autoName = existing.conversation?.autoName;
      if (existing.conversation && (name !== existing.name || (autoName !== undefined && autoName !== title))) {
        media[at] = { ...existing, name, conversation: { ...existing.conversation, autoName: title } };
        retitled.push(item.fileId);
      }
      continue;
    }
    media[at] = { ...existing, name, conversation: { ...item.meta, autoName: title } };
    updated.push(item.fileId);
  }
  if (created.length === 0 && updated.length === 0 && retitled.length === 0) {
    return { index, created, updated, unchanged, retitled, conflicts };
  }
  return { index: { ...index, updatedAt, media }, created, updated, unchanged, retitled, conflicts };
}

/** いまの保存先を使う既定の依存 */
export function defaultImportConversationsDeps(): ImportConversationsDeps {
  return {
    saveMediaText: async (fileId, text) => {
      const provider = getActiveProvider();
      if (!provider.saveMediaText) throw new Error("この保存先は素材の本文を保存できません");
      await provider.saveMediaText(fileId, text);
    },
    loadMediaText: async (fileId) => getActiveProvider().loadMediaText?.(fileId),
    deleteMediaText: async (fileId) => getActiveProvider().deleteMediaText?.(fileId),
    readIndex: readMediaIndex,
    saveIndex: saveMediaIndex,
  };
}

/**
 * 会話をまとめて取り込む。
 *
 * 先に本文を保存し、最後に素材の一覧を 1 回だけ書く。本文の保存に失敗した会話は
 * 一覧に載せない（本文の無い素材を作らない）。一覧は書く直前に読み直すので、
 * 取り込みの最中に増えたほかの素材を消さない。
 */
export async function importConversations(
  materials: readonly ConversationMaterial[],
  options: ImportConversationsOptions,
  deps: ImportConversationsDeps = defaultImportConversationsDeps(),
): Promise<ImportConversationsResult> {
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const skipped: ImportConversationsResult["skipped"] = [];
  const before = (await deps.readIndex()) ?? createEmptyIndex();
  const known = new Map(before.media.map((m) => [m.fileId, m]));

  const pending: Pending[] = [];
  const seen = new Set<string>();
  for (const material of materials) {
    const fileId = conversationFileId(material.provider, material.sessionId);
    if (!fileId) {
      skipped.push({ sessionId: material.sessionId, reason: "invalid-id" });
      continue;
    }
    // 同じ会話が 2 回渡されたら、あとのものだけを使う
    if (seen.has(fileId)) {
      const i = pending.findIndex((p) => p.fileId === fileId);
      if (i >= 0) pending.splice(i, 1);
    }
    seen.add(fileId);
    if (!material.turns.some((t) => t.speaker === "user")) {
      skipped.push({ sessionId: material.sessionId, reason: "empty" });
      continue;
    }
    const existing = known.get(fileId);
    if (existing && existing.type !== "conversation") {
      skipped.push({ sessionId: material.sessionId, reason: "id-conflict" });
      continue;
    }
    const body = renderConversationBody(material, options);
    const meta = buildConversationMeta(material, body.length, now);
    // 変わっていない会話は本文を書き直さない（本文が失われているときは書き直す）
    let needsBody = !sameConversation(existing?.conversation, meta);
    if (!needsBody && deps.loadMediaText) {
      try {
        needsBody = (await deps.loadMediaText(fileId)) === undefined;
      } catch {
        needsBody = true;
      }
    }
    if (needsBody) {
      try {
        await deps.saveMediaText(fileId, body);
      } catch {
        skipped.push({ sessionId: material.sessionId, reason: "save-failed" });
        continue;
      }
    }
    pending.push({ fileId, material, meta });
  }

  const latest = (await deps.readIndex()) ?? before;
  const result = upsertConversationEntries(latest, pending, options, now);
  for (const fileId of result.conflicts) {
    const sessionId = pending.find((p) => p.fileId === fileId)?.material.sessionId ?? fileId;
    skipped.push({ sessionId, reason: "id-conflict" });
  }
  if (result.index !== latest) {
    try {
      await deps.saveIndex(result.index);
    } catch (err) {
      // 一覧に載らなかった新しい会話の本文を残さない（既にあった会話の本文は、前の一覧が指しているので残す）
      if (deps.deleteMediaText) {
        for (const fileId of result.created) {
          try {
            await deps.deleteMediaText(fileId);
          } catch {
            // 消し損ねても、次の取り込みで同じ id に上書きされる
          }
        }
      }
      throw err;
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(MEDIA_INDEX_CHANGED_EVENT, {
          detail: { reason: "conversation-import", count: result.created.length + result.updated.length },
        }),
      );
    }
  }
  return { created: result.created, updated: result.updated, unchanged: result.unchanged, skipped };
}
