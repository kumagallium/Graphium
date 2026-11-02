// つながり（辺）についてのメモの表示用ヘルパー。
// 見出し・チップ・付け先チップで「{渡す側} → {受け取る側}」を同じ形で出すための小さな純関数。
// 名前は作成時点のスナップショット（MemoSourceEdge.fromLabel / toLabel）を使う。

import { t } from "../../i18n";
import type { MemoSourceEdge } from "./capture-store";

/** 「{渡す側} → {受け取る側}」。名前が無い端点は「名前のない手順 / 工程」の文言にする */
export function formatMemoEdgeLabel(edge: MemoSourceEdge): string {
  const unnamed = t(edge.graph === "plan" ? "memoEdge.unnamedOperation" : "memoEdge.unnamedStep");
  const from = edge.fromLabel?.trim() || unnamed;
  const to = edge.toLabel?.trim() || unnamed;
  return `${from} → ${to}`;
}
