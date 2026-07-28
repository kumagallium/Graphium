// Inbox importer サービス（Phase 0）。
// InboxTransport から未取り込みメディアを取り出し、active MediaProvider へ取り込む。
// materializeSharedBlobs（fork 取り込み）と同じ「依存注入で uploadMedia を受ける」パターンで、
// hook や provider の具体には依存しない（テスト容易・vault 分裂しない）。
// 設計: docs/internal/mobile-capture-transport-design-2026-07.md §5/§9
//
// P2（メモ / URL のネイティブ捕獲）: `.graphium.json` のアイテムは `handlers` に
// 注入された kind 別ハンドラへ振り分ける（メモ → capture-store、URL → media-index の
// URL 素材）。判定は **拡張子 + JSON 形状の両方**（capture-file.ts）で、形状不正・
// 未知バージョン・ハンドラ未注入のときは従来どおり素材として取り込む — データを落とさない。
// importer 自体は着地先を知らない（依存注入）ので、他の呼び出し元は handlers を
// 渡さなければ従来挙動のまま。

import { parseGraphiumCaptureFile, isGraphiumCaptureName } from "./capture-file";
import type {
  GraphiumMemoCapturePayload,
  GraphiumUrlCapturePayload,
} from "./capture-file";
import type { CaptureMeta, CaptureRef, InboxTransport } from "./types";

/**
 * 取り込んだ 1 アイテムを active MediaProvider に登録する依存注入関数。
 * 典型: useFileManager の handleUploadAsset（capture を MediaIndexEntry に格納する）。
 */
export type UploadCapturedAsset = (
  file: File,
  options: { capture: CaptureMeta },
) => Promise<{ fileId: string }>;

/** kind 別ハンドラに渡す文脈（配送メタと Inbox 上のファイル名）。 */
export type CapturePayloadContext = { meta: CaptureMeta; name: string };

/**
 * Graphium ネイティブ捕獲ファイル（メモ / URL）の kind 別着地ハンドラ。
 * - memo: デスクトップのメモ（capture-store）として作成する。**保存失敗は throw する**こと
 *   （importer が failed に数え、markImported しないので Inbox に残り、再試行できる）。
 * - url: URL ブックマーク素材（media-index の url エントリ）として作成する。
 * 返す fileId は結果レポート用（memo はメモ ID、url はブックマークの fileId）。
 */
export type InboxCapturePayloadHandlers = {
  memo?: (
    payload: GraphiumMemoCapturePayload,
    ctx: CapturePayloadContext,
  ) => Promise<{ fileId: string }>;
  url?: (
    payload: GraphiumUrlCapturePayload,
    ctx: CapturePayloadContext,
  ) => Promise<{ fileId: string }>;
};

export type InboxImportOptions = {
  /** 配送面（v1 は FolderInbox）。 */
  transport: InboxTransport;
  /** バイト列を active provider に取り込む（capture 属性付き）。 */
  uploadAsset: UploadCapturedAsset;
  /**
   * 既に取り込み済みか（content checksum で判定）。冪等性の担保。
   * 典型: media index の capture.checksum 集合を引く。未指定なら常に取り込む。
   */
  isAlreadyImported?: (checksum: string) => boolean;
  /**
   * 取り込む対象を絞る（受信箱ビューの「選択したものを取り込み」）。
   * 名前で listPending の結果と突き合わせるので、UI 側は表示中の CaptureRef を
   * そのまま渡せばよい。**未指定なら従来どおり Inbox の全件を取り込む**。
   *
   * listPending を捨てて `only` をそのまま処理しないのは、選択してから実行するまでの
   * 間に Inbox の実体が変わりうるため（同期フォルダは外から書き換わる）。列挙し直した
   * 「いま実在するもの」との積集合を取る。
   */
  only?: CaptureRef[];
  /** メモ / URL 捕獲ファイルの着地ハンドラ（未指定なら素材として取り込む従来挙動）。 */
  handlers?: InboxCapturePayloadHandlers;
  /**
   * 取り込み成功（duplicate skip 含む）後の Inbox 側ファイルの後処理。
   * - "delete"（**既定**）: Inbox から削除する。中身は取り込み時点でデスクトップ vault に
   *   着地済みなので、消えるのは冗長コピーのみ（同期フォルダ = クラウドに処理済みの
   *   控えを溜め続けない）。冪等性は checksum dedup と「Inbox から消えること」が担う。
   * - "archive": _imported/ へ退避する（処理済みの控えを残したい人向けのオプトイン）。
   * 失敗したアイテムはどちらの設定でも Inbox に残る（再試行できる）。
   */
  disposal?: "delete" | "archive";
};

