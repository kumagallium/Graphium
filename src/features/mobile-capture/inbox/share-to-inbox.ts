// モバイル → 同期フォルダ Inbox への送出（Web Share API Level 2）。
// 送信キュー（push/queue.ts）の**フォールバック経路**: Google Drive push が未設定
// （client_id なし）の環境で、キューに積んだファイルを OS の共有シートへ渡し、
// ユーザーが「ファイルに保存」で <sync-root>/Graphium/Inbox を選ぶ。
//
// 主経路は push/（OAuth で Drive の Graphium/Inbox へ直接アップロード）。この
// モジュールはネットワークも認可も使わないので、push/ と違い動的 import 境界の
// 内側に置く必要がなく、UI から静的 import してよい。
//
// 渡すファイルは**キューで正規化済みの名前**（push/naming.ts の
// graphium-<YYYYMMDD-HHmmss>-<連番>.<ext>）をそのまま使う。かつての Web Share 版
// （wip/web-share-sheet-rescue の share-to-inbox.ts）はここで rename していたが、
// 命名は push/naming.ts に一本化されたため、この移植版は「渡す」ことだけをやる。
//
// 受信側（デスクトップ）は transport.ts の FolderInbox。ここはその push 側にあたるが、
// 実際の書き込みは OS がやるので InboxTransport は実装しない（types.ts の注記どおり）。

/** 送出の結果。呼び出し側はこれを見てフィードバックを出し分ける。 */
export type ShareToInboxOutcome =
  /** 共有シートに渡せた（保存先の選択は OS 側なので、保存されたかまでは分からない）。 */
  | { status: "shared"; files: File[] }
  /** ユーザーが共有シートを閉じた（AbortError）。エラーではないので何も出さない。 */
  | { status: "cancelled" }
  /** この環境ではファイル共有ができない（feature detection / canShare が false）。 */
  | { status: "unsupported" }
  /** それ以外の失敗。 */
  | { status: "failed"; error: string };

/** navigator のうち本モジュールが使う部分だけの最小形（テストで差し替えるため）。 */
export type ShareCapableNavigator = {
  share?: (data: { files?: File[] }) => Promise<void>;
  canShare?: (data: { files?: File[] }) => boolean;
};

/**
 * この環境がファイル共有をできるか。UA スニッフィングはしない（Safari だけの機能ではないし、
 * PWA / アプリ内ブラウザで挙動が変わる）。実ファイルを 1 つ作って canShare に食わせる。
 */
export function canShareFilesToInbox(nav: ShareCapableNavigator = navigator): boolean {
  if (typeof nav?.share !== "function" || typeof nav?.canShare !== "function") return false;
  try {
    // 空バイトのダミー。canShare は中身を見ず「この種類のファイルを共有できるか」だけ判定する。
    const probe = new File([new Uint8Array() as BlobPart], "graphium-probe.jpg", {
      type: "image/jpeg",
    });
    return nav.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/**
 * ファイルを共有シートへ渡す。名前は呼び出し側で確定済みであること
 * （送信キューの場合は enqueue 時に正規化済み — 一覧に見せた名前のまま渡る）。
 *
 * **user gesture を保つため、await を挟む前に share() を呼ぶ**（canShare も同期）。
 * click ハンドラから同期的に呼ぶこと。await を先に挟むと iOS では NotAllowedError になる。
 *
 * data には files しか入れない。iOS は title/text/url を混ぜると共有先アプリによって
 * ファイルを落とすことがあるため（Web Share の既知の癖）。
 */
export async function shareFilesToInbox(
  files: File[],
  options: { navigator?: ShareCapableNavigator } = {},
): Promise<ShareToInboxOutcome> {
  const nav = options.navigator ?? (typeof navigator !== "undefined" ? navigator : undefined);
  if (files.length === 0) return { status: "failed", error: "no files" };
  if (!nav || typeof nav.share !== "function") return { status: "unsupported" };

  // 実ファイルで最終確認（種類・件数・サイズで弾かれることがある）。
  if (typeof nav.canShare === "function") {
    try {
      if (!nav.canShare({ files })) return { status: "unsupported" };
    } catch {
      return { status: "unsupported" };
    }
  }

  try {
    await nav.share({ files });
    return { status: "shared", files };
  } catch (err) {
    // 共有シートを閉じただけ。失敗ではないのでエラー表示しない。
    if (err instanceof Error && err.name === "AbortError") return { status: "cancelled" };
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}
