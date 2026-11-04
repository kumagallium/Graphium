// 「外の AI からノートを使う」の見た目だけの部品。状態は props で受けて描くだけ。
//
// デスクトップ版に同梱した Graphium の MCP サーバーを、外の AI アシスタント（Claude Desktop /
// Claude Code / Codex / その他の MCP クライアント）に登録する。利用者が Node.js を入れたり
// ソースをビルドしたりしなくて済むようにするのが目的。
//
// 行ごとに 1 つのクライアント。ボタンで登録できるもの（設定ファイルを書く・CLI を呼ぶ）は
// ボタンを、できないもの（CLI が見つからない・その他のクライアント）は貼り付けるコマンドや
// JSON をコピーできるようにする。

import { AlertCircle, Check, ChevronDown, ChevronRight, Copy, Loader2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useT } from "../../../i18n";
import { SETTINGS_CARD_CLASS } from "../SettingsGroup";

export type AssistantClientId = "claude-desktop" | "claude-code" | "codex";

/** 1 つのクライアントの登録状態 */
export type AssistantRowState =
  | { kind: "idle" }
  /** 登録の途中 */
  | { kind: "working" }
  /** このアプリに同梱した MCP で登録済み */
  | { kind: "registered" }
  /** graphium は登録されているが、別の場所（手でビルドした古い版など）を指している */
  | { kind: "outdated" }
  /** Claude Desktop が起動中。開いたまま設定を書くと Claude が書き戻して消える */
  | { kind: "needs-quit" }
  /** CLI が見つからない。コマンドをコピーしてターミナルで実行してもらう */
  | { kind: "no-cli" }
  | { kind: "error"; message: string };

export type AssistantConnectViewProps = {
  /** デスクトップ版でだけ使える（Web 版では案内だけ出す） */
  available: boolean;
  rows: Record<AssistantClientId, AssistantRowState>;
  /** 貼り付け用の文字列（同梱した node と MCP の絶対パス入り） */
  snippets: {
    "claude-code": string;
    codex: string;
    /** その他のクライアント向けの mcpServers JSON */
    json: string;
  };
  /** 直前にコピーしたもの（「コピーしました」を出す） */
  copied?: AssistantClientId | "json" | null;
  onRegister: (id: AssistantClientId) => void;
  onCopy: (id: Exclude<AssistantClientId, "claude-desktop"> | "json") => void;
};

const rowBtn = "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60";
const rowPrimary = `${rowBtn} bg-primary text-primary-foreground hover:bg-primary/90`;
const rowSecondary = `${rowBtn} border border-border text-foreground hover:bg-accent`;
const rowClass = `${SETTINGS_CARD_CLASS} p-3 text-left`;

const ROW_ORDER: AssistantClientId[] = ["claude-desktop", "claude-code", "codex"];

