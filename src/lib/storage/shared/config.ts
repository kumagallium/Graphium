// shared root / blob root の設定（localStorage に保存）
//
// 設計詳細: docs/internal/team-shared-storage-design.md §設定 UI
//
// 共有フォルダは複数登録できる（§26）。

const SHARED_AI_ENABLED_KEY = "graphium-shared-ai-enabled";
const SHARE_INCLUDE_PRIVATE_HISTORY_KEY = "graphium-share-include-private-history";

// ── 共有フォルダの一覧（§26） ──
//
// 共有フォルダは複数登録できる（例: 組織全体・部署 A）。名前は手元だけの呼び名で、
// 誰が読めるかは NAS / OS のフォルダ権限が決める（Graphium は権限を持たない）。
// 一覧の 1 件目が「既定の共有先」で、新しく共有するものはここへ置く。
//
// 旧形式（1 件だけの graphium-shared-root / -blob-root / -root-remote）は、
// 一覧のキーがまだ無いときに 1 件目として読み替える。一覧を書くときも 1 件目を
// 旧キーへ写し続ける（古い版に戻したときに共有フォルダが消えて見えないように）。

const SHARED_FOLDERS_KEY = "graphium-shared-folders";

export type SharedFolder = {
  /** 手元だけの識別子（端末ごとに違ってよい） */
  id: string;
  /** 範囲の名前（例: 組織全体・部署 A）。空なら画面では既定の呼び名を出す */
  name: string;
  /** 共有フォルダのパス */
  root: string;
  /** 大きなファイルの置き場（未設定なら null） */
  blobRoot: string | null;
  /** ネットワーク共有の接続先（smb://… / \\host\share）。再接続ボタンの行き先 */
  remote: string | null;
};

