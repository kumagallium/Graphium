// FolderInbox — InboxTransport の唯一の実体（Phase 0）。
// 同期フォルダ <root>/Inbox/ を Rust FS コマンド経由で列挙・読み込み・後処理
// （削除 / _imported/ への退避）する。
// 設計: docs/internal/mobile-capture-transport-design-2026-07.md §5 / §13.9

import { invoke } from "@tauri-apps/api/core";
import { computeBlobHash } from "../../../lib/storage/shared/hash";
import { sniffMimeType } from "../../sharing/materialize-blobs";
import { mimeFromExtension, kindFromMime } from "./mime";
import { parseInboxFolder } from "./push/naming";
import type { CaptureBundle, CaptureRef, InboxTransport } from "./types";

// base64 デコード（Rust inbox_read が base64 で返す）。
// 共通ユーティリティ化されていないため、local-folder.ts / share-media.ts と同じ実装を持つ。
function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * 同期フォルダ(iCloud/Dropbox/Syncthing 等)の <root>/Inbox/ を配送面に借りる InboxTransport。
 * Tauri 環境専用（Rust の inbox_list / inbox_read / inbox_mark_imported / inbox_discard を呼ぶ）。
 */
export class FolderInbox implements InboxTransport {
  constructor(private readonly root: string) {
    if (!root || root.trim() === "") {
      throw new Error("FolderInbox requires a non-empty inbox root path");
    }
  }

  async listPending(): Promise<CaptureRef[]> {
    // Rust の inbox_list は camelCase の { name, bytes, modifiedAt? } を返す。
    // CaptureRef と同形なのでそのまま通す（modifiedAt は取れない FS では欠落する）。
    return await invoke<CaptureRef[]>("inbox_list", { root: this.root });
  }

  /** Inbox/<name> を読んで生バイト + MIME を返す（readBlob / fetch の共通前段）。 */
  private async readBytes(ref: CaptureRef): Promise<{ bytes: Uint8Array; mime: string }> {
    const b64 = await invoke<string>("inbox_read", {
      root: this.root,
      name: ref.name,
    });
    const bytes = base64ToUint8(b64);
    // 名前を持つので拡張子を優先。判定不能時のみマジックバイト sniff にフォールバック。
    const mime = mimeFromExtension(ref.name) ?? sniffMimeType(bytes);
    return { bytes, mime };
  }

  /**
   * 本体だけを Blob で読む（checksum は計算しない）。受信箱ビューのサムネイル用。
   * fetch() は「これ + checksum 計算」なので、表示目的では sha256 の分だけ無駄が減る。
   */
  async readBlob(ref: CaptureRef): Promise<Blob> {
    const { bytes, mime } = await this.readBytes(ref);
    return new Blob([bytes as BlobPart], { type: mime });
  }

  async fetch(ref: CaptureRef): Promise<CaptureBundle> {
    const { bytes, mime } = await this.readBytes(ref);
    const checksum = await computeBlobHash(bytes);
    // 送信時に指定されたフォルダは名前に埋め込まれている（push/naming.ts）。
    // ここで取り出して meta に移す — 名前に残したままだと素材名がエンコード済みの
    // 文字列になってしまう。
    const { folder } = parseInboxFolder(ref.name);
    return {
      blob: new Blob([bytes as BlobPart], { type: mime }),
      meta: {
        id: checksum,
        checksum,
        mime,
        bytes: bytes.length,
        kind: kindFromMime(mime),
        ...(folder ? { folder } : {}),
      },
    };
  }

  async markImported(ref: CaptureRef): Promise<void> {
    await invoke<void>("inbox_mark_imported", {
      root: this.root,
      name: ref.name,
    });
  }

  async discard(ref: CaptureRef): Promise<void> {
    await invoke<void>("inbox_discard", {
      root: this.root,
      name: ref.name,
    });
  }
}
