// AI のつなぎ先を選んで登録するまでの流れ。
//
// 1. ConnectChooserView で「どこにつなぐか」を選ぶ
// 2. KeyConnectView で必要な欄だけ埋める。キーを貼ると自動で一覧を取り、おすすめを選んでおく
// 3. 「追加する」で登録する
//
// 一覧の取得と登録は設定画面（modal.tsx）の既存の経路を props で受けて使う（デスクトップは
// サーバー経由、Web は localStorage。今の追加フォームと同じ）。

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale } from "../../../i18n";
import {
  CLOUD_PROVIDERS,
  needsAccountId as templateNeedsAccountId,
  pickConnectModel,
  providerName,
  resolveApiBase,
  type FreeProvider,
} from "../free-providers/catalog";
import { ConnectChooserView, type LocalProviderId } from "./ConnectChooserView";
import { KeyConnectView, type KeyConnectPhase } from "./KeyConnectView";

/** 入力画面に渡す、つなぎ先の決まりごと */
type Target = {
  /** Graphium のプロバイダー ID（anthropic / openai / google / openai-compatible） */
  provider: string;
  name: string;
  /** 空ならプロバイダーの既定。{accountId} を含むことがある */
  apiBaseTemplate: string;
  keyHelpUrl: string;
  keyless?: boolean;
  /** 一覧にあれば最初に選んでおくモデル */
  preferredModel?: string;
  /** ふだん使いの系統（正規表現） */
  preferPattern?: string;
};

const LOCAL_TARGETS: Record<LocalProviderId, Target> = {
  lmstudio: { provider: "openai-compatible", name: "LM Studio", apiBaseTemplate: "http://localhost:1234/v1", keyHelpUrl: "", keyless: true },
  ollama: { provider: "openai-compatible", name: "Ollama", apiBaseTemplate: "http://localhost:11434/v1", keyHelpUrl: "", keyless: true },
};

/** キーの要らない接続先にも、一覧取得の API はキーを求めるので中身のない値を送る（LM Studio・Ollama は見ない） */
const KEYLESS_PLACEHOLDER = "local";
/** キーを貼ってから確かめに行くまでの待ち（打ち間違いの途中で何度も呼ばない） */
const CHECK_DELAY_MS = 600;

export type AiConnectFlowProps = {
  /** GitHub Copilot のワンクリック接続を始める（デスクトップのみ。無ければ行を出さない） */
  onConnectCopilot?: () => void;
  /** URL を自分で入れる今のフォームへ */
  onPickCustom: () => void;
  fetchModels: (provider: string, apiKey: string, apiBase: string) => Promise<string[]>;
  addModel: (spec: { name: string; provider: string; modelId: string; apiKey: string; apiBase: string }) => Promise<void>;
  openExternal: (url: string) => void;
  comparisonUrl: string;
  existingGroups?: { id: string; label: string }[];
  onPickExisting?: (id: string) => void;
  onOpenCopilotSettings?: () => void;
};

