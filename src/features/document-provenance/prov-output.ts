// DocumentProvenance → PROV-JSON-LD Bundle 変換
// Content Provenance と分離して prov:Bundle として出力する

import type { DocumentProvenance } from "./types";

/** PROV-JSON-LD の Bundle 内ノード */
type ProvBundleNode = {
  "@id": string;
  "@type": string;
  [key: string]: any;
};

/** DocumentProvenance Bundle の型 */
export type DocumentProvenanceBundle = {
  "@type": "prov:Bundle";
  "@graph": ProvBundleNode[];
};

/** DocumentProvenance を PROV-JSON-LD Bundle に変換 */
export function buildDocumentProvenanceBundle(
  provenance: DocumentProvenance,
): DocumentProvenanceBundle | undefined {
  if (provenance.revisions.length === 0) return undefined;

  const graph: ProvBundleNode[] = [];

  // prov:Agent ノード
  for (const agent of provenance.agents) {
    const agentNode: ProvBundleNode = {
      "@id": agent.id,
      "@type": "prov:Agent",
      "rdfs:label": agent.label,
      "provnote:agentType": agent.type,
    };
    if (agent.email) agentNode["foaf:mbox"] = agent.email;
    graph.push(agentNode);
  }

  // prov:Activity ノード
  for (const activity of provenance.activities) {
    graph.push({
      "@id": activity.id,
      "@type": "prov:Activity",
      "provnote:editType": activity.type,
      "prov:startedAtTime": activity.startedAt,
      "prov:endedAtTime": activity.endedAt,
      "prov:wasAssociatedWith": { "@id": activity.wasAssociatedWith },
    });
  }

  // prov:Entity ノード（リビジョン）
  for (const revision of provenance.revisions) {
    const node: ProvBundleNode = {
      "@id": revision.id,
      "@type": "prov:Entity",
      "prov:generatedAtTime": revision.savedAt,
      "prov:wasGeneratedBy": { "@id": revision.wasGeneratedBy },
      "provnote:summary": revision.summary,
    };
    if (revision.wasDerivedFrom) {
      node["prov:wasDerivedFrom"] = { "@id": revision.wasDerivedFrom };
    }
    if (revision.driveRevisionId) {
      node["provnote:driveRevisionId"] = revision.driveRevisionId;
    }
    node["provnote:contentHash"] = revision.contentHash;
    if (revision.prevContentHash) {
      node["provnote:prevContentHash"] = revision.prevContentHash;
    }
    graph.push(node);
  }

  return {
    "@type": "prov:Bundle",
    "@graph": graph,
  };
}