function readKey(key: string): string | null {
  try {
    const v = localStorage.getItem(key);
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string | null): void {
  try {
    if (value === null || value.trim() === "") localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* localStorage が使えない環境では持たないだけ */
  }
}

function newFolderId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

/** 1 件分の形を確かめる（壊れた値・知らない形は捨てる）。テストからも使う */
export function parseSharedFolders(raw: string | null): SharedFolder[] | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const out: SharedFolder[] = [];
    const seenRoots = new Set<string>();
    for (const v of parsed) {
      if (!v || typeof v !== "object") continue;
      const o = v as Record<string, unknown>;
      if (typeof o.root !== "string" || !o.root.trim()) continue;
      if (seenRoots.has(o.root)) continue; // 同じパスの二重登録は 1 件にまとめる
      seenRoots.add(o.root);
      out.push({
        id: typeof o.id === "string" && o.id ? o.id : newFolderId(),
        name: typeof o.name === "string" ? o.name : "",
        root: o.root,
        blobRoot: typeof o.blobRoot === "string" && o.blobRoot.trim() ? o.blobRoot : null,
        remote: typeof o.remote === "string" && o.remote.trim() ? o.remote : null,
      });
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * 登録済みの共有フォルダ（1 件目が既定の共有先）。未登録なら空配列。
 * 一覧のキーが無いときは旧形式の 1 件を読み替える（書き込みはしない — 読むだけで
 * 設定を変えない。次に一覧を保存したときに新形式になる）。
 */
export function getSharedFolders(): SharedFolder[] {
  const list = parseSharedFolders(readKey(SHARED_FOLDERS_KEY));
  if (list) return list;
  const root = readKey(LEGACY_SHARED_ROOT_KEY);
  if (!root) return [];
  return [
    {
      // 旧形式の 1 件目は id を固定する（読むたびに id が変わると、画面の選択状態が外れる）
      id: "legacy-default",
      name: "",
      root,
      blobRoot: readKey(LEGACY_BLOB_ROOT_KEY),
      remote: readKey(LEGACY_SHARED_ROOT_REMOTE_KEY),
    },
  ];
}

/** 一覧を保存する。1 件目は旧キーにも写す（古い版に戻しても既定の共有先は残る） */
export function setSharedFolders(folders: SharedFolder[]): void {
  const cleaned = parseSharedFolders(JSON.stringify(folders)) ?? [];
  writeKey(SHARED_FOLDERS_KEY, JSON.stringify(cleaned));
  const first = cleaned[0];
  writeKey(LEGACY_SHARED_ROOT_KEY, first?.root ?? null);
  // 0 件にしたときは置き場の控えを消さない（旧実装の setSharedRoot(null) も消さなかった。
  // 共有フォルダを選び直したときに引き継げるように）
  if (first) writeKey(LEGACY_BLOB_ROOT_KEY, first.blobRoot);
  writeKey(LEGACY_SHARED_ROOT_REMOTE_KEY, first?.remote ?? null);
}

/** 新しい共有フォルダの下書き（id を振っただけ。保存は setSharedFolders） */
export function createSharedFolder(root: string, name = ""): SharedFolder {
  return { id: newFolderId(), name, root, blobRoot: null, remote: null };
}

/** 既定の共有先（1 件目）。未登録なら null */
export function getDefaultSharedFolder(): SharedFolder | null {
  return getSharedFolders()[0] ?? null;
}

/** パスから登録済みの共有フォルダを引く（見つからなければ null） */
export function findSharedFolderByRoot(root: string | null | undefined): SharedFolder | null {
  if (!root) return null;
  return getSharedFolders().find((f) => f.root === root) ?? null;
}

/** 1 件だけ書き換える（id で特定）。見つからなければ何もしない */
export function updateSharedFolder(id: string, patch: Partial<Omit<SharedFolder, "id">>): void {
  const list = getSharedFolders();
  const i = list.findIndex((f) => f.id === id);
  if (i < 0) return;
  list[i] = { ...list[i], ...patch };
  setSharedFolders(list);
}

const LEGACY_SHARED_ROOT_KEY = "graphium-shared-root";
const LEGACY_BLOB_ROOT_KEY = "graphium-shared-blob-root";
const LEGACY_SHARED_ROOT_REMOTE_KEY = "graphium-shared-root-remote";

/**
 * 既定の共有先のパス（未登録なら null）。
 * 新しく共有するものの置き場所。エントリに対する操作（再共有・コメント・提案・引用）は
 * そのエントリがあるフォルダを使うこと（shared-library-store の getSharedEntryRoot）。
 */
export function getSharedRoot(): string | null {
  return getDefaultSharedFolder()?.root ?? null;
}

/**
 * 既定の共有先のパスを差し替える（null で既定の共有先を外す）。
 * 1 件だけ使っていた頃の画面・テストのための入口。一覧を直接扱う画面は setSharedFolders を使う。
 */
export function setSharedRoot(path: string | null): void {
  const list = getSharedFolders();
  if (path === null || path.trim() === "") {
    setSharedFolders(list.slice(1));
    return;
  }
  if (list.length === 0) {
    setSharedFolders([{ ...createSharedFolder(path), blobRoot: readKey(LEGACY_BLOB_ROOT_KEY) }]);
    return;
  }
  // パスが変われば別の共有なので、控えてある接続先も捨てる（再接続で古い NAS を開かない）
  list[0] = { ...list[0], root: path, remote: list[0].root === path ? list[0].remote : null };
  setSharedFolders(list);
}

/**
 * 共有フォルダを載せているネットワーク共有の接続先（macOS: `smb://…`、Windows: `\\host\share`）。
 * マウントが外れた後に Finder / エクスプローラーへ再接続を頼むために使う。
 * 繋がっている間にしか分からない値なので、読み込みに成功したときに控えておく。
 * root を省くと既定の共有先の値。
 */
export function getSharedRootRemote(root?: string): string | null {
  const folder = root ? findSharedFolderByRoot(root) : getDefaultSharedFolder();
  return folder?.remote ?? null;
}

export function setSharedRootRemote(remote: string | null, root?: string): void {
  const folder = root ? findSharedFolderByRoot(root) : getDefaultSharedFolder();
  if (!folder) return;
  const next = remote && remote.trim() ? remote : null;
  if (folder.remote === next) return;
  updateSharedFolder(folder.id, { remote: next });
}

/**
 * 大きなファイルの置き場。root を渡すとその共有フォルダの値、省くと既定の共有先の値。
 * 未設定なら null（共有フォルダの中へ自動で作る運用は混乱するので、ここでは持たない）。
 */
export function getBlobRoot(root?: string | null): string | null {
  if (root) return findSharedFolderByRoot(root)?.blobRoot ?? null;
  const folder = getDefaultSharedFolder();
  // 共有フォルダが 0 件のときは、控えてある置き場（旧キー）を返す（選び直したときに引き継ぐ）
  return folder ? folder.blobRoot : readKey(LEGACY_BLOB_ROOT_KEY);
}

/** 既定の共有先の大きなファイルの置き場を差し替える（null で外す） */
export function setBlobRoot(path: string | null): void {
  const folder = getDefaultSharedFolder();
  if (!folder) {
    // 共有フォルダより先に置き場だけ選ばれた場合は、旧キーに控えておく（1 件だけの頃と同じ）
    writeKey(LEGACY_BLOB_ROOT_KEY, path);
    return;
  }
  updateSharedFolder(folder.id, { blobRoot: path && path.trim() ? path : null });
}

/**
 * 共有ライブラリのエントリを ⌘K・AI チャットの対象に含めるか（既定 true）。
 *
 * 既定を ON にしているのは、共有ルートを設定すること自体がオプトインだから
 * （フォルダを繋いだ人は共有物を使いたい人）。OFF にすると手元の索引から
 * 共有分だけが消える（共有フォルダには元々何も書いていない）。
 */
export function getSharedAiEnabled(): boolean {
  try {
    // 未設定（null）は既定 ON。明示的に "0" を書いたときだけ OFF
    return localStorage.getItem(SHARED_AI_ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setSharedAiEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SHARED_AI_ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    /* localStorage が使えない環境では既定 ON のまま */
  }
}

/**
 * 共有コピーに AI チャット（`chats`）と編集来歴（`documentProvenance`）を
 * 含めるか（既定 false）。
 *
 * 既定を OFF にしているのは、共有が「本文を見せる」操作であって
 * 「作業の過程を見せる」操作ではないから。学生が先生に共有する場面で、
 * 試行錯誤のチャットや編集の記録まで一緒に渡るのは意図と違う。
 * 過程も見せたい人は設定でオンにできる。
 */
export function getShareIncludesPrivateHistory(): boolean {
  try {
    // 未設定（null）は既定 OFF。明示的に "1" を書いたときだけ ON
    return localStorage.getItem(SHARE_INCLUDE_PRIVATE_HISTORY_KEY) === "1";
  } catch {
    return false;
  }
}

export function setShareIncludesPrivateHistory(include: boolean): void {
  try {
    localStorage.setItem(SHARE_INCLUDE_PRIVATE_HISTORY_KEY, include ? "1" : "0");
  } catch {
    /* localStorage が使えない環境では既定 OFF のまま */
  }
}

/**
 * 共有フォルダの表示名（範囲）。名前が空ならパスの最後の部分を使う
 * （「/Volumes/Lab/Shared」→「Shared」）。画面の範囲列・絞り込み・案内で同じ値を使うためのもの。
 */
export function sharedFolderLabel(folder: Pick<SharedFolder, "name" | "root">): string {
  const name = folder.name.trim();
  if (name) return name;
  const parts = folder.root.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? folder.root;
}

/**
 * 共有解除のときに「使われなくなった大きなファイル」を片付けてよい置き場。
 * 片付けは同じ共有フォルダの中の参照しか数えないので、別の共有フォルダと置き場を
 * 共有していると、そちらのエントリがまだ使っているファイルまで消してしまう。
 * 他のフォルダと同じ置き場なら null（片付けをしない。残すほうが安全）。
 */
export function getBlobRootForCleanup(root: string | null | undefined): string | null {
  const blobRoot = getBlobRoot(root);
  if (!blobRoot || !root) return blobRoot;
  const sharedWithOthers = getSharedFolders().some((f) => f.root !== root && f.blobRoot === blobRoot);
  return sharedWithOthers ? null : blobRoot;
}
