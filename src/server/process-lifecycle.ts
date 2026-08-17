// sidecar プロセスの「死に方」を記録するハンドラ群。
//
// 背景（2026-08-17 の実例）: デスクトップアプリ本体は生きているのに sidecar だけが
// 消え、AI 機能が "Load failed" になった。sidecar.log は落ちる直前 96 秒間まったく
// 無音で、Tauri 側の記録は `exit code=None`（= シグナル死）だけ。何が起きたのか
// ログから一切分からず、原因究明できないことが最大の問題だった。
//
// このモジュールは 2 種類の「黙って死ぬ」経路を塞ぐ:
//
// 1. 未処理の例外 / Promise 拒否
//    Node 15+ は unhandledRejection でプロセスを終了する。Hono のルートハンドラ内の
//    throw は Hono が受けるが、ルート外（イベントコールバック・タイマー・fire-and-forget
//    な Promise）で起きたものはここへ来る。理由をログに残し、uncaughtException は
//    プロセスの整合性が保証できないので終了する。unhandledRejection は Node の既定
//    （終了）に従わず継続する — 「AI の裏方が 1 件失敗した」程度で全 API を道連れに
//    しないため。既定を変えることは承知の上での判断で、理由は必ず記録する。
//
// 2. シグナルによる終了
//    SIGTERM / SIGINT / SIGHUP を受けたことと、その時点の状態を記録してから終了する。
//    受信の記録が無いと「誰かに殺された」のか「自分で落ちた」のかが区別できない。
//    Tauri 側の `exit code=None` はシグナル死の印だが、どのシグナルかまでは分からない。
//
// 記録先は bootLog（stderr + sidecar-boot.log）と同じ経路。stderr は Tauri が
// sidecar.log に転記する。

export type LifecycleLogger = (msg: string) => void;

export type ProcessLike = {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  exit(code?: number): never;
  pid: number;
};

/** エラーを 1 行のログ向けに整形する（stack があれば先頭数行を含める） */
export function describeError(err: unknown, maxStackLines = 6): string {
  if (err instanceof Error) {
    const stack = err.stack ?? "";
    const lines = stack.split("\n").slice(0, maxStackLines).join(" | ");
    return lines || `${err.name}: ${err.message}`;
  }
  try {
    return typeof err === "string" ? err : JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * プロセスレベルの例外・シグナルハンドラを取り付ける。
 * 二重登録を避けるため、呼び出し側は起動時に 1 回だけ呼ぶこと。
 */
export function installProcessLifecycleHandlers(
  proc: ProcessLike,
  log: LifecycleLogger,
): void {
  proc.on("unhandledRejection", (reason: unknown) => {
    // 継続する。理由: 裏方の非同期処理 1 件の失敗で全 API を落とさない。
    log(`unhandledRejection (continuing): ${describeError(reason)}`);
  });

  proc.on("uncaughtException", (err: unknown) => {
    // 継続しない。同期例外がここまで来た時点でプロセスの状態は信用できない。
    // ただし黙って死なず、必ず理由を残してから終了する。
    log(`uncaughtException (exiting): ${describeError(err)}`);
    proc.exit(1);
  });

  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    proc.on(sig, () => {
      // 誰に殺されたかまでは OS が教えてくれないが、「シグナルで終わった」事実と
      // 種類は残す。Tauri 側の exit code=None と突き合わせれば経路が絞れる。
      log(`received ${sig} — exiting sidecar (pid=${proc.pid})`);
      proc.exit(0);
    });
  }

  proc.on("exit", (code: unknown) => {
    log(`process exit code=${String(code)}`);
  });
}
