// アプリの更新で同梱の MCP が差し替えられたら、古い版のプロセスを自分から終わらせる。
//
// MCP はクライアントのセッションごとに 1 本起動し、セッションが開いている限り動き続ける。
// アプリを更新しても、開いたままのセッションは古い版を使い続け、古いプロセスが溜まる。
// そこで、起動時に覚えた自分のファイル（graphium-mcp.mjs）の印と今の印を比べ、
// 変わっていたら、処理中の要求が無いときに終了する。クライアントは次に道具を呼んだとき、
// 新しい版で起動し直す（Claude Code / Claude Desktop で確認済み）。
//
// 応答の途中では落とさない: 受けた要求の数と返した応答の数を数え、0 件のときだけ終える。

import { statSync } from "node:fs";

/** ファイルの印。差し替え（アップデータによる置き換え）で、どれかが変わる */
export interface FileStamp {
  mtimeMs: number;
  size: number;
  ino: number;
}

export function stampOf(path: string): FileStamp | null {
  try {
    const s = statSync(path);
    return { mtimeMs: s.mtimeMs, size: s.size, ino: s.ino };
  } catch {
    return null;
  }
}

/** 起動時の印と今の印を比べる。ファイルが消えた（アンインストール等）ときも差し替え扱い */
export function isReplaced(start: FileStamp, now: FileStamp | null): boolean {
  if (!now) return true;
  return now.mtimeMs !== start.mtimeMs || now.size !== start.size || now.ino !== start.ino;
}

/**
 * 包む対象の最小の形（SDK の Transport の一部）。
 * メソッドの書き方にして、引数がより狭い型の SDK の transport も受け取れるようにする
 */
export interface TransportLike {
  onmessage?(message: unknown, extra?: unknown): void;
  send(message: unknown, options?: unknown): Promise<void>;
}

export interface ExitWhenReplacedOptions {
  /** 見張る自分のファイル。無い・読めないときは何もしない（dev 実行など） */
  scriptPath: string | undefined;
  /** 呼ばれていない間の見回りの間隔。既定 60 秒 */
  intervalMs?: number;
  /** 終了の仕方（応答を書き切ってから終える処理を index.ts が渡す） */
  exit: (reason: string) => void;
  /** 試験用の差し替え口 */
  stat?: (path: string) => FileStamp | null;
}

export interface ExitWhenReplacedHandle {
  /** 今の状態で終えてよいかを確かめ、よければ終える */
  check(): void;
  /** 見回りを止める */
  stop(): void;
  /** 処理中の要求の数（試験用） */
  inFlight(): number;
}

const isRequest = (m: unknown): boolean =>
  typeof m === "object" && m !== null && "id" in m && "method" in m;
const isResponse = (m: unknown): boolean =>
  typeof m === "object" && m !== null && "id" in m && ("result" in m || "error" in m);

/**
 * transport を包んで見張りを付ける。server.connect より前に呼ぶ
 * （connect が onmessage を差し込むので、その差し込みを横取りして数える）。
 */
export function installExitWhenReplaced(
  transport: TransportLike,
  opts: ExitWhenReplacedOptions,
): ExitWhenReplacedHandle {
  const stat = opts.stat ?? stampOf;
  const start = opts.scriptPath ? stat(opts.scriptPath) : null;
  let inFlight = 0;
  let done = false;

  const check = () => {
    if (done || !start || !opts.scriptPath || inFlight > 0) return;
    if (!isReplaced(start, stat(opts.scriptPath))) return;
    done = true;
    clearInterval(timer);
    opts.exit("replaced");
  };

  // 見張る印が無ければ、包まずに返す（動きを一切変えない）
  if (!start) {
    return { check() {}, stop() {}, inFlight: () => 0 };
  }

  // 受けた要求を数える（connect が入れる onmessage を包む）
  let inner: TransportLike["onmessage"];
  Object.defineProperty(transport, "onmessage", {
    configurable: true,
    enumerable: true,
    get: () =>
      inner &&
      ((message: unknown, extra?: unknown) => {
        if (isRequest(message)) inFlight += 1;
        inner?.(message, extra);
      }),
    set: (fn: TransportLike["onmessage"]) => {
      inner = fn;
    },
  });

  // 返した応答を数え、書き終えたら終えてよいかを確かめる
  const send = transport.send.bind(transport);
  transport.send = async (message: unknown, options?: unknown) => {
    await send(message, options);
    if (isResponse(message)) {
      inFlight = Math.max(0, inFlight - 1);
      check();
    }
  };

  const timer = setInterval(check, opts.intervalMs ?? 60_000);
  // 見回りのためだけにプロセスを生かし続けない
  timer.unref?.();

  return {
    check,
    stop: () => clearInterval(timer),
    inFlight: () => inFlight,
  };
}