export function AiConnectFlow({
  onConnectCopilot,
  onPickCustom,
  fetchModels,
  addModel,
  openExternal,
  comparisonUrl,
  existingGroups,
  onPickExisting,
  onOpenCopilotSettings,
}: AiConnectFlowProps) {
  const { locale, t } = useLocale();
  const [target, setTarget] = useState<Target | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [accountId, setAccountId] = useState("");
  const [apiBase, setApiBase] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phase, setPhase] = useState<KeyConnectPhase>({ kind: "idle" });
  const [adding, setAdding] = useState(false);
  const requestId = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const shownTarget = useRef(target);

  // 選択（長い一覧）と入力欄（短い）を行き来すると高さが大きく変わる。一覧の下の方
  // （さくらの AI Engine など）を選ぶと、スクロール位置はそのままで中身だけ縮み、
  // 入力欄が画面の上に外れてしまう。段が変わったら見える位置に戻す（見えていれば動かさない）。
  // 前回の値と比べるのは、StrictMode の二度目の実行や開いた直後に動かさないため
  useEffect(() => {
    if (shownTarget.current === target) return;
    shownTarget.current = target;
    rootRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [target]);

  const open = (next: Target) => {
    setTarget(next);
    setApiKey("");
    setAccountId("");
    setApiBase(templateNeedsAccountId(next.apiBaseTemplate) ? "" : next.apiBaseTemplate);
    setDisplayName("");
    setPhase({ kind: "idle" });
  };
  const openCloud = (p: FreeProvider) =>
    open({
      provider: p.provider ?? "openai-compatible",
      name: providerName(p, locale),
      // OpenAI 互換以外（Anthropic・OpenAI）はプロバイダーの既定の URL を使う
      apiBaseTemplate: (p.provider ?? "openai-compatible") === "openai-compatible" ? p.apiBase : "",
      keyHelpUrl: p.signupUrl,
      preferredModel: p.model || undefined,
      preferPattern: p.preferModel,
    });

  // キー（とアカウント ID）がそろったら、少し待ってから自動で一覧を取る
  const effectiveKey = target?.keyless ? KEYLESS_PLACEHOLDER : apiKey.trim();
  const accountIdMissing = !!target && templateNeedsAccountId(target.apiBaseTemplate) && !apiBase;
  useEffect(() => {
    if (!target || !effectiveKey || accountIdMissing) {
      setPhase({ kind: "idle" });
      return;
    }
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      setPhase({ kind: "checking" });
      try {
        const models = await fetchModels(target.provider, effectiveKey, apiBase);
        if (id !== requestId.current) return;
        if (models.length === 0) {
          setPhase({ kind: "error", message: t("settings.aiConnect.form.noModels") });
          return;
        }
        const selected = pickConnectModel(models, { preferred: target.preferredModel, preferPattern: target.preferPattern });
        setPhase({ kind: "ready", models, selected });
        setDisplayName(selected);
      } catch (err) {
        if (id !== requestId.current) return;
        setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      }
    }, CHECK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [target, effectiveKey, apiBase, accountIdMissing, fetchModels, t]);

  // scroll-mt: 戻したときに上の見出し（モデルを追加）も見えるようにする
  const wrap = (body: ReactNode) => (
    <div ref={rootRef} className="scroll-mt-12">
      {body}
    </div>
  );

  if (!target) {
    return wrap(
      <ConnectChooserView
        cloudProviders={CLOUD_PROVIDERS}
        onConnectCopilot={onConnectCopilot}
        onPickCloud={openCloud}
        onPickLocal={(id) => open(LOCAL_TARGETS[id])}
        onPickCustom={onPickCustom}
        existingGroups={existingGroups}
        onPickExisting={onPickExisting}
        onOpenCopilotSettings={onOpenCopilotSettings}
        onOpenSignup={openExternal}
        onOpenComparison={() => openExternal(comparisonUrl)}
      />
    );
  }

  return wrap(
    <KeyConnectView
      providerName={target.name}
      keyHelpUrl={target.keyHelpUrl}
      needsAccountId={templateNeedsAccountId(target.apiBaseTemplate)}
      keyless={target.keyless}
      apiKey={apiKey}
      accountId={accountId}
      apiBase={apiBase}
      displayName={displayName}
      phase={adding ? { kind: "checking" } : phase}
      onApiKeyChange={setApiKey}
      onAccountIdChange={(v) => {
        setAccountId(v);
        setApiBase(resolveApiBase(target.apiBaseTemplate, v));
      }}
      onApiBaseChange={setApiBase}
      onModelChange={(m) => {
        if (phase.kind === "ready") setPhase({ ...phase, selected: m });
        setDisplayName(m);
      }}
      onDisplayNameChange={setDisplayName}
      onOpenKeyHelp={openExternal}
      onBack={() => setTarget(null)}
      onAdd={async () => {
        if (phase.kind !== "ready") return;
        setAdding(true);
        try {
          await addModel({
            name: displayName.trim() || phase.selected,
            provider: target.provider,
            modelId: phase.selected,
            apiKey: effectiveKey,
            apiBase,
          });
          setTarget(null);
        } catch (err) {
          setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
        } finally {
          setAdding(false);
        }
      }}
    />
  );
}
