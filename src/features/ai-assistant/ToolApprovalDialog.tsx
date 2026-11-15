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

/** 最初に見せる長さの上限。超える値は「すべて表示」で全文を確かめられる */
const MAX_VALUE_CHARS = 600;

export type ApprovalInputRow = {
  key: string;
  /** 最初に見せる文字列（長ければ先頭だけ＋「…」） */
  value: string;
  /** 全文 */
  full: string;
  /** value が full を切り詰めたものか */
  truncated: boolean;
};

function formatValue(key: string, value: unknown): ApprovalInputRow {
  const full = typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? String(value);
  const truncated = full.length > MAX_VALUE_CHARS;
  return { key, value: truncated ? `${full.slice(0, MAX_VALUE_CHARS)}…` : full, full, truncated };
}

/** 渡す値を「名前: 値」の並びにする。オブジェクトでなければ 1 行で */
export function approvalInputRows(input: unknown): ApprovalInputRow[] {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return Object.entries(input as Record<string, unknown>).map(([key, value]) => formatValue(key, value));
  }
  if (input === undefined || input === null) return [];
  return [formatValue("", input)];
}

export type ToolApprovalDialogViewProps = {
  request: ToolApprovalRequest;
  onAnswer: (answer: ToolApprovalAnswer) => void;
};

/** 見た目だけの部品（Storybook でも使う） */
export function ToolApprovalDialogView({ request, onAnswer }: ToolApprovalDialogViewProps) {
  const t = useT();
  const [remember, setRemember] = useState(false);
  // 「すべて表示」で全文を開いた行（行の番号）
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggleExpanded = (i: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(i)) next.add(i);
      return next;
    });
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
        {rows.some((r) => r.truncated) && (
          <p className="text-xs text-amber-700 dark:text-amber-400">{t("toolApproval.shortened")}</p>
        )}
        {rows.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-foreground">{t("toolApproval.inputs")}</p>
            <dl className="max-h-60 space-y-1.5 overflow-y-auto rounded-md border border-border bg-muted/40 p-2">
              {rows.map((r, i) => (
                <div key={`${r.key}-${i}`} className="text-xs">
                  {r.key && <dt className="font-medium text-muted-foreground">{r.key}</dt>}
                  <dd className="whitespace-pre-wrap break-words font-mono text-foreground">
                    {expanded.has(i) ? r.full : r.value}
                  </dd>
                  {r.truncated && (
                    <button
                      type="button"
                      className="mt-0.5 text-xs text-primary underline"
                      aria-expanded={expanded.has(i)}
                      onClick={() => toggleExpanded(i)}
                    >
                      {expanded.has(i) ? t("toolApproval.collapse") : t("toolApproval.showAll", { count: String(r.full.length) })}
                    </button>
                  )}
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
