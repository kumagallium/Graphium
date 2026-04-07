// PROV-JSON-LD エクスポート機能
// ノート（ページ）単位で W3C PROV-JSON-LD 準拠のファイルをダウンロードする
// 仕様: https://www.w3.org/submissions/2024/SUBM-prov-jsonld-20240825/

import type { ProvJsonLd, ProvJsonLdNode } from "../prov-generator";
import type { DocumentProvenanceBundle } from "../document-provenance/prov-output";

// ── W3C PROV-JSON-LD 出力型 ──

type W3CProvNode = {
  "@type": string;
  "@id": string;
  label?: { "@value": string; "@language": string }[];
  [key: string]: any;
};

type W3CProvDocument = {
  "@context": [Record<string, string>, string];
  "@graph": W3CProvNode[];
};

// ── @type 変換マップ ──

const TYPE_MAP: Record<string, string> = {
  "prov:Entity": "Entity",
  "prov:Activity": "Activity",
  "prov:Agent": "Agent",
};

// ── Graphium 内部形式 → W3C PROV-JSON-LD 変換 ──

/** ラベル文字列を W3C 形式の言語タグ付き配列に変換 */
function toW3CLabel(text: string): { "@value": string; "@language": string }[] {
  return [{ "@value": text, "@language": "en" }];
}

/** provnote: プレフィックス付きの拡張プロパティを抽出 */
function extractExtensionProps(node: ProvJsonLdNode): Record<string, any> {
  const SKIP_KEYS = new Set(["provnote:blockId", "provnote:sampleId", "provnote:entityType", "provnote:attributes"]);
  const ext: Record<string, any> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("provnote:") && !SKIP_KEYS.has(key)) {
      ext[key] = value;
    }
  }
  return ext;
}

/** Content Provenance の @graph ノードを W3C 形式に変換し、関係を分離 */
function convertContentProvenance(provDoc: ProvJsonLd): W3CProvNode[] {
  const w3cNodes: W3CProvNode[] = [];

  for (const node of provDoc["@graph"]) {
    const w3cType = TYPE_MAP[node["@type"]] ?? node["@type"];

    // ノード本体
    const w3cNode: W3CProvNode = {
      "@type": w3cType,
      "@id": node["@id"],
      label: toW3CLabel(node["rdfs:label"]),
    };

    // Entity サブタイプ（MatPROV 互換: material / tool）
    if (node["provnote:entityType"]) {
      w3cNode["type"] = [{ "@value": node["provnote:entityType"] }];
    }

    // provnote:blockId → 拡張プロパティとして保持
    if (node["provnote:blockId"]) {
      w3cNode["provnote:blockId"] = node["provnote:blockId"];
    }
    if (node["provnote:sampleId"]) {
      w3cNode["provnote:sampleId"] = node["provnote:sampleId"];
    }

    // provnote:attributes → 拡張プロパティとして保持
    if (node["provnote:attributes"] && node["provnote:attributes"].length > 0) {
      w3cNode["provnote:attributes"] = node["provnote:attributes"].map((attr) => ({
        label: toW3CLabel(attr["rdfs:label"]),
        ...(attr["provnote:blockId"] ? { "provnote:blockId": attr["provnote:blockId"] } : {}),
      }));
    }

    // その他の provnote: 拡張プロパティ
    Object.assign(w3cNode, extractExtensionProps(node));

    w3cNodes.push(w3cNode);

    // 埋め込み関係 → 分離した W3C 関係オブジェクトに変換
    if (node["prov:used"]) {
      for (const ref of node["prov:used"]) {
        w3cNodes.push({
          "@type": "Usage",
          "@id": `_:usage_${node["@id"]}_${ref["@id"]}`,
          activity: node["@id"],
          entity: ref["@id"],
        });
      }
    }

    if (node["prov:wasGeneratedBy"]) {
      w3cNodes.push({
        "@type": "Generation",
        "@id": `_:generation_${node["@id"]}`,
        entity: node["@id"],
        activity: node["prov:wasGeneratedBy"]["@id"],
      });
    }
  }

  return w3cNodes;
}

