// 外部ツール（MCP サーバー）をつなぐ画面。「外部ツールを追加」の最初の 1 枚と、キーの 1 枚。
//
// JSON やコマンドから始めず、「何をつなぐか」を選んでキーを貼るだけにする。
// - 上: Graphium が確かめた厳選の接続先
// - 中: 公式 MCP Registry を探す。リモートで繋がるものだけ「つなぐ」を出し、
//   パソコンに Node.js などが要るものは理由を添えて並べるだけにする
// - 下: 今の JSON・手入力・レジストリのフォーム（詳しい人の使い方は変えない）
//
// 見た目だけの部品。検索・接続テストの状態は props で受けて描くだけ。

import { AlertCircle, ChevronLeft, ExternalLink, Loader2, Search } from "lucide-react";
import { Input } from "@ui/form-field";
import { useT } from "../../../i18n";
import type { CuratedServer, CuratedText } from "./catalog";
import type { ConnectField, ConnectOption, RegistryResult } from "./registry";
import { SETTINGS_CARD_CLASS, SETTINGS_INNER_CARD_CLASS } from "../SettingsGroup";

const primaryButton =
  "shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50";
const linkButton = "inline-flex items-center gap-1 text-xs text-primary hover:opacity-80";

export type RegistrySearchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "done"; results: RegistryResult[] };

export type McpPickViewProps = {
  curated: readonly { server: CuratedServer; text: CuratedText }[];
  query: string;
  search: RegistrySearchState;
  /** 登録済みのサーバー名（同じものに「追加済み」を出す） */
  existingNames: readonly string[];
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onPickCurated: (server: CuratedServer) => void;
  onPickRegistry: (option: ConnectOption) => void;
  onOpenUrl: (url: string) => void;
  onAdvanced: () => void;
  onCancel: () => void;
};

