// 「固定した内容を確かめる」の結果を、人が読む文章にする。

import { formatDateTime } from "../version-snapshots/SnapshotRow";
import type { SealReport } from "./seal-actions";
import { TSA_REGISTRY } from "./tsa-registry";

type T = (key: string, vars?: Record<string, string>) => string;

/** 受領書の送り先を、画面に出す名前にする */
function proofName(kind: "rfc3161" | "opentimestamps", endpoint: string): string {
  if (kind === "opentimestamps") return "OpenTimestamps";
  return TSA_REGISTRY.find((t) => t.url === endpoint)?.name ?? endpoint;
}

export function formatSealReport(report: SealReport, t: T): string {
  const lines: string[] = [t("version.seal.reportTitle"), ""];
  const { local, receipts, chain } = report;

  if (!local.found) lines.push(t("version.seal.reportMissing"));
  else if (!local.manifestIntact) lines.push(t("version.seal.reportTampered"));
  else lines.push(t("version.seal.reportIntact"));

  if (receipts.length === 0) lines.push(t("version.seal.reportNoProof"));
  for (const r of receipts) {
    const name = proofName(r.kind, r.endpoint);
    if (r.status !== "confirmed") {
      lines.push(t("version.seal.reportProofPending", { name }));
    } else if (r.ok && r.provenAt) {
      lines.push(t("version.seal.reportProofOk", { name, time: formatDateTime(r.provenAt.toISOString()) }));
    } else {
      lines.push(t("version.seal.reportProofFailed", { name, message: r.message ?? "" }));
    }
  }

  const count = (s: string) => local.media.filter((m) => m.status === s).length;
  if (count("changed") > 0) lines.push(t("version.seal.reportMediaChanged", { count: String(count("changed")) }));
  if (count("missing") > 0) lines.push(t("version.seal.reportMediaMissing", { count: String(count("missing")) }));
  if (count("skipped") > 0) lines.push(t("version.seal.reportMediaSkipped", { count: String(count("skipped")) }));

  if (chain.problems.length > 0) lines.push(t("version.seal.reportChainProblem"));
  return lines.join("\n");
}
