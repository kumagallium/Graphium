// Inbox importer サービス（Phase 0）。
// InboxTransport から未取り込みメディアを取り出し、active MediaProvider へ取り込む。
// materializeSharedBlobs（fork 取り込み）と同じ「依存注入で uploadMedia を受ける」パターンで、
// hook や provider の具体には依存しない（テスト容易・vault 分裂しない）。
// 設計: docs/internal/mobile-capture-transport-design-2026-07.md §5/§9

import type { CaptureMeta, CaptureRef, InboxTransport } from "./types";

/**
 * 取り込んだ 1 アイテムを active MediaProvider に登録する依存注入関数。
 * 典型: useFileManager の handleUploadAsset（capture を MediaIndexEntry に格納する）。
 */
export type UploadCapturedAsset = (
  file: File,
  options: { capture: CaptureMeta },
) => Promise<{ fileId: string }>;

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
};

export type InboxImportResult = {
  imported: { name: string; fileId: string; checksum: string }[];
  skipped: { name: string; checksum: string; reason: "duplicate" }[];
  failed: { name: string; error: string }[];
};

/**
 * Inbox の未取り込みメディアを順に active MediaProvider へ取り込む。
 *
 * 各アイテム: fetch → checksum で dedup → File 構築 → uploadAsset(capture) → markImported。
 * - 冪等: checksum 一致（取り込み済み）は upload せず _imported/ へ退避だけして skip。
 *   取り込み後は _imported/ に移動するので、次回以降は列挙されない（二重取込しない）。
 * - 堅牢性: 1 件の失敗が全体を止めないよう、失敗は failed に積んで続行する。
 * - File 名は元のファイル名（ref.name）を保持する（mime は File.type に入れる）。
 * - `only` を渡すと、その名前の分だけを取り込む（受信箱の選択取り込み）。未指定は全件。
 */
export async function runInboxImport(
  opts: InboxImportOptions,
): Promise<InboxImportResult> {
  const { transport, uploadAsset, isAlreadyImported, only } = opts;
  const result: InboxImportResult = { imported: [], skipped: [], failed: [] };

  const listed = await transport.listPending();
  // only 指定時は「いま実在するもの」と選択の積集合。未指定なら全件（従来挙動）。
  const onlyNames = only ? new Set(only.map((r) => r.name)) : null;
  const pending = onlyNames ? listed.filter((r) => onlyNames.has(r.name)) : listed;
  for (const ref of pending) {
    try {
      const bundle = await transport.fetch(ref);
      const { checksum } = bundle.meta;

      if (isAlreadyImported?.(checksum)) {
        // 既取り込み: upload せず inbox からは退避して skip
        await transport.markImported(ref);
        result.skipped.push({ name: ref.name, checksum, reason: "duplicate" });
        continue;
      }

      const file = new File([bundle.blob], ref.name, { type: bundle.meta.mime });
      const { fileId } = await uploadAsset(file, { capture: bundle.meta });
      await transport.markImported(ref);
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
