// 共有ノートの「順番に更新」の処理の層（画面は別）。
//
// 作者は、ノートごとに「他の人の更新を受け付ける」を入れられる（extra.acceptsUpdates）。
// 受け付け中のノートは、作者以外も手元の写し（forkSharedNote で作ったもの）を共有へ反映できる。
// 受け付けは権限ではなく事故防止（名前・メールは自己申告）。別の端末との同時更新は
// 防げないが、読んだ版（expectedHash）を確かめて、先に更新されていたら書かない。
//
// 守っていること:
//   - 作者・作成日時・id は既存のまま。更新した人は extra.updatedBy に残す
//   - 共有の本文からは forkedFrom / sharedRef を外す（手元の関係を共有に持ち込まない）
//   - 上書きの直前の版は Rust 側が前の版として控える（restoreSharedVersion で戻せる）
//
// 判定の本体は Rust（shared_write）。ここは手順と、衝突の返し方だけを持つ。

import type { GraphiumDocument } from "../../lib/document-types";
import type { AuthorIdentity } from "../document-provenance/types";
import {
  LocalFolderSharedProvider,
  SharedConflictError,
  computeSharedEntryHash,
  computeBlobHash,
  type BlobRef,
  type SharedEntry,
} from "../../lib/storage/shared";
import { appendHistory } from "./share-history";
import { saveForkBase } from "./fork-base";
import {
  canUpdateSharedNote,
  prepareEntryDoc,
  stripPrivateHistory,
  type ShareNoteOptions,
} from "./share-note";
import { stripMemoTraces } from "./strip-memo-traces";
import { buildChecklistMirror } from "./checklist-count";
import { syncReadableCopy, type ReadableCopyContext, type ReadableCopyStatus } from "./readable-copy";

export { canUpdateSharedNote };

/** 共有のノートへ書く側の共通オプション（root と、書く人） */
export type SharedUpdateOptions = {
  root: string;
  author: AuthorIdentity;
  /** 読める写しの材料（restoreSharedVersion が、戻した版の写しを置くのに使う。無ければ写しは置かず古い写しを消す） */
  readable?: ReadableCopyContext;
};

export type UpdateSharedNoteOptions = ShareNoteOptions & {
  /**
   * 手元のノート id。渡すと、更新できたあとに基準版の控え（fork-base）を新しい本文に更新する。
   * 渡さなければ控えは触らない
   */
  noteId?: string;
};

export type UpdateSharedNoteResult =
  | {
      ok: true;
      /** forkedFrom.hash を新しい版にした手元の doc（呼び出し側が保存する） */
      doc: GraphiumDocument;
      entry: SharedEntry;
      readableCopy?: ReadableCopyStatus;
    }
  | { ok: false; conflict: true; currentHash: string }
  | { ok: false; conflict?: false; error: string };

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function sameEmail(a: string | undefined, b: string | undefined): boolean {
  return (a ?? "") === (b ?? "");
}

