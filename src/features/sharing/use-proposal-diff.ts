// 「変更の提案」の差分タブが読む材料をそろえるフック（§25 D-3）。
//
// 差分そのものは純関数（proposal-diff.ts）が出す。ここがやるのは取り寄せだけ:
//   theirs = 提案の本文（呼び出し側が既に読んでいる文字列）
//   mine   = 元エントリの現在の共有本文（共有ストアから読む）
//   base   = extra.baseRef の blob（blob root 未設定・参照なしなら 2 者比較に落ちる）
//
// 守っていること:
//   - 元エントリが読めない・base が読めないことを失敗にしない。base が無ければ
//     2 者比較、mine が無ければ「差分は出せない」とだけ言う（提案は読めている）
//   - 取り寄せの入口を 1 本にする。パネル側で個別に読むと、読み込み中の見た目と
//     エラーの扱いが二重になる

import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphiumDocument } from "../../lib/document-types";
import {
  LocalFolderBlobProvider,
  getBlobRoot,
  type BlobRef,
  type SharedEntry,
} from "../../lib/storage/shared";
import { readSharedEntryBody } from "./shared-library-store";
import { readProposalExtra } from "./share-proposal";
import {
  computeProposalDiff,
  summarizeProposalDiff,
  type ProposalDiff,
  type ProposalDiffInput,
  type ProposalDiffSummary,
} from "./proposal-diff";

export type ProposalDiffState = {
  diff: ProposalDiff | null;
  summary: ProposalDiffSummary | null;
  /** 基準版を挟んだ 3 者比較になっているか（false なら 2 者比較の断り書きを出す） */
  hasBase: boolean;
  loading: boolean;
  /** 差分を出せなかった理由（元エントリの本文が読めない・壊れている等） */
  error: string | null;
  /** 元エントリが共有ライブラリに無い（共有解除・まだ読めていない） */
  targetMissing: boolean;
};

export type UseProposalDiffOptions = {
  /** 提案の封筒 */
  entry: SharedEntry;
  /** 提案の本文（SharedNoteView が既に読んだもの）。まだなら null */
  body: string | null;
  /** 解決済みの共有エントリ一覧（元エントリを id で引く） */
  entries: readonly SharedEntry[];
  /** DI: 本文の取り寄せ（既定は共有ストア） */
  readEntryBody?: (
    entry: SharedEntry,
  ) => Promise<{ body: Uint8Array; verified: boolean }>;
  /** DI: 基準版の blob 取り寄せ（既定は blob root から読む） */
  readBlob?: (ref: BlobRef) => Promise<Uint8Array>;
  /**
   * DI: 取り寄せをまるごと差し替える（Storybook / テスト用）。
   * 渡された時点で共有フォルダには一切触らない。
   */
  override?: ProposalDiffInput;
};

function parseDoc(json: string): GraphiumDocument | null {
  try {
    const parsed = JSON.parse(json) as GraphiumDocument;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** 既定の blob 取り寄せ。blob root 未設定なら基準版は無いものとして扱う */
async function defaultReadBlob(ref: BlobRef): Promise<Uint8Array> {
  const root = getBlobRoot();
  if (!root) throw new Error("Blob root is not configured.");
  return new LocalFolderBlobProvider(root).get(ref);
}

export function useProposalDiff(options: UseProposalDiffOptions): ProposalDiffState {
  const { entry, body, entries, readEntryBody, readBlob, override } = options;
  const [loaded, setLoaded] = useState<{
    mine: GraphiumDocument | null;
    base: GraphiumDocument | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const extra = useMemo(() => readProposalExtra(entry), [entry]);
  const target = useMemo(
    () =>
      extra ? entries.find((e) => e.id === extra.target && e.type !== "proposal") ?? null : null,
    [extra, entries],
  );
  // DI の関数は毎レンダー作り直されうるので、依存に混ぜず ref で最新を読む
  const readersRef = useRef({ readEntryBody, readBlob });
  readersRef.current = { readEntryBody, readBlob };

  const targetId = target?.id ?? null;
  const targetHash = target?.hash ?? null;
  const baseHash = extra?.baseRef?.hash ?? null;

  useEffect(() => {
    if (override) return;
    if (!targetId || !target) {
      setLoaded(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      const readBody = readersRef.current.readEntryBody ?? readSharedEntryBody;
      let mine: GraphiumDocument | null = null;
      let baseDoc: GraphiumDocument | null = null;
      let failure: string | null = null;
      try {
        const { body: bytes } = await readBody(target);
        mine = parseDoc(new TextDecoder().decode(bytes));
        if (!mine) failure = "Could not read the original note's body.";
      } catch (e) {
        failure = e instanceof Error ? e.message : String(e);
      }
      // 基準版は「あれば良くなる」もの。読めなくても 2 者比較で先へ進む
      if (extra?.baseRef) {
        try {
          const bytes = await (readersRef.current.readBlob ?? defaultReadBlob)(extra.baseRef);
          baseDoc = parseDoc(new TextDecoder().decode(bytes));
        } catch {
          baseDoc = null;
        }
      }
      if (cancelled) return;
      setLoaded({ mine, base: baseDoc });
      setError(failure);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // target は id + hash が同じなら同じ版。配列の同一性ではなく版で読み直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [override, targetId, targetHash, baseHash]);

  const theirs = useMemo(() => (body ? parseDoc(body) : null), [body]);

  const input = useMemo<ProposalDiffInput | null>(() => {
    if (override) return override;
    if (!loaded?.mine || !theirs) return null;
    return { base: loaded.base, mine: loaded.mine, theirs };
  }, [override, loaded, theirs]);

  const diff = useMemo(() => (input ? computeProposalDiff(input) : null), [input]);
  const summary = useMemo(() => (diff ? summarizeProposalDiff(diff) : null), [diff]);

  return {
    diff,
    summary,
    hasBase: !!input?.base,
    // 本文がまだ届いていない間も「読み込み中」。空の差分に見せない
    loading: override
      ? false
      : loading || body === null || (!!targetId && !loaded && !error),
    error: override ? null : error,
    // 元エントリが一覧に無い（共有解除・まだ読めていない）。比べる相手がいないので
    // 「差分なし」ではなく状態の説明に倒す
    targetMissing: !override && !!extra && !targetId,
  };
}
