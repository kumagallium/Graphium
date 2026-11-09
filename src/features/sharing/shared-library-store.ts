// 共有ライブラリの単一の入口（モジュール単位のシングルトン）
//
// なぜ作ったか:
//   Library ビュー・引用ピッカー・語彙索引・埋め込みが、それぞれ独立に
//   loadAllSharedEntries で共有ルートを全件読みしていた。読む主体が増えるほど
//   同じフォルダを何度も舐め、しかも「共有した／解除した」の反映タイミングが
//   画面ごとにバラバラになる。読みを 1 本にまとめ、変化は
//   notifySharedLibraryChanged() の通知 1 本で表す。
//
// 設計:
//   - lexicalSearch サービスと同じ作法のシングルトン（React に依存しない本体 +
//     useSyncExternalStore の薄いフック）
//   - refresh は進行中の Promise を共有して重複読みを防ぐ。読んでいる最中に
//     変化通知が来たら、終わってからもう一度だけ読み直す（取りこぼし防止）
//   - readSharedEntryBody は `id|hash` をキーに小さな LRU で本文を持つ。
//     語彙索引・埋め込み・プレビューが同じ本文を続けて読むため
//   - hash が合わなかった id は mismatched に貯める（設定の索引カードで見せる）
//   - 本文を読んだついでに拾える値（フォルダ）は derived に貯め、localStorage に
//     残す。一覧は本文を読まずに描くので、読めた分だけ表に出せるようにする
//     （新しい読み取りは足さない — 語彙索引レーンが読む経路に相乗りする）

import { useSyncExternalStore } from "react";
import {
  LocalFolderSharedProvider,
  getSharedFolders,
  rememberSharedRootRemote,
  type SharedEntry,
  type SharedEntryContent,
  type SharedEntryType,
} from "../../lib/storage/shared";
import { computeSharedEntryHash } from "../../lib/storage/shared/hash";
import { isTauri } from "../../lib/platform";
import { loadAllSharedEntries, type SharedLibraryLoadResult } from "./shared-library-loader";
import { extractSharedDerivedMeta, type SharedDerivedMeta } from "./shared-entry-source";

/** 本文由来のメタを id ごとに覚えたもの。hash はそれを読んだときのエントリの hash */
export type SharedDerivedMetaMap = Record<string, SharedDerivedMeta & { hash: string }>;

export type SharedLibrarySnapshot = {
  /**
   * 既定の共有先（登録した共有フォルダの 1 件目。未設定 / 非デスクトップなら null）。
   * 新しく共有するものの置き場所。エントリの置き場所は entryRoots で引く
   */
  root: string | null;
  /** 読み出した共有フォルダのパス（登録順。1 件目 = root） */
  roots: string[];
  /** エントリ id → そのエントリがある共有フォルダのパス */
  entryRoots: Record<string, string>;
  /**
   * 既定の共有先以外で読めなかった共有フォルダ（パス → 理由）。
   * 既定の共有先のエラーは従来どおり errors に type ごとに入る（届かないときの案内もそちら）
   */
  folderErrors: Record<string, string>;
  /** 全 type の active エントリ（type ごとに updated_at 降順） */
  entries: SharedEntry[];
  /** type 単位の読み出しエラー */
  errors: Partial<Record<SharedEntryType, string>>;
  /** 最後に読み終えた時刻（未読なら null） */
  loadedAt: string | null;
  loading: boolean;
  /** 本文の hash が entry.hash と合わなかったエントリ id */
  mismatched: string[];
  /**
   * 本文を読んだときに拾えた派生メタ（id → 値）。
   * `extra` に情報が無い古い共有エントリを補うための控えで、hash が変わったら
   * 古い値は使わない（読み直せば入れ替わる）。
   */
  derived: SharedDerivedMetaMap;
};

export type SharedLibraryLoader = (root: string) => Promise<SharedLibraryLoadResult>;

/** 共有フォルダ 1 件の読み出し結果（落ちたときは error だけ） */
type FolderLoad = { root: string; result: SharedLibraryLoadResult | null; error: string | null };
/** provider.read 相当（テストで差し替える） */
export type SharedEntryReader = (root: string, id: string) => Promise<SharedEntryContent>;

/** 本文キャッシュの上限（件）。プレビュー用の本文が数 MB になることもあるので小さく保つ */
const BODY_CACHE_LIMIT = 64;

/** 派生メタの保存先。本文と違って 1 件が数十バイトなので localStorage で足りる */
const DERIVED_META_KEY = "graphium-shared-derived-meta";

