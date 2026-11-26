// 回答の下に修正案のカードを並べる（ChatBubble から使う。ノートの横のチャット・単独のチャット共通）
// 状態は controller の appData から読み、反映・やめる・元に戻すも controller に任せる。

import { useState } from "react";
import type { ChatEditProposal } from "../../../lib/document-types";
import { applyProposal, canUndo, declineProposal, openEditTarget, undoProposal, useEditProposalStatuses } from "./controller";
import { EditProposalCard } from "./EditProposalCard";

export function EditProposalList({ proposals }: { proposals: ChatEditProposal[] }) {
  const statuses = useEditProposalStatuses();
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (proposalId: string, fn: () => Promise<unknown>) => {
    setBusy(proposalId);
    try {
      await fn();
    } catch (err) {
      console.error("修正案の操作に失敗:", err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-2 space-y-2">
      {proposals.map((p) => {
        const appliedIds = p.changes.filter((c) => statuses[c.id] === "applied").map((c) => c.id);
        return (
          <EditProposalCard
            key={p.id}
            proposal={p}
            statuses={statuses}
            busy={busy === p.id}
            onApply={(ids) => void run(p.id, () => applyProposal(p, ids))}
            onDecline={(ids) => declineProposal(ids)}
            onUndo={appliedIds.length > 0 && canUndo(appliedIds) ? (ids) => void run(p.id, () => undoProposal(ids)) : undefined}
            onOpenTarget={() => openEditTarget(p.target)}
          />
        );
      })}
    </div>
  );
}
