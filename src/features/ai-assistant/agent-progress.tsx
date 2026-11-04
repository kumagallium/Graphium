// AI が自分で道具を呼んでいる間の経過表示
//
// - 実行中: 「考え中…」の行の下に、呼び終えた道具を 1 行ずつ出す（ThinkingIndicator）
// - 回答後: 回答の下に「調べた手順（n）」を畳んで出す（ToolStepsDetails）。記録は ChatMessage.toolSteps
//
// 実行中の経過は会話（ノート内チャットの chatId / 単独チャットの id）ごとにモジュールで持つ。
// 実行はノート切替に耐える（chat-run-manager）ので、React の state ではなくここに置く。

import { useEffect, useState } from "react";
import { useT } from "../../i18n";
import type { AgentToolStep } from "../../lib/document-types";

type Listener = () => void;
const progressByChat = new Map<string, AgentToolStep[]>();
const listeners = new Set<Listener>();

const notify = () => {
  for (const l of listeners) l();
};

/** 実行中の会話の経過を更新する（道具を 1 つ呼び終えるたび） */
export function setAgentProgress(chatId: string, steps: AgentToolStep[]): void {
  progressByChat.set(chatId, steps);
  notify();
}

/** 実行が終わった会話の経過を捨てる */
export function clearAgentProgress(chatId: string): void {
  if (progressByChat.delete(chatId)) notify();
}

export function getAgentProgress(chatId: string | null | undefined): AgentToolStep[] {
  return chatId ? (progressByChat.get(chatId) ?? []) : [];
}

function useAgentProgress(chatId: string | null | undefined): AgentToolStep[] {
  const [steps, setSteps] = useState<AgentToolStep[]>(() => getAgentProgress(chatId));
  useEffect(() => {
    const update = () => setSteps(getAgentProgress(chatId));
    update();
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, [chatId]);
  return steps;
}

/** 道具 1 回分の 1 行（「材料・道具で探した: Ar — 3 件」） */
function StepLine({ step }: { step: AgentToolStep }) {
  const t = useT();
  const label = t(`aiChat.toolStep.${step.tool}`);
  const known = label !== `aiChat.toolStep.${step.tool}`;
  const result = step.empty
    ? t("aiChat.toolStep.none")
    : step.hits > 0
      ? t("aiChat.toolStep.hits", { count: String(step.hits) })
      : "";
  return (
    <li className="flex gap-1.5 min-w-0">
      <span className="shrink-0" aria-hidden>
        {step.empty ? "·" : "✓"}
      </span>
      <span className="min-w-0 truncate">
        {known ? label : step.tool}
        {step.input ? `: ${step.input}` : ""}
        {result ? ` — ${result}` : ""}
      </span>
    </li>
  );
}

/** 「考え中…」の行。道具を呼んでいればその経過を下に並べる */
export function ThinkingIndicator({ chatId }: { chatId: string | null | undefined }) {
  const t = useT();
  const steps = useAgentProgress(chatId);
  return (
    <div className="text-xs text-muted-foreground py-2 space-y-1">
      <div className="flex items-center gap-2">
        <span className="inline-block w-3 h-3 border-2 border-violet-400/30 border-t-violet-400 rounded-full animate-spin" />
        {steps.length > 0 ? t("aiChat.toolStep.searching") : t("aiChat.thinking")}
      </div>
      {steps.length > 0 && (
        <ul className="pl-5 space-y-0.5" aria-live="polite">
          {steps.map((s, i) => (
            <StepLine key={i} step={s} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** 回答の下の「調べた手順（n）」。既定は畳む */
export function ToolStepsDetails({ steps }: { steps: AgentToolStep[] }) {
  const t = useT();
  if (steps.length === 0) return null;
  return (
    <details className="mt-1 text-[11px] text-muted-foreground">
      <summary className="cursor-pointer select-none hover:text-foreground">
        {t("aiChat.toolStep.summary", { count: String(steps.length) })}
      </summary>
      <ul className="mt-1 pl-3 space-y-0.5">
        {steps.map((s, i) => (
          <StepLine key={i} step={s} />
        ))}
      </ul>
    </details>
  );
}