const EMPTY: SharedLibrarySnapshot = {
  root: null,
  roots: [],
  entryRoots: {},
  folderErrors: {},
  entries: [],
  errors: {},
  loadedAt: null,
  loading: false,
  mismatched: [],
  derived: {},
};

/**
 * localStorage の中身を派生メタとして読む（形が違うものは黙って捨てる）。
 * 壊れた JSON・旧形式でも一覧が落ちてはいけないので、1 件ずつ形を確かめる。
 * テストからも使えるよう export している。
 */
export function parseDerivedMetaStore(raw: string | null): SharedDerivedMetaMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: SharedDerivedMetaMap = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const { hash, noteContexts } = value as { hash?: unknown; noteContexts?: unknown };
      if (typeof hash !== "string" || !hash) continue;
      if (!Array.isArray(noteContexts)) continue;
      out[id] = { hash, noteContexts: noteContexts.filter((c): c is string => typeof c === "string") };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * 全 SharedEntryType。satisfies で Record を要求しているので、type が増えたら
 * ここが型エラーになって気づける。
 */
const ALL_ENTRY_TYPES = Object.keys({
  note: 0,
  reference: 0,
  "data-manifest": 0,
  template: 0,
  knowledge: 0,
  report: 0,
  comment: 0,
  proposal: 0,
} satisfies Record<SharedEntryType, number>) as SharedEntryType[];

function readPersistedDerivedMeta(): SharedDerivedMetaMap {
  try {
    return parseDerivedMetaStore(localStorage.getItem(DERIVED_META_KEY));
  } catch {
    // localStorage が使えない環境（プライベートモード等）では控えを持たないだけ
    return {};
  }
}

function persistDerivedMeta(map: SharedDerivedMetaMap): void {
  try {
    localStorage.setItem(DERIVED_META_KEY, JSON.stringify(map));
  } catch {
    /* 容量超過・無効化。控えなので落とさない */
  }
}

/** type ごとの配列を「note → reference → data-manifest → template → knowledge → report」の順に平坦化する */
function flatten(result: SharedLibraryLoadResult): SharedEntry[] {
  return Object.values(result.entries).flat();
}

class SharedLibraryStore {
  private snapshot: SharedLibrarySnapshot = EMPTY;
  private listeners = new Set<() => void>();
  private inFlight: Promise<SharedLibrarySnapshot> | null = null;
  /** 読み出し中に来た変更通知（終わったらもう一度読む） */
  private staleWhileLoading = false;
  private loaderOverride: SharedLibraryLoader | null = null;
  private readerOverride: SharedEntryReader | null = null;
  private rootOverride: string[] | undefined = undefined;
  /** `${id}|${hash}` → 本文（LRU: Map の挿入順を使う） */
  private bodyCache = new Map<string, { body: Uint8Array; verified: boolean }>();

  constructor() {
    // 起動時に前回までに読めた派生メタを復元する（一覧を開いた直後から列が埋まる）
    this.snapshot = { ...EMPTY, derived: readPersistedDerivedMeta() };
  }