export function AssistantConnectView({
  available,
  rows,
  snippets,
  copied = null,
  onRegister,
  onCopy,
}: AssistantConnectViewProps) {
  const t = useT();
  const [otherOpen, setOtherOpen] = useState(false);

  if (!available) {
    return <p className="text-xs text-muted-foreground">{t("settings.assistantConnect.desktopOnly")}</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t("settings.assistantConnect.intro")}</p>

      {ROW_ORDER.map((id) => (
        <ClientRow
          key={id}
          id={id}
          state={rows[id]}
          snippet={id === "claude-desktop" ? null : snippets[id]}
          copied={copied === id}
          onRegister={() => onRegister(id)}
          onCopy={id === "claude-desktop" ? undefined : () => onCopy(id)}
        />
      ))}

      {/* その他のクライアント: JSON をコピーして各自の設定に貼る */}
      <div className={rowClass}>
        <button
          type="button"
          onClick={() => setOtherOpen((v) => !v)}
          aria-expanded={otherOpen}
          className="flex w-full items-center gap-1 text-left"
        >
          <span className="shrink-0 text-muted-foreground">
            {otherOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          <span className="text-xs font-semibold text-foreground">{t("settings.assistantConnect.other.title")}</span>
        </button>
        {otherOpen && (
          <div className="mt-2 space-y-2">
            <p className="text-xs text-muted-foreground">{t("settings.assistantConnect.other.summary")}</p>
            <Snippet text={snippets.json} copied={copied === "json"} onCopy={() => onCopy("json")} />
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">{t("settings.assistantConnect.chatgptNote")}</p>
    </div>
  );
}

function ClientRow({
  id,
  state,
  snippet,
  copied,
  onRegister,
  onCopy,
}: {
  id: AssistantClientId;
  state: AssistantRowState;
  snippet: string | null;
  copied: boolean;
  onRegister: () => void;
  onCopy?: () => void;
}) {
  const t = useT();
  const key = `settings.assistantConnect.${id}`;

  let action: ReactNode = null;
  let note: ReactNode = null;
  switch (state.kind) {
    case "idle":
      action = (
        <button type="button" onClick={onRegister} className={rowPrimary}>
          {t("settings.assistantConnect.register")}
        </button>
      );
      break;
    case "working":
      action = (
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground" role="status">
          <Loader2 size={12} className="animate-spin" />
          {t("settings.assistantConnect.working")}
        </span>
      );
      break;
    case "registered":
      action = (
        <span className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-primary">
          <Check size={12} />
          {t("settings.assistantConnect.registered")}
        </span>
      );
      note = <p className="mt-1 text-xs text-muted-foreground">{t(`${key}.registeredNote`)}</p>;
      break;
    case "outdated":
      action = (
        <button type="button" onClick={onRegister} className={rowPrimary}>
          {t("settings.assistantConnect.update")}
        </button>
      );
      note = <p className="mt-1 text-xs text-muted-foreground">{t("settings.assistantConnect.outdatedNote")}</p>;
      break;
    case "needs-quit":
      action = (
        <button type="button" onClick={onRegister} className={rowSecondary}>
          {t("settings.assistantConnect.retry")}
        </button>
      );
      note = (
        <p className="mt-1 flex items-start gap-1 text-xs text-foreground">
          <AlertCircle size={12} className="mt-0.5 shrink-0 text-amber-600" />
          {t("settings.assistantConnect.claude-desktop.needsQuit")}
        </p>
      );
      break;
    case "no-cli":
      note = (
        <div className="mt-2 space-y-1">
          <p className="text-xs text-muted-foreground">{t(`${key}.noCli`)}</p>
          {snippet && onCopy && <Snippet text={snippet} copied={copied} onCopy={onCopy} />}
        </div>
      );
      break;
    case "error":
      action = (
        <button type="button" onClick={onRegister} className={rowSecondary}>
          {t("settings.assistantConnect.retry")}
        </button>
      );
      note = (
        <p className="mt-1 flex items-start gap-1 text-xs text-red-600">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          {state.message}
        </p>
      );
      break;
  }

  return (
    <div className={rowClass}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-xs font-semibold text-foreground">{t(`${key}.title`)}</h4>
          <p className="mt-0.5 text-xs text-muted-foreground">{t(`${key}.summary`)}</p>
        </div>
        {action}
      </div>
      {note}
    </div>
  );
}

/** コピーできる 1 枚のコード。長いパスは折り返す */
function Snippet({ text, copied, onCopy }: { text: string; copied: boolean; onCopy: () => void }) {
  const t = useT();
  return (
    <div className="flex items-start gap-2 rounded-md bg-card p-2">
      <code className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-[11px] text-foreground">{text}</code>
      <button
        type="button"
        onClick={onCopy}
        aria-label={t("settings.assistantConnect.copy")}
        data-tooltip={t("settings.assistantConnect.copy")}
        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        {copied ? <Check size={12} className="text-primary" /> : <Copy size={12} />}
      </button>
    </div>
  );
}
