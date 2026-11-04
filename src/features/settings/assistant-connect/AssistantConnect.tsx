// 設定 > AI「外の AI からノートを使う」の容器。見た目は AssistantConnectView、
// ここは /api/assistant-connect の呼び出しと、行ごとの「登録中・失敗」だけを持つ。

import { useCallback, useEffect, useState } from "react";
import { apiBase } from "../../../lib/platform";
import {
  AssistantConnectView,
  type AssistantClientId,
  type AssistantConnectViewProps,
  type AssistantRowState,
} from "./AssistantConnectView";

type ServerRowStatus = "idle" | "registered" | "outdated" | "needs-quit" | "no-cli";

type ServerStatus = {
  available: boolean;
  rows: Record<AssistantClientId, ServerRowStatus>;
  snippets: AssistantConnectViewProps["snippets"];
};

const base = () => `${apiBase()}/assistant-connect`;

const toRow = (s: ServerRowStatus): AssistantRowState => ({ kind: s });

export function AssistantConnect() {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [rows, setRows] = useState<Record<AssistantClientId, AssistantRowState> | null>(null);
  const [copied, setCopied] = useState<AssistantConnectViewProps["copied"]>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(base());
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const data = (await res.json()) as ServerStatus;
      setStatus(data);
      setRows({
        "claude-desktop": toRow(data.rows["claude-desktop"]),
        "claude-code": toRow(data.rows["claude-code"]),
        codex: toRow(data.rows.codex),
      });
    } catch {
      // サーバーに届かない（Web 版など）は「デスクトップ版でだけ」の案内にする
      setStatus({ available: false, rows: { "claude-desktop": "idle", "claude-code": "idle", codex: "idle" }, snippets: { "claude-code": "", codex: "", json: "" } });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRegister = useCallback(async (id: AssistantClientId) => {
    setRows((prev) => (prev ? { ...prev, [id]: { kind: "working" } } : prev));
    let next: AssistantRowState;
    try {
      const res = await fetch(`${base()}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: id }),
      });
      const data = (await res.json().catch(() => ({}))) as { status?: ServerRowStatus; error?: string };
      next = res.ok && data.status ? toRow(data.status) : { kind: "error", message: data.error ?? `Error ${res.status}` };
    } catch (err) {
      next = { kind: "error", message: err instanceof Error ? err.message : String(err) };
    }
    setRows((prev) => (prev ? { ...prev, [id]: next } : prev));
  }, []);

  const onCopy = useCallback(
    async (id: Exclude<AssistantClientId, "claude-desktop"> | "json") => {
      if (!status) return;
      try {
        await navigator.clipboard.writeText(status.snippets[id]);
        setCopied(id);
        setTimeout(() => setCopied((cur) => (cur === id ? null : cur)), 2000);
      } catch {
        /* クリップボードに書けない環境では何もしない（文字は選択してコピーできる） */
      }
    },
    [status],
  );

  if (!status || (status.available && !rows)) return null;
  return (
    <AssistantConnectView
      available={status.available}
      rows={rows ?? { "claude-desktop": { kind: "idle" }, "claude-code": { kind: "idle" }, codex: { kind: "idle" } }}
      snippets={status.snippets}
      copied={copied}
      onRegister={onRegister}
      onCopy={onCopy}
    />
  );
}