  getSnapshot = (): SharedLibrarySnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit(patch: Partial<SharedLibrarySnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        /* 購読側の例外で他の購読者を止めない */
      }
    }
  }

  /**
   * 登録した共有フォルダのパス（登録順）。デスクトップ（Tauri）以外では常に空
   * （共有はローカルフォルダの読み書きが前提）。
   */
  currentRoots(): string[] {
    if (this.rootOverride !== undefined) return this.rootOverride;
    if (!isTauri()) return [];
    return getSharedFolders()
      .map((f) => f.root)
      .filter((r) => r && r.trim());
  }

  /** 既定の共有先（1 件目）。未設定なら null */
  currentRoot(): string | null {
    return this.currentRoots()[0] ?? null;
  }

  /** エントリがある共有フォルダ。まだ読めていなければ null */
  rootOf(id: string): string | null {
    return this.snapshot.entryRoots[id] ?? null;
  }

  async refresh(): Promise<SharedLibrarySnapshot> {
    const roots = this.currentRoots();
    const root = roots[0] ?? null;
    if (!root) {
      // ルートが外れたら本文キャッシュも捨てる（別ルートの本文を返さない）
      this.bodyCache.clear();
      this.emit({ ...EMPTY, loadedAt: this.snapshot.loadedAt });
      return this.snapshot;
    }
    if (this.inFlight) return this.inFlight;
    const load = this.loaderOverride ?? loadAllSharedEntries;
    this.emit({ loading: true });
    this.inFlight = (async () => {
      try {
        // 共有フォルダは互いに独立なので並べて読む。1 つが届かなくても他は出す
        const loads: FolderLoad[] = await Promise.all(
          roots.map(async (r) => {
            try {
              return { root: r, result: await load(r), error: null };
            } catch (e) {
              return { root: r, result: null, error: e instanceof Error ? e.message : String(e) };
            }
          }),
        );
        const entries: SharedEntry[] = [];
        const entryRoots: Record<string, string> = {};
        const folderErrors: Record<string, string> = {};
        let errors: Partial<Record<SharedEntryType, string>> = {};
        for (const [i, l] of loads.entries()) {
          // 実ローダーは type ごとに try/catch するので、フォルダに届かなくても throw せず
          // 「全 type がエラー」で返ってくる。これも丸ごと読めなかったものとして扱う
          if (l.result && ALL_ENTRY_TYPES.every((type) => l.result!.errors[type])) {
            l.error = Object.values(l.result.errors).find((m): m is string => !!m) ?? "";
            l.result = null;
          }
          if (!l.result) {
            if (i === 0) {
              // 既定の共有先が丸ごと読めないときは、従来どおり全 type に同じ理由を立てる
              // （type ごとにエラーを出す画面のタブが嘘をつかないように）
              for (const type of ALL_ENTRY_TYPES) errors[type] = l.error ?? "";
            } else {
              folderErrors[l.root] = l.error ?? "";
            }
            // 前回読めていた分は残す（一時的なマウント外れで一覧や索引から消さない）
            for (const e of this.snapshot.entries) {
              if (this.snapshot.entryRoots[e.id] !== l.root || entryRoots[e.id]) continue;
              entryRoots[e.id] = l.root;
              entries.push(e);
            }
            continue;
          }
          const typeErrors = Object.values(l.result.errors).filter((m): m is string => !!m);
          if (i === 0) errors = l.result.errors;
          else if (typeErrors.length > 0) folderErrors[l.root] = typeErrors[0];
          for (const e of flatten(l.result)) {
            // 同じ id が 2 つのフォルダにあるとき（同じ共有を別名で二重登録した等）は先の方を採る
            if (entryRoots[e.id]) continue;
            entryRoots[e.id] = l.root;
            entries.push(e);
          }
          // 届いている今のうちに、どのサーバーの共有かを控える（マウントが外れたときの
          // 「再接続」ボタンの行き先）。失敗しても読み込みには影響しない
          if (typeErrors.length === 0) void rememberSharedRootRemote(l.root);
        }
        const alive = new Set(entries.map((e) => e.id));
        // 1 つも読めなかったときは「読み終えた時刻」を進めない（索引側が空一覧で走らないため）
        const anyLoaded = loads.some((l) => l.result !== null);
        this.emit({
          root,
          roots,
          entries,
          entryRoots,
          folderErrors,
          errors,
          loadedAt: anyLoaded ? new Date().toISOString() : this.snapshot.loadedAt,
          loading: false,
          // 消えたエントリの不一致記録は持ち越さない
          mismatched: this.snapshot.mismatched.filter((id) => alive.has(id)),
          // 共有から消えた id の派生メタも同様に落とす（控えが無限に育たないように）
          derived: this.pruneDerived(alive),
        });
      } finally {
        this.inFlight = null;
      }
      return this.snapshot;
    })();
    const done = await this.inFlight;
    // 読んでいる間に共有・共有解除が起きていたら、もう一度だけ読み直す
    if (this.staleWhileLoading) {
      this.staleWhileLoading = false;
      return this.refresh();
    }
    return done;
  }

  notifyChanged(): void {
    if (this.inFlight) {
      this.staleWhileLoading = true;
      return;
    }
    void this.refresh();
  }

  async readBody(entry: SharedEntry): Promise<{ body: Uint8Array; verified: boolean }> {
    const key = `${entry.id}|${entry.hash}`;
    const cached = this.bodyCache.get(key);
    if (cached) {
      // LRU: 触ったものを末尾へ
      this.bodyCache.delete(key);
      this.bodyCache.set(key, cached);
      return cached;
    }
    // エントリがあるフォルダから読む（まだ一覧を読んでいなければ既定の共有先）
    const root = this.rootOf(entry.id) ?? this.currentRoot();
    if (!root) throw new Error("shared root is not configured");
    const read = this.readerOverride ?? ((r: string, id: string) => new LocalFolderSharedProvider(r).read(id));
    const content = await read(root, entry.id);
    // hash は「読み出したメタデータ + 本体」から計算し、こちらが持っている
    // entry.hash（索引の fingerprint に使う値）と突き合わせる。
    // 読んでいる間に上書きされた場合もここで不一致として落ちる（次の refresh で拾い直す）
    const actual = await computeSharedEntryHash(content.entry, content.body);
    const verified = actual === entry.hash;
    const value = { body: content.body, verified };
    this.bodyCache.set(key, value);
    while (this.bodyCache.size > BODY_CACHE_LIMIT) {
      const oldest = this.bodyCache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.bodyCache.delete(oldest);
    }
    this.setMismatched(entry.id, !verified);
    // 本文を読んだこの経路にだけ相乗りして派生メタを更新する（読み取りは増やさない）
    this.recordDerivedMeta(entry, content.body, verified);
    return value;
  }

  /** 共有から消えた id を落とした派生メタを返す（変化が無ければ同じ参照） */
  private pruneDerived(alive: Set<string>): SharedDerivedMetaMap {
    const current = this.snapshot.derived;
    const ids = Object.keys(current);
    const kept = ids.filter((id) => alive.has(id));
    if (kept.length === ids.length) return current;
    const next: SharedDerivedMetaMap = {};
    for (const id of kept) next[id] = current[id];
    persistDerivedMeta(next);
    return next;
  }

  private recordDerivedMeta(entry: SharedEntry, body: Uint8Array, verified: boolean): void {
    const meta = extractSharedDerivedMeta(entry, body, verified);
    if (!meta) return;
    const prev = this.snapshot.derived[entry.id];
    if (
      prev &&
      prev.hash === entry.hash &&
      prev.noteContexts.length === meta.noteContexts.length &&
      prev.noteContexts.every((c, i) => c === meta.noteContexts[i])
    ) {
      return; // 同じ値なら再描画を起こさない
    }
    const next: SharedDerivedMetaMap = {
      ...this.snapshot.derived,
      [entry.id]: { hash: entry.hash, ...meta },
    };
    persistDerivedMeta(next);
    this.emit({ derived: next });
  }

  private setMismatched(id: string, bad: boolean): void {
    const has = this.snapshot.mismatched.includes(id);
    if (bad === has) return;
    this.emit({
      mismatched: bad ? [...this.snapshot.mismatched, id] : this.snapshot.mismatched.filter((x) => x !== id),
    });
  }

  __setForTest(
    loader: SharedLibraryLoader | null,
    options: { root?: string | null; roots?: string[]; reader?: SharedEntryReader | null } = {},
  ): void {
    this.loaderOverride = loader;
    this.readerOverride = options.reader ?? null;
    this.rootOverride =
      "roots" in options && options.roots
        ? options.roots
        : "root" in options
          ? options.root
            ? [options.root]
            : []
          : undefined;
    this.inFlight = null;
    this.staleWhileLoading = false;
    this.bodyCache.clear();
    this.snapshot = EMPTY;
    this.listeners.clear();
    // 派生メタの控えもテストごとに捨てる（前のテストの値が次に漏れないように）
    try {
      localStorage.removeItem(DERIVED_META_KEY);
    } catch {
      /* localStorage が無い環境 */
    }
  }
}

