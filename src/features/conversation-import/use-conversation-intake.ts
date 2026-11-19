// 取り込みの「AI との会話」の区画の状態。
//
// 区画を開くと作業フォルダの一覧を読み、選んだフォルダの会話を 20 件ずつ読んで素材にする。
// この hook は AI を呼ばない（呼ぶ口は api.ts の 2 つだけ）。

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useT } from "../../i18n";
import {
  fetchConversationMaterials,
  fetchConversationWorkdirs,
  type ConversationWorkdirItem,
} from "./api";
import { importConversations } from "./import-conversations";

export type ConversationIntakeState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "error" }
  | { kind: "ready"; items: ConversationWorkdirItem[]; selected: ReadonlySet<string>; searchedPath: string }
  | { kind: "importing"; done: number; total: number }
  | { kind: "done"; created: number; updated: number; unchanged: number; failed: number };

export type ConversationIntakeSection = "files" | "conversations";

/** 口 B を呼ぶ 1 回あたりの会話の数 */
export const CONVERSATION_READ_BATCH = 20;

export type ConversationIntakeDeps = {
  fetchWorkdirs: typeof fetchConversationWorkdirs;
  fetchMaterials: typeof fetchConversationMaterials;
  importConversations: typeof importConversations;
};

const defaultDeps: ConversationIntakeDeps = {
  fetchWorkdirs: fetchConversationWorkdirs,
  fetchMaterials: fetchConversationMaterials,
  importConversations,
};

/** 本人の発言がある会話があって、選べる行だけ */
function selectable(item: ConversationWorkdirItem): boolean {
  return item.sessionRefs.length > 0;
}

export function useConversationIntake(deps: Partial<ConversationIntakeDeps> = {}) {
  const t = useT();
  const { locale } = useLocale();
  const [state, setState] = useState<ConversationIntakeState>({ kind: "idle" });
  const [section, setSectionState] = useState<ConversationIntakeSection>("files");

  // 最新の値を非同期処理から読むための ref
  const stateRef = useRef(state);
  stateRef.current = state;
  const depsRef = useRef<ConversationIntakeDeps>({ ...defaultDeps, ...deps });
  depsRef.current = { ...defaultDeps, ...deps };
  const folderRootRef = useRef(t("intake.conversation.folderRoot"));
  folderRootRef.current = t("intake.conversation.folderRoot");
  const langRef = useRef<"ja" | "en">(locale === "ja" ? "ja" : "en");
  langRef.current = locale === "ja" ? "ja" : "en";
  const abortRef = useRef<AbortController | null>(null);
  /** reset のたびに進める。古い非同期処理の結果を捨てる */
  const generationRef = useRef(0);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const generation = generationRef.current;
    setState({ kind: "loading" });
    try {
      const result = await depsRef.current.fetchWorkdirs(controller.signal);
      if (controller.signal.aborted || generation !== generationRef.current) return;
      if (result.kind === "ok") {
        setState({ kind: "ready", items: result.workdirs, selected: new Set(), searchedPath: result.searchedPath });
      } else {
        setState({ kind: result.kind });
      }
    } catch {
      if (controller.signal.aborted || generation !== generationRef.current) return;
      setState({ kind: "error" });
    }
  }, []);

  const setSection = useCallback(
    (next: ConversationIntakeSection) => {
      setSectionState(next);
      if (next === "conversations" && stateRef.current.kind === "idle") void load();
    },
    [load],
  );

  const toggle = useCallback((workdir: string) => {
    setState((s) => {
      if (s.kind !== "ready") return s;
      const selected = new Set(s.selected);
      if (selected.has(workdir)) selected.delete(workdir);
      else selected.add(workdir);
      return { ...s, selected };
    });
  }, []);

  const toggleAll = useCallback((next: boolean) => {
    setState((s) => {
      if (s.kind !== "ready") return s;
      const selected = new Set<string>(next ? s.items.filter(selectable).map((i) => i.workdir) : []);
      return { ...s, selected };
    });
  }, []);

  const startImport = useCallback(async () => {
    const current = stateRef.current;
    if (current.kind !== "ready") return;
    const refs = current.items.filter((i) => current.selected.has(i.workdir)).flatMap((i) => i.sessionRefs);
    if (refs.length === 0) return;
    const generation = generationRef.current;
    const d = depsRef.current;
    const total = refs.length;
    let done = 0;
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let failed = 0;
    setState({ kind: "importing", done: 0, total });
    // 取り込み中に閉じても処理は最後まで走らせる（中断しない）。画面の状態だけ世代で守る
    for (let i = 0; i < refs.length; i += CONVERSATION_READ_BATCH) {
      const batch = refs.slice(i, i + CONVERSATION_READ_BATCH);
      try {
        const read = await d.fetchMaterials(batch);
        failed += read.failed;
        const result = await d.importConversations(read.materials, {
          folderRoot: folderRootRef.current,
          lang: langRef.current,
        });
        created += result.created.length;
        updated += result.updated.length;
        unchanged += result.unchanged.length;
        failed += result.skipped.length;
      } catch {
        failed += batch.length;
      }
      done += batch.length;
      if (generation === generationRef.current) setState({ kind: "importing", done, total });
    }
    if (generation === generationRef.current) setState({ kind: "done", created, updated, unchanged, failed });
  }, []);

  const retry = useCallback(() => {
    void load();
  }, [load]);

  const reset = useCallback(() => {
    // 取り込み中なら処理は続けさせる（読み込みの fetch だけ止める）
    abortRef.current?.abort();
    abortRef.current = null;
    generationRef.current += 1;
    setState({ kind: "idle" });
    setSectionState("files");
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { state, section, setSection, toggle, toggleAll, startImport, retry, reset };
}
