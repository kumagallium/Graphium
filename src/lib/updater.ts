// Tauri 自動更新チェック
// アプリ起動時と 24 時間ごとに更新を確認する
// 更新が見つかると CustomEvent で UI に通知する
// 設定画面の About タブから手動でも呼べる

import { isTauri } from "./platform";
import pkg from "../../package.json";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 時間

// ダウンロードの reqwest リクエスト全体に効くタイムアウト。
// 未設定だと回線 stall 時に永久に待ち続け、バナーが「ダウンロード中」のまま固まる。
//
// 注意: これは「接続してから最後の 1 バイトまで」の総時間であって、無通信時間の
// 上限ではない（tauri-plugin-updater が reqwest の ClientBuilder::timeout に渡す）。
// 超過すると reqwest は body の読み取り中断として扱い、`error decoding response body`
// という中身の分からない文字列だけを返す。macOS の .app.tar.gz は 95MB あるので、
// 低速回線でも打ち切られないよう十分に長く取る。
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000; // 30 分

// ネットワーク由来の失敗は 1 回だけ自動で取り直す（部分ダウンロードは Rust 側で
// 破棄されるので、単純に最初からやり直すだけでよい）。
const DOWNLOAD_RETRY_COUNT = 1;

/**
 * ダウンロード失敗を、分類済みの情報ごと呼び出し元へ渡すための例外。
 * 実測値（何 MB で切れたか）は catch した側では取れないので、ここに載せて運ぶ。
 */
export class UpdaterDownloadError extends Error {
  constructor(readonly info: UpdaterErrorInfo) {
    super(info.raw);
    this.name = "UpdaterDownloadError";
  }
}

/** 自動更新が使えないときに案内する手動ダウンロード先 */
export const MANUAL_DOWNLOAD_URL =
  "https://github.com/kumagallium/Graphium/releases/latest";

// updater プラグインが見に行くのと同じエンドポイント（src-tauri/tauri.conf.json の
// plugins.updater.endpoints と対で管理する）。tauri.conf.json は JS から読めないため
// ここに持つ。フォールバックチェック（checkLatestVersionDirect）専用。
const UPDATER_ENDPOINTS = [
  "https://kumagallium.github.io/Graphium/updater/latest.json",
  "https://github.com/kumagallium/Graphium/releases/latest/download/latest.json",
];

/** ダウンロード進捗を UI に伝えるコールバックの引数 */
export type UpdateProgress =
  | { phase: "downloading"; downloaded: number; total?: number }
  | { phase: "installing" };

/** 更新情報を UI に伝える CustomEvent の detail 型 */
export type UpdateAvailableDetail = {
  version: string;
  install: (onProgress: (p: UpdateProgress) => void) => Promise<void>;
};

/** 自動更新は無理だが新版が出ていることを UI に伝える CustomEvent の detail 型 */
export type ManualUpdateDetail = {
  version: string;
  error: UpdaterErrorInfo;
};

/** エラーを「ユーザーが次に何をすればいいか」で分類した結果 */
export type UpdaterErrorInfo = {
  /** UI が t() に渡す i18n キー */
  key: "updater.errorNetwork" | "updater.errorIntegrity" | "updater.errorUnknown";
  /** 生のエラー文字列（詳細表示・問い合わせ用に残す） */
  raw: string;
  /** 手動ダウンロードを案内すべきか */
  offerManualDownload: boolean;
  /**
   * ダウンロード中に落ちた場合の実測値（何 MB まで届いたか・何秒かかったか）。
   * reqwest はタイムアウト超過も途中切断も同じ一文にまとめてしまうため、
   * この行が無いと報告を受けても原因を切り分けられない。
   */
  detail?: string;
};

/** ダウンロード中の失敗を切り分けるために classifyUpdaterError へ渡す実測値 */
export type DownloadAttemptStats = {
  downloaded: number;
  total?: number;
  elapsedMs: number;
  timeoutMs: number;
};

/** checkForUpdates の戻り値（手動チェック UI 用） */
export type CheckResult =
  | { status: "unsupported" }
  | { status: "up-to-date" }
  // install を含めることで、設定画面など呼び出し元がその場で更新を実行できる
  | { status: "available"; version: string; install: UpdateAvailableDetail["install"] }
  // 新版はあるが自動更新のチェックが通らなかった。手動ダウンロードに逃がす
  | { status: "manual"; version: string; error: UpdaterErrorInfo }
  | { status: "error"; error: UpdaterErrorInfo };

