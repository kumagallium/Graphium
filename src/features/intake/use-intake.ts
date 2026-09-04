// 投入口の薄い hook
//
// IntakeModal に渡す state（idle/running/done）の遷移を runIntake の進捗にひもづける。
// deps は ref に持ち、呼び出し側で毎レンダー新しい関数を渡しても run の identity が
// 変わらないようにする（useEffect の依存等で意図せず再実行されるのを防ぐ）。

import { useCallback, useRef, useState } from "react";
import type { IntakeState } from "./IntakeModal";
import { runIntake, type IntakeDeps, type IntakeOutcome } from "./run-intake";
import type { IntakeFile } from "./types";

export function useIntake(deps: IntakeDeps & { aiAvailable: boolean }) {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const [open, setOpen] = useState(false);
  const [state, setState] = useState<IntakeState>({ kind: "idle" });
  const [lastOutcome, setLastOutcome] = useState<IntakeOutcome | null>(null);
  // 実行中かどうかを state と別に持つ（state だけだと非同期の連打判定が 1 tick 遅れる）
  const runningRef = useRef(false);

  const openIntake = useCallback(() => {
    setOpen(true);
  }, []);

  const closeIntake = useCallback(() => {
    setOpen(false);
    setState({ kind: "idle" });
  }, []);

  const run = useCallback(async (files: IntakeFile[]) => {
    if (runningRef.current) {
      console.warn("[intake] 実行中の再入は無視しました");
      return;
    }
    // 空のドロップ（フォルダの中身が読めなかった等）は受け皿を開くだけにする
    if (files.length === 0) {
      setOpen(true);
      return;
    }
    runningRef.current = true;
    setOpen(true);
    setState({ kind: "running", done: 0, total: files.length, failed: [] });

    try {
      const outcome = await runIntake(files, depsRef.current, (p) => {
        setState({ kind: "running", done: p.done, total: p.total, current: p.current, failed: p.failed });
      });
      setLastOutcome(outcome);
      setState({
        kind: "done",
        notes: outcome.notes,
        materials: outcome.materials,
        linksResolved: outcome.linksResolved,
        linksUnresolved: outcome.linksUnresolved,
        failed: outcome.failed,
        skipped: outcome.skipped,
        aiAvailable: depsRef.current.aiAvailable,
      });
      // 進行中に × で閉じられていても、結果（復元レポート）は必ず見せる
      setOpen(true);
    } catch (err) {
      // runIntake は内部で失敗を吸収するのでここには来ないはずだが、
      // 来たときに running のまま固まらないよう受け皿に戻す
      console.error("[intake] 取り込みが失敗しました:", err);
      setState({ kind: "idle" });
    } finally {
      runningRef.current = false;
    }
  }, []);

  return { open, state, openIntake, closeIntake, run, lastOutcome };
}
