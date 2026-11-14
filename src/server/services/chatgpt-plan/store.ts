// Sign in with ChatGPT の認証情報の保存（<dataDir>/chatgpt-plan/auth.json）
//
// v1 はアカウント 1 つ。トークンを含むので、一時ファイルに書いてから rename（原子的）、
// Unix ではファイル 0600・ディレクトリ 0700。壊れた JSON は警告して空として扱う。

import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "../../config/models.js";

export type ChatGptAccount = {
  email: string | null;
  /** ID トークンの sub（アカウントの識別子） */
  subject: string;
  /** 発行済みのクライアント ID（oaiapp_...） */
  clientId: string;
  idToken?: string;
  accessToken?: string;
  refreshToken?: string;
  /** アクセストークンの期限（ms epoch） */
  expiresAt?: number;
  earliestRefreshAt?: number;
  scopes?: string[];
  savedAt: number;
};

export type ChatGptAuthFile = {
  /** インストールごとの識別子（urn:uuid:...）。保存して使い回す */
  hostId: string;
  account: ChatGptAccount | null;
  /** 初回の案内を見た印 */
  welcomed?: boolean;
  /** 新規登録で発行されたが、まだサインインを完了できていないクライアント ID（次の承認で使う） */
  pendingClientId?: string;
};

function authDir(): string {
  return join(getDataDir(), "chatgpt-plan");
}

function authPath(): string {
  return join(authDir(), "auth.json");
}

function newHostId(): string {
  return `urn:uuid:${randomUUID()}`;
}

/**
 * 読み込む。ディスクへは書かない（hostId が無ければメモリ上で作る）。
 * - ENOENT は空
 * - JSON が壊れていれば auth.json.broken-<時刻> に退避してから空として始める（警告）
 * - それ以外の読み取りエラー（EACCES 等）は投げる（空として上書きしてしまわないため）
 */
function readFile(): ChatGptAuthFile {
  let raw: string;
  try {
    raw = readFileSync(authPath(), "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return { hostId: newHostId(), account: null };
    }
    throw e;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ChatGptAuthFile> | null;
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    const a = parsed.account;
    const account =
      a && typeof a === "object" && typeof a.subject === "string" && typeof a.clientId === "string"
        ? (a as ChatGptAccount)
        : null;
    return {
      hostId: typeof parsed.hostId === "string" && parsed.hostId ? parsed.hostId : newHostId(),
      account,
      ...(parsed.welcomed ? { welcomed: true } : {}),
      ...(typeof parsed.pendingClientId === "string" && parsed.pendingClientId ? { pendingClientId: parsed.pendingClientId } : {}),
    };
  } catch {
    const backup = `${authPath()}.broken-${Date.now()}`;
    console.warn("[chatgpt-plan] auth file is corrupted; moved it aside and starting empty");
    try {
      renameSync(authPath(), backup);
    } catch {
      // 退避できなくても、読めない中身で続行はしない
      throw new Error("The ChatGPT sign-in file is corrupted and could not be moved aside.");
    }
    return { hostId: newHostId(), account: null };
  }
}

function writeFile(data: ChatGptAuthFile): void {
  const dir = authDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dir, `auth.json.${process.pid}.${Date.now()}.tmp`);
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: "utf-8", mode: 0o600 });
    if (process.platform !== "win32") chmodSync(tmp, 0o600);
    renameSync(tmp, authPath());
  } catch (e) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // 後始末の失敗は無視
    }
    throw e;
  }
}

/** 現在の保存内容（読むだけ。書かない） */
export function loadAuth(): ChatGptAuthFile {
  return readFile();
}

/** 内容を保存する（hostId の初回保存など） */
export function persistAuth(data: ChatGptAuthFile): void {
  writeFile(data);
}

/** 読んで・変えて・書く。fn は新しい内容を返す */
export function updateAuth(fn: (current: ChatGptAuthFile) => ChatGptAuthFile): ChatGptAuthFile {
  const next = fn(loadAuth());
  writeFile(next);
  return next;
}

/** トークン類だけを消す。client_id・sub・email は残す（次回は再認可になる） */
export function withoutTokens(account: ChatGptAccount, opts: { keepIdToken?: boolean } = {}): ChatGptAccount {
  return {
    email: account.email,
    subject: account.subject,
    clientId: account.clientId,
    ...(opts.keepIdToken && account.idToken ? { idToken: account.idToken } : {}),
    savedAt: Date.now(),
  };
}