/** Tauri 環境では実バージョン、それ以外では package.json の version を返す */
export async function getAppVersion(): Promise<string> {
  if (isTauri()) {
    try {
      const { getVersion } = await import("@tauri-apps/api/app");
      return await getVersion();
    } catch {
      // 取得失敗時は package.json にフォールバック
    }
  }
  return pkg.version;
}

/** タイムアウト超過とみなす割合。実測がここに達していれば打ち切られたと読む */
const TIMEOUT_MARGIN = 0.95;

/** ダウンロードが打ち切られたのか、途中で切れたのかを実測から判定する */
export function hitDownloadTimeout(stats: DownloadAttemptStats): boolean {
  return stats.elapsedMs >= stats.timeoutMs * TIMEOUT_MARGIN;
}

/** 失敗したダウンロードの実測値を 1 行にまとめる（詳細表示・問い合わせ用） */
export function describeDownloadAttempt(stats: DownloadAttemptStats): string {
  const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
  const got = mb(stats.downloaded);
  const of = stats.total ? ` / ${mb(stats.total)}` : "";
  const secs = Math.round(stats.elapsedMs / 1000);
  const limit = Math.round(stats.timeoutMs / 1000);
  const verdict = hitDownloadTimeout(stats) ? "timeout" : "interrupted";
  return `download: ${got}${of} MB in ${secs}s (limit ${limit}s) — ${verdict}`;
}

/**
 * updater の生エラーを分類する。
 *
 * reqwest は「本文の読み取りに失敗した」系をすべて `error decoding response body`
 * という一文にまとめてしまう。原因は本文が JSON でない（企業プロキシやセキュリティ
 * ソフトが割り込んで別の応答や圧縮済み本文を返す）・ダウンロード中の切断・
 * タイムアウト超過などで、いずれもユーザー側のネットワーク事情。そのまま出すと
 * 何をすればいいか分からないので、ネットワーク系として括り直して手動導線を出す。
 */
export function classifyUpdaterError(
  e: unknown,
  stats?: DownloadAttemptStats,
): UpdaterErrorInfo {
  const raw = e instanceof Error ? e.message : String(e);
  const lower = raw.toLowerCase();
  const detail = stats ? describeDownloadAttempt(stats) : undefined;

  const isNetwork =
    lower.includes("error decoding response body") ||
    lower.includes("error sending request") ||
    lower.includes("operation timed out") ||
    lower.includes("timed out") ||
    lower.includes("connection") ||
    lower.includes("dns") ||
    lower.includes("certificate") ||
    lower.includes("download request failed with status") ||
    lower.includes("could not fetch a valid release json");
  if (isNetwork) {
    return { key: "updater.errorNetwork", raw, offerManualDownload: true, detail };
  }

  // 署名検証・base64 デコードの失敗は配布物側の問題。手動ダウンロードでも
  // 直らない可能性が高いが、インストーラを直接取る道は残しておく。
  const isIntegrity =
    lower.includes("signature") ||
    lower.includes("minisign") ||
    lower.includes("base64");
  if (isIntegrity) {
    return { key: "updater.errorIntegrity", raw, offerManualDownload: true, detail };
  }

  return { key: "updater.errorUnknown", raw, offerManualDownload: true, detail };
}

/**
 * catch した例外から表示用の情報を取り出す。
 * ダウンロード経路は実測値を載せた UpdaterDownloadError を投げてくるので、
 * それを潰さずに使う（分類し直すと detail が消える）。
 */
export function toUpdaterErrorInfo(e: unknown): UpdaterErrorInfo {
  return e instanceof UpdaterDownloadError ? e.info : classifyUpdaterError(e);
}

/**
 * `x.y.z` を比較する。a が b より新しければ正、古ければ負、同じなら 0。
 * リリースは tagpr が振る 3 桁のみなのでプレリリース表記は考慮しない。
 * 解釈できない入力は 0（＝更新なし扱い）にして、誤った更新案内を出さない。
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/**
 * updater プラグインを通さずに latest.json を取り、公開中のバージョンだけを読む。
 *
 * プラグインの check() は最初のエンドポイントの本文が読めなかった時点で例外を
 * 投げ、2 つ目のエンドポイントを試さずに終わる。そのケースでも「新しい版が出て
 * いること」だけは伝えられるようにするためのフォールバック。
 * 署名検証は行わないので、ここで得た情報でインストールはしない（手動導線のみ）。
 */
