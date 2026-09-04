// 投入口の薄い hook
//
// IntakeModal に渡す state（idle/running/done）の遷移を runIntake の進捗にひもづける。
// deps は ref に持ち、呼び出し側で毎レンダー新しい関数を渡しても run の identity が
// 変わらないようにする（useEffect の依存等で意図せず再実行されるのを防ぐ）。

import { useCallback, useRef, useState } from "react";
import type { IntakeState } from "./IntakeModal";
import { runIntake, mergeOutcome, type IntakeDeps, type IntakeOutcome } from "./run-intake";
import type { IntakeFile } from "./types";

export function useIntake(deps: IntakeDeps & { aiAvailable: boolean }) {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const [open, setOpen] = useState(false);
  const [state, setState] = useState<IntakeState>({ kind: "idle" });
  const [lastOutcome, setLastOutcome] = useState<IntakeOutcome | null>(null);
  // 実行中かどうかを state と別に持つ（state だけだと非同期の連打判定が 1 tick 遅れる）
  const runningRef = useRef(false);
  // 実行中に来た run() の分をここに積み、今のバッチが終わり次第続けて処理する
  const pendingRef = useRef<IntakeFile[]>([]);

  const openIntake = useCallback(() => {
    setOpen(true);
  }, []);

  const closeIntake = useCallback(() => {
    setOpen(false);
    // 実行中に閉じても進捗は保つ（次に開いたときに進行中がそのまま見える）。
    // idle に戻すのは実行中でないときだけ
    if (!runningRef.current) {
      setState({ kind: "idle" });
    }
  }, []);

  const run = useCallback(async (files: IntakeFile[]) => {
    if (runningRef.current) {
      // 実行中の再入は待ち行列に積み、今のバッチが終わったら続けて処理する
      pendingRef.current.push(...files);
      setOpen(true);
      return;
    }
    // 空のドロップ（フォルダの中身が読めなかった等）は受け皿を開くだけにする
    if (files.length === 0) {
      setOpen(true);
      return;
    }
    runningRef.current = true;
    setOpen(true);

    let combined: IntakeOutcome | null = null;
    let batch = files;

    try {
      while (batch.length > 0) {
        setState({ kind: "running", done: 0, total: batch.length, failed: combined?.failed ?? [] });
        const outcome = await runIntake(batch, depsRef.current, (p) => {
          setState({ kind: "running", done: p.done, total: p.total, current: p.current, failed: p.failed });
        });
        combined = combined ? mergeOutcome(combined, outcome) : outcome;
        // このバッチの処理中に積まれた分があれば、続けて次のバッチとして処理する
        batch = pendingRef.current.splice(0, pendingRef.current.length);
      }

      if (combined) {
        setLastOutcome(combined);
        setState({
          kind: "done",
          notes: combined.notes,
          materials: combined.materials,
          linksResolved: combined.linksResolved,
          linksUnresolved: combined.linksUnresolved,
          failed: combined.failed,
          skipped: combined.skipped,
          aiAvailable: depsRef.current.aiAvailable,
        });
        // 進行中に × で閉じられていても、結果（復元レポート）は必ず見せる
        setOpen(true);
      }
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
