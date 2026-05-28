// プロンプトプロファイル管理（JSON ファイル）
// Node モード: data/profiles.json に保存する
// Vercel モード: SEED_PROFILES を直接返す（ファイル I/O なし）

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import type { ServerMode } from "./models.js";

let serverMode: ServerMode = "node";

/** サーバーモードを設定する（Vercel ではファイル I/O を無効化） */
export function setServerMode(mode: ServerMode): void {
  serverMode = mode;
}

export type Profile = {
  id: string;
  name: string;
  description: string;
  content: string;
};

// 初期プロファイル
// "general" を default に置く。Graphium は特定ドメインに寄せず、ノート作成全般を支援する。
const SEED_PROFILES: Profile[] = [
  {
    id: "general",
    name: "general",
    description: "General-purpose note-taking assistant",
    content: [
      "You are a helpful assistant for the user's notes in Graphium.",
      "Help with whatever the user is thinking about: writing, planning, learning, debugging, summarizing, or organizing ideas.",
      "Stay concise and concrete. Ask back when the request is ambiguous instead of guessing.",
      "Do not assume any specific domain (research, business, personal, etc.) unless the user signals one.",
    ].join("\n"),
  },
  {
    id: "science",
    name: "science",
    description: "Scientific research assistant (optional)",
    content: [
      "You are a scientific research assistant.",
      "Help the user with scientific analysis, literature review, and experimental design.",
      "Be precise, cite sources when possible, and explain complex concepts clearly.",
      "When analyzing data or methods, consider reproducibility and statistical rigor.",
    ].join("\n"),
  },
];

let dataDir = join(process.cwd(), "data");

export function setDataDir(dir: string): void {
  dataDir = dir;
}

function profilesPath(): string {
  return join(dataDir, "profiles.json");
}

function ensureDataDir(): void {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}

function readProfiles(): Profile[] {
  // Vercel モードではファイル I/O を行わず SEED_PROFILES を直接返す
  if (serverMode === "vercel") return SEED_PROFILES;

  try {
    const raw = readFileSync(profilesPath(), "utf-8");
    return JSON.parse(raw) as Profile[];
  } catch (e) {
    const code = (e as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      // ファイル未作成 → seed を書き込んで返す
      try {
        ensureDataDir();
        writeFileSync(
          profilesPath(),
          JSON.stringify(SEED_PROFILES, null, 2),
          "utf-8",
        );
      } catch (writeErr) {
        // 書き込みも失敗（権限など）→ メモリ上の seed だけ返す
        console.warn(
          `[profiles] failed to seed ${profilesPath()}: ${
            writeErr instanceof Error ? writeErr.message : String(writeErr)
          }`,
        );
      }
      return SEED_PROFILES;
    }
    // 権限エラー・JSON 破損などは「登録したはずのプロファイルが消えた」を
    // 引き起こすサイレント故障になるため、必ず warn を残し seed を返す。
    console.warn(
      `[profiles] failed to read ${profilesPath()} (code=${code ?? "?"}): ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return SEED_PROFILES;
  }
}

export function listProfiles(): Profile[] {
  return readProfiles();
}

export function getProfile(id: string): Profile | undefined {
  return readProfiles().find((p) => p.id === id);
}