const store = new SharedLibraryStore();

/** 現在のスナップショット（React 外からも読める） */
export function getSharedLibrarySnapshot(): SharedLibrarySnapshot {
  return store.getSnapshot();
}

/**
 * 共有ルートを読み直す。進行中なら同じ Promise を返す（重複読み防止）。
 * ルート未設定・非デスクトップでは空スナップショットになる。
 */
export function refreshSharedLibrary(): Promise<SharedLibrarySnapshot> {
  return store.refresh();
}

export function subscribeSharedLibrary(listener: () => void): () => void {
  return store.subscribe(listener);
}

/**
 * 共有ライブラリが変わったことを知らせる（共有・共有解除・一括共有・素材共有の完了後、
 * Library の再読み込みボタン、共有ルート／スイッチの変更時）。
 * ここが唯一の通知経路で、購読側（Library・引用ピッカー・語彙索引の追従）が反応する。
 */
export function notifySharedLibraryChanged(): void {
  store.notifyChanged();
}

/**
 * エントリ本文を読む。`entry.hash` と読み出した内容の hash を突き合わせ、
 * 一致したかを verified で返す（不一致でも本文は返す — 表示はできる）。
 */
export function readSharedEntryBody(entry: SharedEntry): Promise<{ body: Uint8Array; verified: boolean }> {
  return store.readBody(entry);
}

