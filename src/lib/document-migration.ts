// ──────────────────────────────────────────────
// GraphiumDocument マイグレーション
//
// 各プロバイダ（google-drive / local / filesystem）が loadFile 時に
// 呼び出す共通関数。読み込んだドキュメントを最新 version に正規化する。
//
// version 履歴:
//   1 → 2: links フィールドを provLinks / knowledgeLinks に分離
//   2 → 3: labels の値を日本語ブラケット（[材料] 等）から内部キー（material 等）に移行
// ──────────────────────────────────────────────

import type { GraphiumDocument } from "./document-types";
import { normalizeLabel, classifyLabel } from "../features/context-label/labels";

export const LATEST_DOCUMENT_VERSION = 3;

/** 読み込んだドキュメントを最新 version に揃える（破壊的に変更して同じ参照を返す） */
export function migrateToLatest(doc: GraphiumDocument): GraphiumDocument {
  if (!doc || typeof doc !== "object") return doc;

  // v1 → v2: links を provLinks / knowledgeLinks に分離
  migrateLinksToV2(doc);

  // v2 → v3: labels の値を内部キーに正規化
  if ((doc.version ?? 1) < 3) {
    migrateLabelsToV3(doc);
    doc.version = 3;
  }

  return doc;
}

/** v1 → v2: ページ内の links を provLinks / knowledgeLinks に分解 */
function migrateLinksToV2(doc: GraphiumDocument): void {
  for (const page of doc.pages ?? []) {
    if (page.links && !page.provLinks) {
      const provLinks: any[] = [];
      const knowledgeLinks: any[] = [];
      for (const link of page.links) {
        const isProv = !link.type || [
          "derived_from", "used", "generated", "reproduction_of", "informed_by",
        ].includes(link.type);
        if (isProv) {
          provLinks.push({ ...link, layer: "prov" });
        } else {
          knowledgeLinks.push({ ...link, layer: "knowledge" });
        }
      }
      page.provLinks = provLinks;
      page.knowledgeLinks = knowledgeLinks;
    }
    if (!page.provLinks) page.provLinks = [];
    if (!page.knowledgeLinks) page.knowledgeLinks = [];
  }
  if ((doc.version ?? 1) < 2) {
    doc.version = 2;
  }
}

/**
 * v2 → v3: labels の値を内部キーに正規化する。
 * 既知のエイリアス（[材料] 等）は ALIAS_MAP で内部キーに変換する。
 * 未知のラベル文字列はそのまま保持（フリーラベル扱い）。
 */
function migrateLabelsToV3(doc: GraphiumDocument): void {
  for (const page of doc.pages ?? []) {
    if (!page.labels) continue;
    const next: Record<string, string> = {};
    for (const [blockId, rawLabel] of Object.entries(page.labels)) {
      if (typeof rawLabel !== "string") continue;
      const layer = classifyLabel(rawLabel);
      // core / alias 両方に対して normalizeLabel が正規化する
      next[blockId] = layer === "free" ? rawLabel : normalizeLabel(rawLabel);
    }
    page.labels = next;
  }
}
