// knowledge-maintenance のテスト用ヘルパー（Map 実装のプロバイダと実行の組み立て）
import { vi } from "vitest";
import type { GraphiumDocument } from "../../lib/document-types";
import type { StorageProvider } from "../../lib/storage/types";
import type { MaintenanceOperation, MaintenanceRun, MaintenanceStorage } from "./types";

export function makeStorage(): MaintenanceStorage & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    // JSON を通して「書いた時点の値」を固定する（参照共有を避ける）
    readAppData: async (k) => (store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : null),
    writeAppData: async (k, v) => {
      store.set(k, JSON.parse(JSON.stringify(v)));
    },
    listAppDataKeys: async (prefix) => [...store.keys()].filter((k) => k.startsWith(prefix)),
    deleteAppData: async (k) => {
      store.delete(k);
    },
  };
}

export const UUID_A = "11111111-2222-3333-4444-555555555555";
export const UUID_B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
export const UUID_C = "01234567-89ab-cdef-0123-456789abcdef";

export function makeOp(over: Partial<MaintenanceOperation> & { id: string }): MaintenanceOperation {
  return {
    kind: "merge_topics",
    startedAt: "2026-10-01T00:00:00.000Z",
    related: [],
    pages: [],
    flags: [],
    status: "applied",
    ...over,
  };
}

export function makeRun(id: string, ops: MaintenanceOperation[], startedAt?: string): MaintenanceRun {
  return {
    formatVersion: 1,
    id,
    startedAt: startedAt ?? ops[0]?.startedAt ?? "2026-10-01T00:00:00.000Z",
    trigger: "merge_topics",
    actor: { via: "app" },
    operations: ops,
  };
}

// ---------------------------------------------------------------------------
// recorder / undo のテスト用: 偽の host（索引のフラグ・ページの内容・保存の成否を操作できる）
// ---------------------------------------------------------------------------

/** 1 段落だけの Wiki ドキュメント */
export function makeDoc(
  title: string,
  text: string,
  extra: Partial<GraphiumDocument> = {},
): GraphiumDocument {
  return {
    version: 6,
    title,
    pages: [
      {
        id: "p1",
        title,
        blocks: [{ id: "b1", type: "paragraph", content: [{ type: "text", text }] }],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    source: "ai",
    createdAt: "2026-01-01T00:00:00.000Z",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  } as unknown as GraphiumDocument;
}

export type FakeFlags = { deletedAt: string | null; archivedAt: string | null };

export function makeHost(opts: { startMs?: number } = {}) {
  const storage = makeStorage();
  const pages = new Map<string, GraphiumDocument>();
  const flags = new Map<string, FakeFlags>();
  /** 呼び出し順の記録（"write:<key>" / "save:<id>" / "flush:<id>" など） */
  const calls: string[] = [];
  let idSeq = 0;
  let clock = opts.startMs ?? Date.UTC(2026, 9, 5, 0, 0, 0);
  /** saveWikiFile の結果を先頭から順に使う（尽きたら通常どおり保存して true） */
  const saveResults: boolean[] = [];

  const rawWrite = storage.writeAppData;
  storage.writeAppData = async (k, v) => {
    calls.push(`write:${k}`);
    await rawWrite(k, v);
  };

  const nowIso = () => new Date(clock).toISOString();

  const host = {
    provider: () => storage as unknown as StorageProvider,
    flushEditors: vi.fn(async (id: string) => {
      calls.push(`flush:${id}`);
    }),
    loadWikiDocFresh: vi.fn(async (id: string) => {
      const d = pages.get(id);
      return d ? structuredClone(d) : null;
    }),
    getIndexFlags: vi.fn((id: string) => {
      const f = flags.get(id);
      return f ? { ...f } : null;
    }),
    saveWikiFile: vi.fn(async (id: string, doc: GraphiumDocument) => {
      calls.push(`save:${id}`);
      const forced = saveResults.shift();
      if (forced === false) return false;
      pages.set(id, structuredClone(doc));
      return true;
    }),
    trashWiki: vi.fn(async (id: string) => {
      calls.push(`trash:${id}`);
      const f = flags.get(id);
      if (f) f.deletedAt = nowIso();
    }),
    archiveWiki: vi.fn(async (id: string) => {
      calls.push(`archive:${id}`);
      const f = flags.get(id);
      if (f) f.archivedAt = nowIso();
    }),
    restoreWikiFlag: vi.fn(async (id: string, flag: "deletedAt" | "archivedAt") => {
      calls.push(`restore:${id}:${flag}`);
      const f = flags.get(id);
      if (f) f[flag] = null;
    }),
    // 呼ぶたびに 1 秒進める（実行のキーが重ならず、順序が決定的になる）
    now: vi.fn(() => new Date((clock += 1000))),
    newId: vi.fn(() => `00000000-0000-4000-8000-${String(++idSeq).padStart(12, "0")}`),
    sleep: vi.fn(async (_ms: number) => {}),
  };

  return {
    host,
    storage,
    pages,
    flags,
    calls,
    saveResults,
    /** ページと索引のフラグを用意する */
    addPage(id: string, doc: GraphiumDocument, f: Partial<FakeFlags> = {}) {
      pages.set(id, structuredClone(doc));
      flags.set(id, { deletedAt: null, archivedAt: null, ...f });
    },
    setClock(ms: number) {
      clock = ms;
    },
  };
}