export function McpPickView({
  curated,
  query,
  search,
  existingNames,
  onQueryChange,
  onSearch,
  onPickCurated,
  onPickRegistry,
  onOpenUrl,
  onAdvanced,
  onCancel,
}: McpPickViewProps) {
  const t = useT();
  const added = (name: string) => existingNames.includes(name);

  return (
    <div className={`space-y-3 ${SETTINGS_CARD_CLASS} p-3`}>
      <p className="text-xs font-semibold text-foreground">{t("settings.mcp.connect.title")}</p>

      {/* 厳選の接続先 */}
      <ul className="space-y-2">
        {curated.map(({ server, text }) => (
          <li key={server.id} className={`flex items-start gap-3 ${SETTINGS_INNER_CARD_CLASS} p-3`}>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground">
                {server.name}
                <span className="ml-2 font-normal text-muted-foreground">{server.publisher}</span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{text.what}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{text.free}</p>
            </div>
            {added(server.serverName) ? (
              <span className="shrink-0 text-xs text-muted-foreground">{t("settings.mcp.added")}</span>
            ) : (
              <button type="button" className={primaryButton} onClick={() => onPickCurated(server)}>
                {t("settings.mcp.connect.pick")}
              </button>
            )}
          </li>
        ))}
      </ul>

      {/* 公式レジストリを探す */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground">{t("settings.mcp.connect.searchTitle")}</p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onSearch();
          }}
        >
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t("settings.mcp.connect.searchPlaceholder")}
            aria-label={t("settings.mcp.connect.searchTitle")}
            className="flex-1"
          />
          <button type="submit" className={primaryButton} disabled={!query.trim() || search.kind === "loading"}>
            {search.kind === "loading" ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
            <span className="sr-only">{t("settings.mcp.connect.search")}</span>
          </button>
        </form>
        <p className="text-xs text-muted-foreground">{t("settings.mcp.connect.searchHelp")}</p>

        {search.kind === "error" && (
          <p className="flex items-center gap-1 text-xs text-red-500">
            <AlertCircle size={12} /> {t("settings.mcp.connect.searchError")}
          </p>
        )}
        {search.kind === "done" && search.results.length === 0 && (
          <p className="text-xs text-muted-foreground">{t("settings.mcp.connect.noResults")}</p>
        )}
        {search.kind === "done" && search.results.length > 0 && (
          <ul className="max-h-72 space-y-1.5 overflow-y-auto">
            {search.results.map((r) => {
              const head = r.kind === "remote" ? r.option : r;
              return (
                <li key={head.id} className={`flex items-start gap-3 ${SETTINGS_INNER_CARD_CLASS} px-3 py-2`}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground">{head.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {t("settings.mcp.connect.publisher", { publisher: head.publisher })}
                    </p>
                    {head.description && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{head.description}</p>
                    )}
                    {head.websiteUrl && (
                      <button type="button" className={`${linkButton} mt-0.5`} onClick={() => onOpenUrl(head.websiteUrl!)}>
                        <ExternalLink size={11} /> {t("settings.mcp.connect.about")}
                      </button>
                    )}
                  </div>
                  {r.kind === "remote" ? (
                    added(r.option.serverName) ? (
                      <span className="shrink-0 text-xs text-muted-foreground">{t("settings.mcp.added")}</span>
                    ) : (
                      <button type="button" className={primaryButton} onClick={() => onPickRegistry(r.option)}>
                        {t("settings.mcp.connect.pick")}
                      </button>
                    )
                  ) : (
                    <span className="max-w-[9rem] shrink-0 text-right text-xs text-muted-foreground">
                      {t(r.kind === "needs-local" ? "settings.mcp.connect.needsLocal" : "settings.mcp.connect.unsupported")}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between pt-2">
        <button type="button" className={linkButton} onClick={onAdvanced}>
          {t("settings.mcp.connect.advanced")}
        </button>
        <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={onCancel}>
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
}

export type McpKeyPhase =
  | { kind: "idle" }
  | { kind: "testing" }
  /** 握手が通らなかった（message はサーバーの言葉のまま） */
  | { kind: "error"; message: string }
  /** 確かめる口でキーが違うと分かった */
  | { kind: "invalidKey" };

export type McpKeyViewProps = {
  option: ConnectOption;
  /** キーを作るページ（厳選の接続先だけ） */
  signupUrl?: string;
  values: Record<string, string>;
  phase: McpKeyPhase;
  canConnect: boolean;
  onValueChange: (header: string, value: string) => void;
  onOpenUrl: (url: string) => void;
  onBack: () => void;
  onConnect: () => void;
};

function fieldLabel(f: ConnectField, t: ReturnType<typeof useT>): string {
  const name = f.bearer ? t("settings.mcp.connect.apiKey") : f.header;
  return `${name}${f.required ? "" : t("settings.mcp.connect.optional")}`;
}

export function McpKeyView({
  option,
  signupUrl,
  values,
  phase,
  canConnect,
  onValueChange,
  onOpenUrl,
  onBack,
  onConnect,
}: McpKeyViewProps) {
  const t = useT();
  const inputs = option.fields.filter((f) => f.fixed === undefined);

  return (
    <form
      className={`space-y-3 ${SETTINGS_CARD_CLASS} p-3`}
      onSubmit={(e) => {
        e.preventDefault();
        if (canConnect && phase.kind !== "testing") onConnect();
      }}
    >
      <button type="button" className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground" onClick={onBack}>
        <ChevronLeft size={12} /> {t("settings.mcp.connect.back")}
      </button>
      <div>
        <p className="text-xs font-semibold text-foreground">{t("settings.mcp.connect.keyTitle", { name: option.title })}</p>
        <p className="text-xs text-muted-foreground">{t("settings.mcp.connect.publisher", { publisher: option.publisher })}</p>
        {option.description && <p className="mt-1 text-xs text-muted-foreground">{option.description}</p>}
      </div>

      {inputs.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("settings.mcp.connect.noKey")}</p>
      ) : (
        inputs.map((f) => (
          <div key={f.header}>
            <label className="mb-1 block text-xs text-muted-foreground" htmlFor={`mcp-connect-${f.header}`}>
              {fieldLabel(f, t)}
            </label>
            <Input
              id={`mcp-connect-${f.header}`}
              type={f.secret ? "password" : "text"}
              autoComplete="off"
              value={values[f.header] ?? ""}
              onChange={(e) => onValueChange(f.header, e.target.value)}
              placeholder={f.placeholder}
            />
            {f.description && <p className="mt-1 text-xs text-muted-foreground">{f.description}</p>}
          </div>
        ))
      )}

      {signupUrl && (
        <button type="button" className={linkButton} onClick={() => onOpenUrl(signupUrl)}>
          <ExternalLink size={11} /> {t("settings.mcp.connect.getKey", { name: option.title })}
        </button>
      )}

      {inputs.some((f) => f.secret) && (
        <p className="text-xs text-muted-foreground">{t("settings.mcp.connect.keyNote", { publisher: option.publisher })}</p>
      )}

      {(phase.kind === "error" || phase.kind === "invalidKey") && (
        <p className="flex items-start gap-1 text-xs text-red-500">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />{" "}
          {phase.kind === "invalidKey"
            ? t("settings.mcp.connect.invalidKey")
            : t("settings.mcp.connect.failed", { message: phase.message })}
        </p>
      )}

      <button type="submit" className={`${primaryButton} w-full py-2`} disabled={!canConnect || phase.kind === "testing"}>
        {phase.kind === "testing" ? (
          <span className="inline-flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" /> {t("settings.mcp.connect.testing")}
          </span>
        ) : (
          t("settings.mcp.connect.connect")
        )}
      </button>
    </form>
  );
}
