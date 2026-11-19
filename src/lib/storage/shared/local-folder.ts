// Local folder Provider（Tauri 環境専用）
//
// 設計: docs/internal/team-shared-storage-design.md §4 v1 実装方針: Local folder Provider
//
// レイアウト:
//   <shared-root>/
//     <type>/<id>.json          — { entry: SharedEntry, body_base64: string }
//     _meta/tombstones/<id>.json — status="unshared" の entry のみ（body なし）
//   <blob-root>/
//     <hh>/<full-hash>           — content-addressed blob（hh = hash の先頭 2 hex）
//
// 注意:
//   - Tauri 環境専用。ブラウザ / Web では未対応（Phase 1c 以降で別 Provider 検討）
//   - 1 type ↔ 1 サブフォルダ。SharedEntryType の文字列を URL-safe なフォルダ名にマップ
//     （"data-manifest" → "data-manifests" 等）

import { invoke } from "@tauri-apps/api/core";
import type {
  SharedEntry,
  SharedEntryContent,
  SharedEntryType,
  SharedStorageProvider,
  SharedWriteOptions,
  BlobRef,
  BlobStorageProvider,
} from "./types";
import { computeSharedEntryHash, computeBlobHash } from "./hash";
import { isValidSharedId } from "./id";
import { bytesToBase64 } from "@/lib/base64";

// SharedEntry.type ("note" 等、単数) と shared フォルダ名 ("notes" 等、複数) の対応。
// Tauri 側コマンドはフォルダ名を期待する（lib.rs の SHARED_ENTRY_TYPES）。
// export はテスト用（Rust 側 SHARED_ENTRY_TYPES との整合検査）
export const TYPE_TO_FOLDER: Record<SharedEntryType, string> = {
  note: "notes",
  reference: "references",
  "data-manifest": "data-manifests",
  template: "templates",
  knowledge: "knowledge",
  report: "reports",
  comment: "comments",
  proposal: "proposals",
};

/** ディスクに書き込む JSON のラッパー型。 */
type StoredEntry = {
  entry: SharedEntry;
  body_base64: string;
};