export type InboxImportResult = {
  imported: {
    name: string;
    fileId: string;
    checksum: string;
    /** メモ / URL 捕獲として振り分けた場合のみ付く（素材は undefined）。 */
    kind?: "memo" | "url";
  }[];
  skipped: { name: string; checksum: string; reason: "duplicate" }[];
  failed: { name: string; error: string }[];
};

/**
 * Inbox の未取り込みメディアを順に active MediaProvider へ取り込む。
 *
 * 各アイテム: fetch → checksum で dedup → (捕獲 JSON なら kind ハンドラ / それ以外は
 * File 構築 → uploadAsset(capture)) → 後処理（disposal: 既定は Inbox から削除、
 * "archive" なら _imported/ へ退避）。
 * - 冪等: checksum 一致（取り込み済み）は upload せず後処理だけして skip。
 *   成功・skip とも Inbox から消えるので、次回以降は列挙されない（二重取込しない）。
 * - 堅牢性: 1 件の失敗が全体を止めないよう、失敗は failed に積んで続行する。
 *   失敗は後処理せず Inbox に残す（再試行できる）。
 * - File 名は元のファイル名（ref.name）を保持する（mime は File.type に入れる）。
 * - `only` を渡すと、その名前の分だけを取り込む（受信箱の選択取り込み）。未指定は全件。
 */
export async function runInboxImport(
  opts: InboxImportOptions,
): Promise<InboxImportResult> {
  const { transport, uploadAsset, isAlreadyImported, only, handlers } = opts;
  const result: InboxImportResult = { imported: [], skipped: [], failed: [] };
  // 取り込み成功後の Inbox 側ファイルの後処理。既定は削除（冗長コピーを残さない）。
  const dispose = (ref: CaptureRef): Promise<void> =>
    opts.disposal === "archive" ? transport.markImported(ref) : transport.discard(ref);

  const listed = await transport.listPending();
  // only 指定時は「いま実在するもの」と選択の積集合。未指定なら全件（従来挙動）。
  const onlyNames = only ? new Set(only.map((r) => r.name)) : null;
  const pending = onlyNames ? listed.filter((r) => onlyNames.has(r.name)) : listed;
  for (const ref of pending) {
    try {
      const bundle = await transport.fetch(ref);
      const { checksum } = bundle.meta;

      if (isAlreadyImported?.(checksum)) {
        // 既取り込み: upload せず後処理（既定は削除）だけして skip
        await dispose(ref);
        result.skipped.push({ name: ref.name, checksum, reason: "duplicate" });
        continue;
      }

      // メモ / URL 捕獲ファイル → kind 別ハンドラへ（拡張子 + JSON 形状の両方で判定）。
      // パース不能・未知バージョン・ハンドラ未注入は下の素材取り込みへフォールスルー。
      if (handlers && isGraphiumCaptureName(ref.name)) {
        const payload = parseGraphiumCaptureFile(ref.name, await bundle.blob.text());
        const ctx: CapturePayloadContext = { meta: bundle.meta, name: ref.name };
        if (payload?.kind === "memo" && handlers.memo) {
          const { fileId } = await handlers.memo(payload, ctx);
          await dispose(ref);
          result.imported.push({ name: ref.name, fileId, checksum, kind: "memo" });
          continue;
        }
        if (payload?.kind === "url" && handlers.url) {
          const { fileId } = await handlers.url(payload, ctx);
          await dispose(ref);
          result.imported.push({ name: ref.name, fileId, checksum, kind: "url" });
          continue;
        }
      }

      const file = new File([bundle.blob], ref.name, { type: bundle.meta.mime });
      const { fileId } = await uploadAsset(file, { capture: bundle.meta });
      await dispose(ref);
      result.imported.push({ name: ref.name, fileId, checksum });
    } catch (e) {
      result.failed.push({
        name: ref.name,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}
