// 外部ツール（MCP サーバー）を選んでつなぐまでの流れ。
//
// 1. McpPickView で厳選の接続先を選ぶか、公式レジストリを探して選ぶ
// 2. McpKeyView でキーなど要る欄だけを埋める
// 3. 「つないで確かめる」で握手（接続テスト）を通し、通ったものだけを登録する
//
// 検索・接続テスト・登録は設定画面（modal.tsx）の経路を props で受けて使う。

import { useState } from "react";
import { useLocale } from "../../../i18n";
import type { McpRemoteServer } from "../store";
import { CURATED_SERVERS, checkCuratedKey, curatedText, curatedToOption, type CuratedServer } from "./catalog";
import { McpKeyView, McpPickView, type McpKeyPhase, type RegistrySearchState } from "./McpConnectView";
import { buildRemoteEntry, hasRequiredValues, toRegistryResults, type ConnectOption } from "./registry";

export type McpConnectFlowProps = {
  existingNames: readonly string[];
  /** 公式レジストリを探す（中身は API の servers 配列のまま返す） */
  searchRegistry: (query: string) => Promise<unknown[]>;
  /** 握手して道具の数を返す。通らなければ理由 */
  testServer: (entry: McpRemoteServer) => Promise<{ ok: true; count: number } | { ok: false; message: string }>;
  /** 握手の通った 1 件を登録する */
  onAdded: (entry: McpRemoteServer, toolCount: number) => void;
  onAdvanced: () => void;
  onCancel: () => void;
  openExternal: (url: string) => void;
};

/** 同じ名前が登録済みなら -2, -3 … を付ける（登録は名前で置き換えるので、別物を上書きしない） */
function uniqueName(base: string, existing: readonly string[]): string {
  if (!existing.includes(base)) return base;
  for (let i = 2; ; i++) {
    const name = `${base}-${i}`;
    if (!existing.includes(name)) return name;
  }
}

export function McpConnectFlow({
  existingNames,
  searchRegistry,
  testServer,
  onAdded,
  onAdvanced,
  onCancel,
  openExternal,
}: McpConnectFlowProps) {
  const { locale } = useLocale();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<RegistrySearchState>({ kind: "idle" });
  const [selected, setSelected] = useState<{ option: ConnectOption; signupUrl?: string; keyCheckUrl?: string } | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<McpKeyPhase>({ kind: "idle" });

  const pick = (option: ConnectOption, signupUrl?: string, keyCheckUrl?: string) => {
    setSelected({ option, signupUrl, keyCheckUrl });
    setValues({});
    setPhase({ kind: "idle" });
  };

  const runSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearch({ kind: "loading" });
    try {
      setSearch({ kind: "done", results: toRegistryResults(await searchRegistry(q), q) });
    } catch {
      setSearch({ kind: "error" });
    }
  };

  const connect = async () => {
    if (!selected) return;
    const entry = buildRemoteEntry(
      selected.option,
      values,
      crypto.randomUUID(),
      uniqueName(selected.option.serverName, existingNames),
    );
    setPhase({ kind: "testing" });
    // 握手はキーが違っても通ることがあるので、確かめる口のある接続先は先にキーを見る
    if (selected.keyCheckUrl && entry.apiKey) {
      if ((await checkCuratedKey(selected.keyCheckUrl, entry.apiKey)) === "invalid") {
        setPhase({ kind: "invalidKey" });
        return;
      }
    }
    const result = await testServer(entry);
    if (!result.ok) {
      setPhase({ kind: "error", message: result.message });
      return;
    }
    onAdded(entry, result.count);
  };

  if (selected) {
    return (
      <McpKeyView
        option={selected.option}
        signupUrl={selected.signupUrl}
        values={values}
        phase={phase}
        canConnect={hasRequiredValues(selected.option, values)}
        onValueChange={(header, value) => {
          setValues((prev) => ({ ...prev, [header]: value }));
          if (phase.kind === "error" || phase.kind === "invalidKey") setPhase({ kind: "idle" });
        }}
        onOpenUrl={openExternal}
        onBack={() => setSelected(null)}
        onConnect={() => void connect()}
      />
    );
  }

  return (
    <McpPickView
      curated={CURATED_SERVERS.map((server) => ({ server, text: curatedText(server, locale) }))}
      query={query}
      search={search}
      existingNames={existingNames}
      onQueryChange={setQuery}
      onSearch={() => void runSearch()}
      onPickCurated={(server: CuratedServer) => pick(curatedToOption(server, locale), server.signupUrl, server.keyCheckUrl)}
      onPickRegistry={(option) => pick(option)}
      onOpenUrl={openExternal}
      onAdvanced={onAdvanced}
      onCancel={onCancel}
    />
  );
}
