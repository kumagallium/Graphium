// PROV-JSON-LD エクスポート機能
// ノート（ページ）単位で W3C PROV-JSON-LD 準拠のファイルをダウンロードする
// 仕様: https://www.w3.org/submissions/2024/SUBM-prov-jsonld-20240825/

import type { ProvJsonLd, ProvJsonLdNode } from "../prov-generator";
import type { DocumentProvenanceBundle } from "../document-provenance/prov-output";
import type {
  AtomType,
  ClaimRole,
  HypothesisStatus,
  ProcedureContext,
  SynthesisMode,
  WikiKind,
} from "../../lib/document-types";

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

/** graphium: プレフィックス付きの拡張プロパティを抽出 */
function extractExtensionProps(node: ProvJsonLdNode): Record<string, any> {
  const SKIP_KEYS = new Set(["graphium:blockId", "graphium:sampleId", "graphium:entityType", "graphium:attributes"]);
  const ext: Record<string, any> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("graphium:") && !SKIP_KEYS.has(key)) {
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
    if (node["graphium:entityType"]) {
      w3cNode["type"] = [{ "@value": node["graphium:entityType"] }];
    }

    // graphium:blockId → 拡張プロパティとして保持
    if (node["graphium:blockId"]) {
      w3cNode["graphium:blockId"] = node["graphium:blockId"];
    }
    if (node["graphium:sampleId"]) {
      w3cNode["graphium:sampleId"] = node["graphium:sampleId"];
    }

    // graphium:attributes → 拡張プロパティとして保持
    if (node["graphium:attributes"] && node["graphium:attributes"].length > 0) {
      w3cNode["graphium:attributes"] = node["graphium:attributes"].map((attr) => ({
        label: toW3CLabel(attr["rdfs:label"]),
        ...(attr["graphium:blockId"] ? { "graphium:blockId": attr["graphium:blockId"] } : {}),
      }));
    }

    // その他の graphium: 拡張プロパティ
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

    // wasDerivedFrom: execution Entity → plan Entity（Plan/Execution の派生関係）
    if (node["prov:wasDerivedFrom"]) {
      for (const ref of node["prov:wasDerivedFrom"]) {
        w3cNodes.push({
          "@type": "Derivation",
          "@id": `_:derivation_${node["@id"]}_${ref["@id"]}`,
          generatedEntity: node["@id"],
          usedEntity: ref["@id"],
        });
      }
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
      if (node["graphium:agentType"]) {
        w3cNode["graphium:agentType"] = node["graphium:agentType"];
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
      if (node["graphium:editType"]) {
        w3cNode["graphium:editType"] = node["graphium:editType"];
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
      if (node["graphium:summary"]) {
        w3cNode["graphium:summary"] = node["graphium:summary"];
      }
      if (node["graphium:driveRevisionId"]) {
        w3cNode["graphium:driveRevisionId"] = node["graphium:driveRevisionId"];
      }
      if (node["graphium:contentHash"]) {
        w3cNode["graphium:contentHash"] = node["graphium:contentHash"];
      }
      if (node["graphium:prevContentHash"]) {
        w3cNode["graphium:prevContentHash"] = node["graphium:prevContentHash"];
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
export type WikiEntityInfo = {
  title: string;
  kind: WikiKind | string;
  status: string;
  generatedAt: string;
  model: string;
  derivedFromNotes: string[];
  // Phase 4 (PR-B7): 提案 v4 Phase 1 の意味的な型を PROV-JSON-LD に持ち出す。
  // 内部識別子はそのまま emit する（UI ラベル "Insights" / "Ideas" は表示層の話で、
  // データ上は atomType / synthesisMode を保持し続ける）。
  /** Atom (Insights) の推論的役割。`kind: "atom"` のときに意味を持つ */
  atomType?: AtomType;
  /** Synthesis (Ideas) の推論モード。`kind: "synthesis"` のときに意味を持つ */
  synthesisMode?: SynthesisMode;
  /** Synthesis の検証状態（特に abductive 型で意味がある） */
  hypothesisStatus?: HypothesisStatus;
  /** Claim の研究プロセス役割（複数可） */
  claimRole?: ClaimRole[];
  /** Claim の抽象度レベル（principle / finding / bridge） */
  level?: "principle" | "finding" | "bridge";
  /** 自己評価された確度（0.0–1.0） */
  confidence?: number;
  /** Claim が依存する手順条件（reproducibility scaffold）。Claim 層のみ */
  procedureContext?: ProcedureContext;
};

export function buildW3CProvJsonLd(provDoc: ProvJsonLd, title: string, wikiEntities?: WikiEntityInfo[]): W3CProvDocument {
  const graph: W3CProvNode[] = [];

  // Content Provenance（実験手順のPROVグラフ）
  graph.push(...convertContentProvenance(provDoc));

  // Wiki Knowledge Layer（AI 生成ドキュメント）を Entity として追加
  if (wikiEntities) {
    for (const wiki of wikiEntities) {
      const wikiNode: W3CProvNode = {
        "@type": "Entity",
        "@id": `graphium:wiki/${encodeURIComponent(wiki.title)}`,
        label: toW3CLabel(wiki.title),
        "graphium:wikiKind": wiki.kind,
        "graphium:wikiStatus": wiki.status,
        "graphium:generatedAt": wiki.generatedAt,
        "graphium:generatedBy": wiki.model,
      };
      // Phase 4 (PR-B7): 砂時計のくびれに対応する意味的な型を持ち出す。
      // atomType / synthesisMode / procedureContext は kind ごとに片方しか意味がないが、
      // 出力側は kind 判別を呼び出し側に委ねず、与えられた値だけを安全に emit する。
      if (wiki.atomType) wikiNode["graphium:atomType"] = wiki.atomType;
      if (wiki.synthesisMode) wikiNode["graphium:synthesisMode"] = wiki.synthesisMode;
      if (wiki.hypothesisStatus) wikiNode["graphium:hypothesisStatus"] = wiki.hypothesisStatus;
      if (wiki.claimRole && wiki.claimRole.length > 0) wikiNode["graphium:claimRole"] = wiki.claimRole;
      if (wiki.level) wikiNode["graphium:claimLevel"] = wiki.level;
      if (typeof wiki.confidence === "number") wikiNode["graphium:confidence"] = wiki.confidence;
      if (wiki.procedureContext) wikiNode["graphium:procedureContext"] = wiki.procedureContext;
      graph.push(wikiNode);

      // Derivation: Wiki → 派生元ノート
      for (const sourceNoteId of wiki.derivedFromNotes) {
        graph.push({
          "@type": "Derivation",
          "@id": `_:wiki_deriv_${encodeURIComponent(wiki.title)}_${sourceNoteId}`,
          generatedEntity: `graphium:wiki/${encodeURIComponent(wiki.title)}`,
          usedEntity: `graphium:note/${sourceNoteId}`,
        } as any);
      }
      // Attribution: Wiki → AI Agent
      graph.push({
        "@type": "Attribution",
        "@id": `_:wiki_attr_${encodeURIComponent(wiki.title)}`,
        entity: `graphium:wiki/${encodeURIComponent(wiki.title)}`,
        agent: `graphium:agent/${encodeURIComponent(wiki.model)}`,
      } as any);
    }
  }

  // Document Provenance（編集来歴）を Bundle として追加
  if (provDoc["graphium:documentProvenance"]) {
    const docProvNodes = convertDocumentProvenance(provDoc["graphium:documentProvenance"]);
    graph.push({
      "@type": "Bundle",
      "@id": `graphium:documentProvenance/${encodeURIComponent(title)}`,
      "@graph": docProvNodes,
    } as any);
  }

  return {
    "@context": [
      {
        prov: "http://www.w3.org/ns/prov#",
        xsd: "http://www.w3.org/2001/XMLSchema#",
        graphium: "https://graphium.app/ns#",
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
  wikiEntities?: WikiEntityInfo[];
}): void {
  const { title, provDoc, wikiEntities } = options;

  const jsonLd = buildW3CProvJsonLd(provDoc, title, wikiEntities);
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