function uint8ToBase64(bytes: Uint8Array): string {
  return bytesToBase64(bytes);
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function parseStored(json: string): StoredEntry {
  const parsed = JSON.parse(json) as StoredEntry;
  if (!parsed || typeof parsed !== "object" || !parsed.entry) {
    throw new Error("Invalid shared entry JSON: missing entry");
  }
  if (typeof parsed.body_base64 !== "string") {
    throw new Error("Invalid shared entry JSON: missing body_base64");
  }
  return parsed;
}

/**
 * Local folder Provider for SharedStorageProvider。
 * Tauri コマンド経由で `<shared-root>/<type>/<id>.json` を読み書きする。
 */
/**
 * author-owned 強制で使う identity の最小形。
 * `LocalFolderSharedProvider` の write/delete で「自分以外の shared を書き換えない」
 * チェックに使う。読み取り（list/read）には不要。
 */
export type ProviderIdentity = { email: string };

export class AuthorMismatchError extends Error {
  constructor(
    public readonly entryId: string,
    public readonly entryAuthorEmail: string,
    public readonly callerEmail: string | undefined,
  ) {
    super(
      `Read-only: shared entry ${entryId} belongs to ${entryAuthorEmail}, ` +
        `not ${callerEmail ?? "(unknown)"}. Fork it instead.`,
    );
    this.name = "AuthorMismatchError";
  }
}

/** Rust が「先に更新されていた」ときに返すエラーの接頭辞。lib.rs の SHARED_CONFLICT_PREFIX と揃える */
export const SHARED_CONFLICT_PREFIX = "SHARED_CONFLICT:";

/** 読んだ版のあとに、共有の本体が更新されていた（または無くなっていた）。何も書いていない */
export class SharedConflictError extends Error {
  constructor(
    public readonly entryId: string,
    /** 今の版の hash。本体が無くなっていたときは空 */
    public readonly currentHash: string,
  ) {
    super(`Shared entry ${entryId} was updated by someone else.`);
    this.name = "SharedConflictError";
  }
}

export class LocalFolderSharedProvider implements SharedStorageProvider {
  readonly kind = "local-folder";
  readonly visibility = "private" as const;

  /**
   * identity が指定されていれば write/delete で author 一致チェックを行う。
   * 指定なしでも read/list は動くが、write/delete は安全のため拒否する。
   */
  constructor(
    private readonly root: string,
    private readonly identity?: ProviderIdentity,
  ) {
    if (!root || root.trim() === "") {
      throw new Error("LocalFolderSharedProvider requires a non-empty root path");
    }
  }

  /**
   * 既存 entry の author と this.identity を比較し、不一致なら AuthorMismatchError を投げる。
   * 既存 entry が存在しない（最初の Share）場合は何もしない。
   *
   * 設計判断: 一致比較は email 値のみ。name は表示名なので比較対象外。
   * email 値は normalize 済み（trim 済み）の前提。
   */
  private async assertCanModify(folder: string, id: string): Promise<void> {
    if (!this.identity) {
      throw new Error(
        "LocalFolderSharedProvider requires identity for write/delete. " +
          "Construct it with `new LocalFolderSharedProvider(root, { email })`.",
      );
    }
    let existingJson: string;
    try {
      existingJson = await invoke<string>("shared_read", {
        root: this.root,
        entryType: folder,
        id,
      });
    } catch {
      // 存在しない = 最初の write。チェック不要
      return;
    }
    const existing = parseStored(existingJson);
    const existingEmail = existing.entry.author?.email ?? "";
    if (existingEmail !== this.identity.email) {
      throw new AuthorMismatchError(id, existingEmail, this.identity.email);
    }
  }

  async list(prefix: SharedEntryType): Promise<SharedEntry[]> {
    const folder = TYPE_TO_FOLDER[prefix];
    const jsons = await invoke<string[]>("shared_list", {
      root: this.root,
      entryType: folder,
    });
    const candidates: { entry: SharedEntry; json: string; unshared: boolean }[] = [];
    for (const j of jsons) {
      try {
        const parsed = parseStored(j);
        // unshared（tombstone）は一覧には出さないが、同じ id の重複判定には数える
        // （本物が tombstone のとき、同じ id を名乗る active な影を通さないため）
        // id が uuidv7 でないもの・置かれたフォルダの種別と違うものは捨てる
        if (!isValidSharedId(parsed.entry.id) || parsed.entry.type !== prefix) continue;
        candidates.push({ entry: parsed.entry, json: j, unshared: parsed.entry.status === "unshared" });
      } catch {
        // 壊れたファイルはスキップ（list の安定性優先）
      }
    }
    // 同じ id を名乗る entry が複数あるとき（クラウド同期の競合コピー・手での複製・別名のファイルに
    // 他人の id を書いた「影」）は、ファイル名 = id の本物を shared_read で読み、中身が一致する
    // ものだけ残す。shared_list は中身しか返さずファイル名と突き合わせられないため、
    // 追加の読み込みは重複したときだけ行う
    const counts = new Map<string, number>();
    for (const c of candidates) counts.set(c.entry.id, (counts.get(c.entry.id) ?? 0) + 1);
    const realJson = new Map<string, string | null>();
    const out: SharedEntry[] = [];
    const emitted = new Set<string>();
    for (const c of candidates) {
      const id = c.entry.id;
      if (emitted.has(id)) continue;
      if (c.unshared && (counts.get(id) ?? 0) <= 1) continue;
      if ((counts.get(id) ?? 0) > 1) {
        if (!realJson.has(id)) {
          try {
            realJson.set(
              id,
              await invoke<string>("shared_read", { root: this.root, entryType: folder, id }),
            );
          } catch {
            realJson.set(id, null); // 本物のファイルが無い。どれも信用しない
          }
        }
        if (realJson.get(id) !== c.json) continue;
      }
      if (c.unshared) continue;
      emitted.add(id);
      out.push(c.entry);
    }
    return out;
  }

  async read(id: string): Promise<SharedEntryContent> {
    if (!isValidSharedId(id)) throw new Error(`Invalid shared id: ${id}`);
    const folder = await this.locateFolderById(id);
    const json = await invoke<string>("shared_read", {
      root: this.root,
      entryType: folder,
      id,
    });
    const parsed = parseStored(json);
    // ファイル名（id）と中身の id が違うものは、別の entry を装ったファイル
    if (parsed.entry.id !== id) {
      throw new Error(`Shared entry id mismatch: ${id}`);
    }
    return {
      entry: parsed.entry,
      body: base64ToUint8(parsed.body_base64),
    };
  }

  async write(entry: SharedEntry, content: Uint8Array, options?: SharedWriteOptions): Promise<void> {
    if (!isValidSharedId(entry.id)) throw new Error(`Invalid shared id: ${entry.id}`);
    const folder = TYPE_TO_FOLDER[entry.type];
    if (!folder) throw new Error(`Unknown entry type: ${entry.type}`);

    // author-owned 強制: 既存 entry の author email と一致するか確認。
    // 受け付け中のノートへの更新（asContributor）は、この判定を Rust（shared_write）に任せる
    // （受け付け中・作者や作成日時を変えていない・expectedHash 付きの条件をそこで確かめる）
    if (options?.asContributor !== true) {
      await this.assertCanModify(folder, entry.id);
      // 新規 entry の author もこの identity と一致していなければエラー（他人名義での偽造防止）
      if (this.identity && entry.author?.email !== this.identity.email) {
        throw new Error(
          `Entry author (${entry.author?.email ?? "(none)"}) does not match the current identity (${this.identity.email})`,
        );
      }
    } else if (!this.identity) {
      throw new Error("LocalFolderSharedProvider requires identity for write/delete.");
    }

    // hash を計算して entry にセット（呼び出し側が事前に計算していても上書き：データ整合性優先）
    const hash = await computeSharedEntryHash(entry, content);
    const finalEntry: SharedEntry = { ...entry, hash };
    const stored: StoredEntry = {
      entry: finalEntry,
      body_base64: uint8ToBase64(content),
    };
    try {
      await invoke<void>("shared_write", {
        root: this.root,
        entryType: folder,
        id: entry.id,
        content: JSON.stringify(stored),
        authorEmail: this.identity?.email,
        ...(options?.expectedHash !== undefined ? { expectedHash: options.expectedHash } : {}),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.startsWith(SHARED_CONFLICT_PREFIX)) {
        throw new SharedConflictError(entry.id, message.slice(SHARED_CONFLICT_PREFIX.length));
      }
      throw e;
    }
  }

  async delete(id: string): Promise<void> {
    if (!isValidSharedId(id)) throw new Error(`Invalid shared id: ${id}`);
    // tombstone を作るために、削除前に entry を読み直して status="unshared" を立てる
    const folder = await this.locateFolderById(id);
    // author-owned 強制
    await this.assertCanModify(folder, id);
    const json = await invoke<string>("shared_read", {
      root: this.root,
      entryType: folder,
      id,
    });
    const parsed = parseStored(json);
    const tombstoneEntry: SharedEntry = {
      ...parsed.entry,
      status: "unshared",
      unshared_at: new Date().toISOString(),
    };
    const tombstone: StoredEntry = {
      entry: tombstoneEntry,
      body_base64: "", // tombstone は本体を持たない
    };
    await invoke<void>("shared_delete", {
      root: this.root,
      entryType: folder,
      id,
      authorEmail: this.identity?.email,
      tombstoneContent: JSON.stringify(tombstone),
    });
  }

  /** 前の版（受け付け中のノートの上書き前の控え）のファイル名。新しい順 */
  async listVersions(id: string): Promise<string[]> {
    if (!isValidSharedId(id)) throw new Error(`Invalid shared id: ${id}`);
    return invoke<string[]>("shared_versions_list", { root: this.root, id });
  }

  /** 前の版を 1 つ読む（name は listVersions が返したファイル名） */
  async readVersion(id: string, name: string): Promise<SharedEntryContent> {
    if (!isValidSharedId(id)) throw new Error(`Invalid shared id: ${id}`);
    const json = await invoke<string>("shared_version_read", { root: this.root, id, name });
    const parsed = parseStored(json);
    return { entry: parsed.entry, body: base64ToUint8(parsed.body_base64) };
  }

  /** クラウド同期の競合コピー（`<id>` で始まる別名の .json）のファイル名。中身は返さない */
  async conflictCopies(type: SharedEntryType, id: string): Promise<string[]> {
    if (!isValidSharedId(id)) throw new Error(`Invalid shared id: ${id}`);
    const folder = TYPE_TO_FOLDER[type];
    if (!folder) throw new Error(`Unknown entry type: ${type}`);
    return invoke<string[]>("shared_conflict_copies", { root: this.root, entryType: folder, id });
  }

  async verifyHash(id: string): Promise<boolean> {
    const { entry, body } = await this.read(id);
    const recomputed = await computeSharedEntryHash(entry, body);
    return recomputed === entry.hash;
  }

  /**
   * id がどの type フォルダにあるか分からないとき用に、全 type を順に確認する。
   * Phase 1b では entry type が外部から渡されない経路（read / delete）でのみ使う。
   * Phase 2+ で「id → type」インデックスを持てばこの探索は不要になる。
   */
  private async locateFolderById(id: string): Promise<string> {
    for (const folder of Object.values(TYPE_TO_FOLDER)) {
      try {
        await invoke<string>("shared_read", {
          root: this.root,
          entryType: folder,
          id,
        });
        return folder;
      } catch {
        // not found in this folder, try next
      }
    }
    throw new Error(`Shared entry not found: ${id}`);
  }
}

/**
 * Local folder Provider for BlobStorageProvider。
 * `<blob-root>/<hh>/<full-hash>` のレイアウトで content-addressed に保存する。
 */
export class LocalFolderBlobProvider implements BlobStorageProvider {
  readonly kind = "local-folder";

  constructor(private readonly root: string) {
    if (!root || root.trim() === "") {
      throw new Error("LocalFolderBlobProvider requires a non-empty root path");
    }
  }

  async put(blob: Uint8Array, hint?: { filename?: string }): Promise<BlobRef> {
    const hash = await computeBlobHash(blob);
    await invoke<void>("shared_blob_write", {
      root: this.root,
      hash,
      contentBase64: uint8ToBase64(blob),
    });
    return {
      provider: this.kind,
      uri: `local-folder://${hash}`,
      hash,
      size: blob.length,
      filename: hint?.filename,
    };
  }

  /** 検証せずに読む（verifyHash が不一致を false で返すために使う） */
  private async readRaw(ref: BlobRef): Promise<Uint8Array> {
    const b64 = await invoke<string>("shared_blob_read", {
      root: this.root,
      hash: ref.hash,
    });
    return base64ToUint8(b64);
  }

  /** blob を読む。中身のハッシュが ref.hash と違えば（フォルダ内ですり替えられている）例外 */
  async get(ref: BlobRef): Promise<Uint8Array> {
    const bytes = await this.readRaw(ref);
    if ((await computeBlobHash(bytes)) !== ref.hash) {
      throw new Error(`Shared blob hash mismatch: ${ref.hash}`);
    }
    return bytes;
  }

  async url(ref: BlobRef): Promise<string> {
    // Local folder では Blob URL を作る（メモリにロード）
    const bytes = await this.get(ref);
    const blob = new Blob([bytes as BlobPart]);
    return URL.createObjectURL(blob);
  }

  async verifyHash(ref: BlobRef): Promise<boolean> {
    const bytes = await this.readRaw(ref);
    const recomputed = await computeBlobHash(bytes);
    return recomputed === ref.hash;
  }

  /** 既に保存済みかチェック（put をスキップしたい場合用）。 */
  async exists(hash: string): Promise<boolean> {
    return invoke<boolean>("shared_blob_exists", { root: this.root, hash });
  }

  /**
   * blob を削除する（GC 用）。idempotent — 存在しない hash でも成功扱い。
   * 呼び出し側で「他の active manifest がこの hash を参照していない」ことを
   * 確認した上で呼ぶこと。
   */
  async delete(hash: string): Promise<void> {
    await invoke<void>("shared_blob_delete", { root: this.root, hash });
  }
}
