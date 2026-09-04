// 共有ライブラリを語彙索引の第 3 レーン（kind: "shared"）に追従させる React フック
//
// 配線の考え方（ノート / 素材のレーンと同じ）:
// - 「望ましい一覧」は共有ストアのスナップショットから導く。共有・共有解除・
//   一括共有・素材共有はすべて notifySharedLibraryChanged() を呼ぶので、
//   ここは通知 1 本を見ていればよい（個別ハンドラにフックを撒かない）
// - 本文は readSharedEntryBody（hash 照合つき・LRU キャッシュ）で読む。
//   hash が合わないものは空で索引し、hash が変わるまで再試行しない
// - スイッチ OFF・共有ルート未設定なら desired を空にして reconcile する。
//   索引から共有分だけが消える（旧ルートの残留もこれで掃除される）
//
// reconcile のあとに共有ナレッジの埋め込み（shared-embeddings）も同じ入口から揃える。
// 索引も埋め込みも手元（IndexedDB）にしか作らない。共有フォルダには一切書かない。

import { useEffect, useRef } from "react";
import { getSharedAiEnabled } from "../../lib/storage/shared";
import type { SharedEntry } from "../../lib/storage/shared";
import {
  currentScopeKey,
  desiredSharedSources,
  lexicalSearch,
  useLexicalStatus,
  type DesiredSource,
  type SourceLoader,
} from "../lexical-search";
import {
  getSharedLibraryRoot,
  readSharedEntryBody,
  refreshSharedLibrary,
  useSharedLibrary,
} from "./shared-library-store";
import { parseSharedBody, sharedEntryToSourceInput } from "./shared-entry-source";
import {
  loadSharedProjection,
  pruneSharedProjection,
  recordSharedProjectionFromBody,
} from "./shared-projection";
import { syncSharedKnowledgeEmbeddings } from "./shared-embeddings";

/** 共有ストアが動いてから reconcile を走らせるまでの待ち（連続した共有操作を 1 回にまとめる） */
const SHARED_RECONCILE_DEBOUNCE_MS = 1500;

export type SharedLibrarySyncParams = {
  /** サインイン済みか。false の間は何もしない（索引のスコープが決まらない） */
  authenticated: boolean;
  /** 無効化したいとき（Storybook 等） */
  disabled?: boolean;
};

export function useSharedLibrarySync(params: SharedLibrarySyncParams): void {
  const { authenticated, disabled } = params;
  const snapshot = useSharedLibrary();
  // reset（索引の作り直し）で世代が進んだら reconcile をやり直す
  const generation = useLexicalStatus().generation;
  const aiEnabled = getSharedAiEnabled();
  const entriesRef = useRef<SharedEntry[]>(snapshot.entries);
  entriesRef.current = snapshot.entries;

  // 1. 起動時に 1 回だけ共有ルートを読む（以後は notifySharedLibraryChanged 経由）
  useEffect(() => {
    if (disabled || !authenticated) return;
    void refreshSharedLibrary();
    // ラベル・プロセスの投影も手元の控えから先に戻す。版が合わなければ捨てられ、
    // 本文を読み直したときに投影し直される（再構築可能なキャッシュ）
    void loadSharedProjection();
  }, [disabled, authenticated]);

  // 2. スナップショット / スイッチの変化に追従して索引を合わせる。
  //    mismatched の増減では動かしたくないので、依存は「いつ読んだか」に絞る
  const scopeKey = authenticated ? currentScopeKey() : null;
  const syncKey = `${snapshot.root ?? ""}|${snapshot.loadedAt ?? ""}|${aiEnabled ? 1 : 0}`;
  // 共有ルートが設定されているのに一度も読み終えていない間は reconcile しない。
  // ここで空一覧を渡すと、前回セッションから IndexedDB に残っている shared の索引が
  // removeMissing で全部消え、読み終えた直後に fingerprint 一致による再索引スキップが
  // 効かなくなって全件を読み直すことになる（その間は ⌘K・AI から共有分が消える）。
  // ノート／素材のレーンが noteIndex / mediaIndex の到着まで reconcile を仕掛けないのと
  // 同じ考え方。スイッチ OFF・ルート未設定のときは「消すこと」自体が目的なので待たない。
  const waitingForFirstLoad = aiEnabled && getSharedLibraryRoot() !== null && snapshot.loadedAt === null;
  useEffect(() => {
    if (disabled || !scopeKey || waitingForFirstLoad) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        await lexicalSearch.ensureLoaded(scopeKey);
      } catch {
        return;
      }
      if (cancelled) return;
      // OFF / ルート未設定なら空一覧で reconcile → 共有分が索引から消える
      const entries = aiEnabled ? entriesRef.current : [];
      const desired = desiredSharedSources(entries);
      const byId = new Map(entries.map((e) => [e.id, e] as const));
      const loader: SourceLoader = async (d: DesiredSource) => {
        const entry = byId.get(d.sourceId);
        if (!entry) return null;
        try {
          const { body, verified } = await readSharedEntryBody(entry);
          // 本文の JSON.parse は本文が大きいほど効く。投影と語彙索引がそれぞれ
          // 同じ body をパースしないよう、ここで 1 回だけ読んで両方に配る。
          // 本文の中身を見ない経路（reference / data-manifest、hash 不一致）は
          // どちらも doc を使わないのでパース自体を省く。
          const needsDoc = verified && (entry.type === "note" || entry.type === "knowledge");
          const parsed = needsDoc ? parseSharedBody(body) : null;
          // 本文を読んだこの場でラベル・プロセスも投影する。新しい読み取りは足さない
          //（hash が同じなら投影側でスキップされる）
          recordSharedProjectionFromBody(entry, body, verified, parsed);
          return sharedEntryToSourceInput(entry, body, verified, parsed);
        } catch {
          // 読めなかった（消された・権限なし）→ 索引から外す
          return null;
        }
      };
      await lexicalSearch.reconcile(desired, loader, { kinds: ["shared"], delayMs: 0 });
      if (cancelled) return;
      // 共有ナレッジの埋め込みも同じタイミングで手元に揃える（本文は上と同じ
      // LRU キャッシュから読めるので二度読みにならない）。OFF なら entries が
      // 空なので、消えた分の掃除だけが走る
      await syncSharedKnowledgeEmbeddings(entries, readSharedEntryBody);
      // 共有から消えた id の投影を落とす。掃除の基準は「いま共有フォルダにあるもの」
      // なので、AI スイッチ OFF で reconcile 対象が空になっただけのときに
      // 投影まで消さないよう、スナップショット側の一覧を使う
      pruneSharedProjection(entriesRef.current.map((e) => e.id));
    }, SHARED_RECONCILE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scopeKey, syncKey, aiEnabled, disabled, generation, waitingForFirstLoad]);
}