/** 作者が、他の人の更新を受け付けるかを切り替える。本文は変えず、読んだ版を確かめて書く */
export async function setAcceptsUpdates(
  sharedId: string,
  value: boolean,
  options: SharedUpdateOptions,
): Promise<{ ok: true; entry: SharedEntry } | { ok: false; conflict: true; currentHash: string } | { ok: false; conflict?: false; error: string }> {
  try {
    const provider = new LocalFolderSharedProvider(options.root, { email: options.author.email });
    const { entry: current, body } = await provider.read(sharedId);
    if (current.type !== "note") return { ok: false, error: "Only notes can accept updates." };
    if (current.status === "unshared") return { ok: false, error: "This note is no longer shared." };
    if (!sameEmail(current.author?.email, options.author.email)) {
      return { ok: false, error: "Only the author can change whether updates are accepted." };
    }
    const entry: SharedEntry = {
      ...current,
      hash: "", // provider.write が再計算する
      // 本文は変わらないので bodyHash を引き継ぐ（古い共有で無ければ今の本文から作る）
      extra: {
        ...current.extra,
        acceptsUpdates: value,
        bodyHash:
          typeof current.extra?.bodyHash === "string" ? current.extra.bodyHash : await computeBlobHash(body),
      },
    };
    const hash = await computeSharedEntryHash(entry, body);
    try {
      await provider.write(entry, body, { expectedHash: current.hash });
    } catch (e) {
      if (e instanceof SharedConflictError) {
        return { ok: false, conflict: true, currentHash: e.currentHash };
      }
      throw e;
    }
    return { ok: true, entry: { ...entry, hash } };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/**
 * 手元の写し（doc.forkedFrom.sharedId）を共有へ反映する。
 * 読んだ版（doc.forkedFrom.hash）のあとに共有が更新されていたら、何も書かず conflict を返す。
 */
export async function updateSharedNoteFromCopy(
  doc: GraphiumDocument,
  options: UpdateSharedNoteOptions,
): Promise<UpdateSharedNoteResult> {
  const forkedFrom = doc.forkedFrom;
  if (!forkedFrom?.sharedId) return { ok: false, error: "This note is not a copy of a shared note." };
  try {
    const provider = new LocalFolderSharedProvider(options.root, { email: options.author.email });
    const { entry: existing, body: existingBody } = await provider.read(forkedFrom.sharedId);
    if (!canUpdateSharedNote(existing)) {
      return { ok: false, error: "The author is not accepting updates to this note." };
    }
    // 読んだ版と違う: blob を置いたり書いたりする前に断る（書く側でも同じ確認をする）
    if (existing.hash !== forkedFrom.hash) {
      return { ok: false, conflict: true, currentHash: existing.hash };
    }

    let existingDoc: Partial<GraphiumDocument> = {};
    try {
      existingDoc = JSON.parse(new TextDecoder().decode(existingBody)) as GraphiumDocument;
    } catch {
      // 共有の本文が読めなくても更新は通す（題と noteContexts を引き継げないだけ）
    }
    const sharedTitle = (existingDoc.title ?? (existing.extra?.title as string | undefined)) || "";
    // 写しの題が「<共有の題> (forked)」のままなら、共有の題を使う（(forked) を共有に持ち込まない）
    const title = sharedTitle && doc.title === `${sharedTitle} (forked)` ? sharedTitle : doc.title;

    const prepared = await prepareEntryDoc({ ...doc, title }, options);
    if (!prepared.ok) return { ok: false, error: prepared.error };

    // 共有の本文から手元の関係を外す。noteContexts は作者のフォルダ（共有側の本文の値）を保つ
    // （fork が空にしているので、そのまま書くと作者のフォルダの情報が消える）
    const entryDoc: GraphiumDocument = { ...prepared.entryDoc, title };
    delete entryDoc.forkedFrom;
    delete entryDoc.sharedRef;
    if (existingDoc.noteContexts !== undefined) entryDoc.noteContexts = existingDoc.noteContexts;
    else delete entryDoc.noteContexts;
    const bodyJson = JSON.stringify(entryDoc);
    const body = new TextEncoder().encode(bodyJson);

    // 既存の blob の参照も残す（GC が、まだ本文が指している blob を消さないように）
    const rawBlobs: unknown = existing.extra?.blobs;
    const prevBlobs = Array.isArray(rawBlobs)
      ? rawBlobs.filter(
          (b): b is BlobRef =>
            !!b && typeof b === "object" && typeof (b as { hash?: unknown }).hash === "string",
        )
      : [];
    const blobs = [...prevBlobs];
    for (const b of prepared.blobs) {
      if (!blobs.some((x) => x.hash === b.hash)) blobs.push(b);
    }

    const now = new Date().toISOString();
    const history = appendHistory(existing);
    const { history: _oldHistory, ...existingRest } = existing;
    void _oldHistory;
    const bodyHash = await computeBlobHash(body);
    const entry: SharedEntry = {
      ...existingRest, // id / type / author / created_at / prov などは既存のまま
      updated_at: now,
      hash: "", // provider.write が再計算する
      ...(history ? { history } : {}),
      extra: {
        ...existing.extra,
        title,
        // 既存の extra.blobs が壊れていても引き継がない（形の合う要素だけを上で集めている）
        blobs: blobs.length > 0 ? blobs : undefined,
        updatedBy: { name: options.author.name, email: options.author.email },
        bodyHash,
        // チェックの件数は今書く本文で数え直す（前の版の件数を引き継がない。無ければキーごと外す）
        checklist: buildChecklistMirror(entryDoc, bodyHash),
      },
    };
    const hash = await computeSharedEntryHash(entry, body);
    const asContributor = !sameEmail(existing.author?.email, options.author.email);
    try {
      await provider.write(entry, body, {
        expectedHash: forkedFrom.hash,
        ...(asContributor ? { asContributor: true } : {}),
      });
    } catch (e) {
      if (e instanceof SharedConflictError) {
        return { ok: false, conflict: true, currentHash: e.currentHash };
      }
      throw e;
    }
    const written: SharedEntry = { ...entry, hash };

    // 読める写し（失敗しても更新は成功のまま。結果として返す）。
    // 作者名は共有の作者のまま。履歴・メモの痕跡は共有コピーと同じ範囲で落とす
    // 来歴（.prov.jsonld）にも、更新した人の手元の関係（forkedFrom / sharedRef / フォルダ名）は出さない
    const provBase: GraphiumDocument = { ...doc, title };
    delete provBase.forkedFrom;
    delete provBase.sharedRef;
    if (existingDoc.noteContexts !== undefined) provBase.noteContexts = existingDoc.noteContexts;
    else delete provBase.noteContexts;
    const provDoc = stripMemoTraces(stripPrivateHistory(provBase));
    const readableCopy = (
      await syncReadableCopy({
        root: options.root,
        authorEmail: options.author.email,
        entryHash: hash,
        sharedId: existing.id,
        title,
        entryDoc,
        provDoc,
        author: existing.author,
        context: options.readable,
        sharedAt: now,
      })
    ).status;

    // 基準版の控えを、今書いた本文に更新する（次の「変更の提案」「更新」の土台）
    if (options.noteId) {
      await saveForkBase(options.noteId, { sharedId: existing.id, hash, body: bodyJson });
    }

    return {
      ok: true,
      doc: { ...doc, forkedFrom: { ...forkedFrom, hash } },
      entry: written,
      readableCopy,
    };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/**
 * 前の版の本文を今の版として書き直す。expectedHash は今の hash（戻している間に更新されたら
 * 書かない）。前の版のファイル自体は消えない。更新した人（updatedBy）は戻した人になる
 */
export async function restoreSharedVersion(
  sharedId: string,
  versionName: string,
  options: SharedUpdateOptions,
): Promise<{ ok: true; entry: SharedEntry; readableCopy?: ReadableCopyStatus } | { ok: false; conflict: true; currentHash: string } | { ok: false; conflict?: false; error: string }> {
  try {
    const provider = new LocalFolderSharedProvider(options.root, { email: options.author.email });
    const { entry: current } = await provider.read(sharedId);
    const { entry: previous, body } = await provider.readVersion(sharedId, versionName);
    if (previous.id !== current.id) return { ok: false, error: "The version does not belong to this note." };
    // 前の版のファイルは共有フォルダの中にあるので、書き換えられていないか hash で確かめる
    if ((await computeSharedEntryHash(previous, body)) !== previous.hash) {
      return { ok: false, error: "The previous version does not match its recorded hash." };
    }
    if (current.type !== "note") return { ok: false, error: "Only notes have previous versions." };

    const now = new Date().toISOString();
    const history = appendHistory(current);
    const { history: _oldHistory, ...currentRest } = current;
    void _oldHistory;
    const entry: SharedEntry = {
      ...currentRest, // id / author / created_at は今のまま
      updated_at: now,
      hash: "", // provider.write が再計算する
      ...(history ? { history } : {}),
      extra: {
        ...previous.extra,
        // 受け付けのスイッチは今の状態を保つ（前の版が切り替え前のものでも戻らない）
        acceptsUpdates: current.extra?.acceptsUpdates,
        updatedBy: { name: options.author.name, email: options.author.email },
        bodyHash: await computeBlobHash(body),
      },
    };
    const hash = await computeSharedEntryHash(entry, body);
    const asContributor = !sameEmail(current.author?.email, options.author.email);
    try {
      await provider.write(entry, body, {
        expectedHash: current.hash,
        ...(asContributor ? { asContributor: true } : {}),
      });
    } catch (e) {
      if (e instanceof SharedConflictError) {
        return { ok: false, conflict: true, currentHash: e.currentHash };
      }
      throw e;
    }
    const written: SharedEntry = { ...entry, hash };

    // 読める写しを戻した版に合わせる（失敗しても戻すのは成功のまま。結果として返す）。
    // 共有の本文は履歴・手元の関係を落とした形なので、そのまま写しの材料にできる
    let readableCopy: ReadableCopyStatus;
    try {
      const entryDoc = JSON.parse(new TextDecoder().decode(body)) as GraphiumDocument;
      const title = entryDoc.title || (typeof entry.extra?.title === "string" ? entry.extra.title : "");
      const provDoc = stripMemoTraces(stripPrivateHistory(entryDoc));
      readableCopy = (
        await syncReadableCopy({
          root: options.root,
          authorEmail: options.author.email,
          entryHash: hash,
          sharedId: current.id,
          title,
          entryDoc,
          provDoc,
          author: current.author,
          context: options.readable,
          sharedAt: now,
        })
      ).status;
    } catch {
      readableCopy = "failed";
    }
    return { ok: true, entry: written, readableCopy };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