export async function checkLatestVersionDirect(): Promise<string | null> {
  for (const endpoint of UPDATER_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, { cache: "no-store" });
      if (!res.ok) continue;
      // JSON として読めない応答（プロキシの割り込みページなど）は次に回す
      const json = (await res.json()) as { version?: unknown };
      if (typeof json.version === "string" && json.version.trim()) {
        return json.version.trim();
      }
    } catch (err) {
      console.debug(`[updater] Fallback check failed for ${endpoint}:`, err);
    }
  }
  return null;
}

/** 更新チェックを開始する（起動時 1 回呼び出す） */
export async function initUpdater(): Promise<void> {
  if (!isTauri()) return;

  // 起動後 5 秒待ってから初回チェック（UI の初期化を妨げない）
  setTimeout(() => {
    void checkForUpdates();
  }, 5000);

  // 定期チェック
  setInterval(() => {
    void checkForUpdates();
  }, CHECK_INTERVAL_MS);
}

/**
 * 更新を確認する。
 * Tauri 環境でない場合は "unsupported"、更新があれば CustomEvent も発火する。
 */
export async function checkForUpdates(): Promise<CheckResult> {
  if (!isTauri()) return { status: "unsupported" };
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (update) {
      console.log(`[updater] Update available: ${update.version}`);
      const detail: UpdateAvailableDetail = {
        version: update.version,
        install: async (onProgress) => {
          for (let attempt = 0; ; attempt++) {
            let downloaded = 0;
            let total: number | undefined;
            const startedAt = Date.now();
            try {
              await update.download(
                (event) => {
                  if (event.event === "Started") {
                    total = event.data.contentLength;
                    downloaded = 0;
                    onProgress({ phase: "downloading", downloaded, total });
                  } else if (event.event === "Progress") {
                    downloaded += event.data.chunkLength;
                    onProgress({ phase: "downloading", downloaded, total });
                  }
                },
                { timeout: DOWNLOAD_TIMEOUT_MS },
              );
              break;
            } catch (e) {
              const stats: DownloadAttemptStats = {
                downloaded,
                total,
                elapsedMs: Date.now() - startedAt,
                timeoutMs: DOWNLOAD_TIMEOUT_MS,
              };
              const info = classifyUpdaterError(e, stats);
              // ネットワーク由来なら一度だけ取り直す。ただし制限時間まで粘った末の
              // 打ち切りは、同じ回線でもう一度やっても同じところで終わるだけなので
              // 取り直さず、手動ダウンロードに送る。
              if (
                attempt >= DOWNLOAD_RETRY_COUNT ||
                info.key !== "updater.errorNetwork" ||
                hitDownloadTimeout(stats)
              ) {
                throw new UpdaterDownloadError(info);
              }
              console.warn("[updater] Download failed, retrying once:", info.detail);
              onProgress({ phase: "downloading", downloaded: 0, total: undefined });
            }
          }
          onProgress({ phase: "installing" });
          await update.install();
          // Windows では install() から戻らない（インストーラ起動と同時に
          // プロセスが exit(0) で終了する）ため、relaunch は実質 macOS 用。
          const { relaunch } = await import("@tauri-apps/plugin-process");
          await relaunch();
        },
      };
      window.dispatchEvent(
        new CustomEvent("graphium-update-available", { detail }),
      );
      return { status: "available", version: update.version, install: detail.install };
    }
    console.log("[updater] App is up to date");
    return { status: "up-to-date" };
  } catch (e) {
    // updater が未設定（pubkey 未登録など）の場合や、ネットワーク失敗時
    console.debug("[updater] Check failed:", e);
    const error = classifyUpdaterError(e);

    // プラグイン経由が駄目でも、latest.json 自体は読めることがある。
    // 新版が出ているなら手動ダウンロードに案内する。
    const latest = await checkLatestVersionDirect();
    if (latest) {
      const current = await getAppVersion();
      if (compareVersions(latest, current) > 0) {
        const detail: ManualUpdateDetail = { version: latest, error };
        window.dispatchEvent(
          new CustomEvent("graphium-update-manual", { detail }),
        );
        return { status: "manual", version: latest, error };
      }
      // 最新版に追いついているならチェック失敗を報告する必要はない
      console.debug("[updater] Fallback says app is up to date");
      return { status: "up-to-date" };
    }
    return { status: "error", error };
  }
}