/**
 * 共有エントリのフォルダ（共有した時点の noteContexts）を引く唯一のヘルパー。
 * 表・検索・詳細のどこから見ても同じ値になるよう、優先順位をここ 1 か所に閉じる:
 *   1. `extra.noteContexts`（共有時に書かれたもの。文字列配列のときだけ採る）
 *   2. 本文から拾った派生メタ（hash が一致するときだけ。古い共有エントリの補完）
 *   3. 空配列（＝未分類）
 */
export function getSharedNoteContexts(entry: SharedEntry, snapshot: SharedLibrarySnapshot): string[] {
  const raw = (entry.extra as Record<string, unknown> | undefined)?.noteContexts;
  if (Array.isArray(raw)) return raw.filter((c): c is string => typeof c === "string" && c.trim() !== "");
  const derived = snapshot.derived[entry.id];
  // hash が違う＝別の版を読んだときの値。表示に使うと嘘になるので捨てる
  if (derived && derived.hash === entry.hash) return derived.noteContexts;
  return [];
}

/** 既定の共有先（デスクトップかつ設定済みのときだけ非 null） */
export function getSharedLibraryRoot(): string | null {
  return store.currentRoot();
}

/**
 * エントリがある共有フォルダのパス。再共有・共有解除・コメント・提案・引用・複製など、
 * 既にあるエントリに対する操作はこれを使う（既定の共有先とは限らない）。
 * まだ一覧を読んでいない id は既定の共有先を返す（1 件だけ登録している人は従来どおり）。
 */
export function getSharedEntryRoot(id: string | null | undefined): string | null {
  if (id) {
    const r = store.rootOf(id);
    if (r) return r;
  }
  return store.currentRoot();
}

/**
 * 自分の共有コピー（sharedRef.id）を更新するときの書き込み先。
 *   - 一覧にある → そのエントリがあるフォルダ
 *   - 一覧に無い・読めなかったフォルダが無い → 既定の共有先（まだ共有していない / 1 件だけの人は従来どおり）
 *   - 一覧に無い・読めなかったフォルダがある → null（別のフォルダに共有コピーがあるかもしれないので、
 *     既定の共有先へ新しく書かず失敗させる。呼び出し側は share.failed.folderUnreachable を出す）
 */
export function resolveOwnCopyRoot(id: string, defaultRoot: string | null = store.currentRoot()): string | null {
  const snap = store.getSnapshot();
  const known = snap.entryRoots[id];
  if (known) return known;
  if (Object.keys(snap.folderErrors).length > 0) return null;
  return defaultRoot;
}

/**
 * エントリの置き場所を引く前に、一覧を読み終えておく。
 * 共有フォルダが 2 件以上あるときだけ意味がある（1 件なら読まなくても置き場所は決まる）。
 * まだ一度も読んでいない・読んでいる途中・登録が変わった直後は、読み終えるまで待つ。
 * これをしないと、起動直後に既定の共有先へ倒れて、引用を「見つからない」と誤判定したり、
 * 別フォルダにある自分の共有コピーを既定の共有先へ二重に作ったりする。
 */
export async function ensureSharedEntryRoots(): Promise<void> {
  const roots = store.currentRoots();
  if (roots.length <= 1) return;
  const snap = store.getSnapshot();
  const sameRoots = snap.roots.length === roots.length && snap.roots.every((r, i) => r === roots[i]);
  if (snap.loadedAt !== null && !snap.loading && sameRoots) return;
  await store.refresh();
}

/** getSharedEntryRoot の、一覧を読み終えてから引く版（書き込み・引用の解決はこちら） */
export async function resolveSharedEntryRoot(id: string | null | undefined): Promise<string | null> {
  await ensureSharedEntryRoots();
  return getSharedEntryRoot(id);
}

/** React 用。スナップショットは変化時だけ差し替わるので参照比較で足りる */
export function useSharedLibrary(): SharedLibrarySnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** type ごとに束ね直す（Library ビューのタブ用。ローダーの並び順を保つ） */
export function groupSharedEntriesByType(entries: SharedEntry[]): Record<SharedEntryType, SharedEntry[]> {
  const out: Record<SharedEntryType, SharedEntry[]> = {
    note: [],
    reference: [],
    "data-manifest": [],
    template: [],
    knowledge: [],
    report: [],
    comment: [],
    proposal: [],
  };
  for (const e of entries) out[e.type]?.push(e);
  return out;
}

/** テスト / Storybook 用: ローダー・ルート・本文リーダーを差し替えて状態を初期化する */
export function __setSharedLibraryLoaderForTest(
  loader: SharedLibraryLoader | null,
  options: { root?: string | null; roots?: string[]; reader?: SharedEntryReader | null } = {},
): void {
  store.__setForTest(loader, options);
}