/** Document Provenance Bundle を W3C 形式に変換 */
function convertDocumentProvenance(bundle: DocumentProvenanceBundle): W3CProvNode[] {
  const w3cNodes: W3CProvNode[] = [];

  for (const node of bundle["@graph"]) {
    const w3cType = TYPE_MAP[node["@type"]] ?? node["@type"];

    if (w3cType === "Agent") {
      const w3cNode: W3CProvNode = {
        "@type": "Agent",
        "@id": node["@id"],
        label: toW3CLabel(node["rdfs:label"]),
      };
      if (node["provnote:agentType"]) {
        w3cNode["provnote:agentType"] = node["provnote:agentType"];
      }
      if (node["foaf:mbox"]) {
        w3cNode["foaf:mbox"] = node["foaf:mbox"];
      }
      w3cNodes.push(w3cNode);
    } else if (w3cType === "Activity") {
      const w3cNode: W3CProvNode = {
        "@type": "Activity",
        "@id": node["@id"],
      };
      if (node["provnote:editType"]) {
        w3cNode["provnote:editType"] = node["provnote:editType"];
      }
      if (node["prov:startedAtTime"]) {
        w3cNode["startTime"] = node["prov:startedAtTime"];
      }
      if (node["prov:endedAtTime"]) {
        w3cNode["endTime"] = node["prov:endedAtTime"];
      }
      w3cNodes.push(w3cNode);

      // Association 関係を分離
      if (node["prov:wasAssociatedWith"]) {
        w3cNodes.push({
          "@type": "Association",
          "@id": `_:assoc_${node["@id"]}`,
          activity: node["@id"],
          agent: node["prov:wasAssociatedWith"]["@id"],
        });
      }
    } else if (w3cType === "Entity") {
      const w3cNode: W3CProvNode = {
        "@type": "Entity",
        "@id": node["@id"],
      };
      if (node["prov:generatedAtTime"]) {
        w3cNode["prov:generatedAtTime"] = node["prov:generatedAtTime"];
      }
      if (node["provnote:summary"]) {
        w3cNode["provnote:summary"] = node["provnote:summary"];
      }
      if (node["provnote:driveRevisionId"]) {
        w3cNode["provnote:driveRevisionId"] = node["provnote:driveRevisionId"];
      }
      if (node["provnote:contentHash"]) {
        w3cNode["provnote:contentHash"] = node["provnote:contentHash"];
      }
      if (node["provnote:prevContentHash"]) {
        w3cNode["provnote:prevContentHash"] = node["provnote:prevContentHash"];
      }
      w3cNodes.push(w3cNode);

      // Generation 関係を分離
      if (node["prov:wasGeneratedBy"]) {
        w3cNodes.push({
          "@type": "Generation",
          "@id": `_:gen_${node["@id"]}`,
          entity: node["@id"],
          activity: node["prov:wasGeneratedBy"]["@id"],
        });
      }

      // Derivation 関係を分離
      if (node["prov:wasDerivedFrom"]) {
        w3cNodes.push({
          "@type": "Derivation",
          "@id": `_:deriv_${node["@id"]}`,
          generatedEntity: node["@id"],
          usedEntity: node["prov:wasDerivedFrom"]["@id"],
        });
      }
    }
  }

  return w3cNodes;
}

/**
 * Graphium 内部形式を W3C PROV-JSON-LD 準拠ドキュメントに変換
 */
function buildW3CProvJsonLd(provDoc: ProvJsonLd, title: string): W3CProvDocument {
  const graph: W3CProvNode[] = [];

  // Content Provenance（実験手順のPROVグラフ）
  graph.push(...convertContentProvenance(provDoc));

  // Document Provenance（編集来歴）を Bundle として追加
  if (provDoc["provnote:documentProvenance"]) {
    const docProvNodes = convertDocumentProvenance(provDoc["provnote:documentProvenance"]);
    graph.push({
      "@type": "Bundle",
      "@id": `provnote:documentProvenance/${encodeURIComponent(title)}`,
      "@graph": docProvNodes,
    } as any);
  }

  return {
    "@context": [
      {
        prov: "http://www.w3.org/ns/prov#",
        xsd: "http://www.w3.org/2001/XMLSchema#",
        provnote: "https://provnote.app/ns#",
        foaf: "http://xmlns.com/foaf/0.1/",
        dcterms: "http://purl.org/dc/terms/",
      },
      "https://openprovenance.org/prov-jsonld/context.jsonld",
    ],
    "@graph": graph,
  };
}

/**
 * PROV-JSON-LD をファイルとしてダウンロード
 */
export function exportProvJsonLd(options: {
  title: string;
  provDoc: ProvJsonLd;
}): void {
  const { title, provDoc } = options;

  const jsonLd = buildW3CProvJsonLd(provDoc, title);
  const jsonStr = JSON.stringify(jsonLd, null, 2);

  const blob = new Blob([jsonStr], { type: "application/ld+json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/[/\\?%*:|"<>]/g, "_")}.jsonld`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
