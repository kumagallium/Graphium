// 実行前の確認ダイアログ（MCP の道具）。
//
// AI が書き換えるかもしれない道具（Slack への投稿など）を呼ぶ前に、何をどこへ
// 送るのかを見せて、実行するかを利用者に決めてもらう。
// - 見せるのは、どのサーバーの、どの道具に、どんな値を渡すか（値は 1 行ずつ「名前: 値」）
// - 「このサーバーは今後確認しない」で、以後そのサーバーの道具は聞かずに実行する（設定から戻せる）
// - Esc・外側のクリック・×は「実行しない」

import { useEffect, useState } from "react";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@ui/modal";
import { Button } from "@ui/button";
import { useT } from "../../i18n";
import {
  answerToolApproval,
  registerToolApprovalHost,
  usePendingToolApproval,
  type ToolApprovalAnswer,
  type ToolApprovalRequest,
} from "./tool-approval";

/** 1 つの値として見せる長さの上限（長い本文は先頭だけ） */
const MAX_VALUE_CHARS = 600;

function formatValue(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? String(value);
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}…` : text;
}

/** 渡す値を「名前: 値」の並びにする。オブジェクトでなければ 1 行で */
export function approvalInputRows(input: unknown): { key: string; value: string }[] {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return Object.entries(input as Record<string, unknown>).map(([key, value]) => ({ key, value: formatValue(value) }));
  }
  if (input === undefined || input === null) return [];
  return [{ key: "", value: formatValue(input) }];
}

export type ToolApprovalDialogViewProps = {
  request: ToolApprovalRequest;
  onAnswer: (answer: ToolApprovalAnswer) => void;
};

/** 見た目だけの部品（Storybook でも使う） */
export function ToolApprovalDialogView({ request, onAnswer }: ToolApprovalDialogViewProps) {
  const t = useT();
  const [remember, setRemember] = useState(false);
  const rows = approvalInputRows(request.input);
  const toolLabel = request.title || request.name;
  const decline = () => onAnswer({ approved: false, remember: false });

  return (
    <Modal open onClose={decline} className="w-[min(32rem,calc(100vw-2rem))]">
      <ModalHeader onClose={decline}>{t("toolApproval.title")}</ModalHeader>
      <ModalBody className="space-y-3">
        <p className="text-sm text-foreground">
          {t("toolApproval.lead", { server: request.server || "MCP", tool: toolLabel })}
        </p>
        <p className="text-xs text-muted-foreground">{t("toolApproval.why")}</p>
        {rows.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-foreground">{t("toolApproval.inputs")}</p>
            <dl className="max-h-60 space-y-1.5 overflow-y-auto rounded-md border border-border bg-muted/40 p-2">
              {rows.map((r, i) => (
                <div key={`${r.key}-${i}`} className="text-xs">
                  {r.key && <dt className="font-medium text-muted-foreground">{r.key}</dt>}
                  <dd className="whitespace-pre-wrap break-words font-mono text-foreground">{r.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span>{t("toolApproval.remember", { server: request.server || "MCP" })}</span>
        </label>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" size="sm" onClick={decline}>
          {t("toolApproval.decline")}
        </Button>
        <Button size="sm" onClick={() => onAnswer({ approved: true, remember })}>
          {t("toolApproval.approve")}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/** アプリに 1 つ置く。確認の頼みが来たら先頭の 1 件を出す */
export function ToolApprovalHost() {
  const pending = usePendingToolApproval();
  useEffect(() => registerToolApprovalHost(), []);
  if (!pending) return null;
  // key で頼みごとに作り直し、チェックの状態を持ち越さない
  return <ToolApprovalDialogView key={pending.id} request={pending.request} onAnswer={(a) => answerToolApproval(pending.id, a)} />;
}
