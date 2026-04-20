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

// 初期プロファイル（Crucible Agent から移行）
const SEED_PROFILES: Profile[] = [
  {
    id: "science",
    name: "science",
    description: "Scientific research assistant",
    content: [
      "You are a scientific research assistant.",
      "Help the user with scientific analysis, literature review, and experimental design.",
      "Be precise, cite sources when possible, and explain complex concepts clearly.",
      "When analyzing data or methods, consider reproducibility and statistical rigor.",
    ].join("\n"),
  },
  {
    id: "general",
    name: "general",
    description: "General-purpose assistant",
    content: [
      "You are a helpful assistant.",
      "Provide clear, concise, and accurate responses.",
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
  } catch {
    // ファイルが存在しない場合、seed データを書き込んで返す
    ensureDataDir();
    writeFileSync(
      profilesPath(),
      JSON.stringify(SEED_PROFILES, null, 2),
      "utf-8",
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
