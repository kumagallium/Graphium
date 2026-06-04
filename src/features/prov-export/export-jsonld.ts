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
import { downloadBlob } from "../../lib/download-file";
import { parseExternalSource } from "../network-graph/external-source";

// ── W3C PROV-JSON-LD 出力型 ──

type W3CProvNode = {
  "@type": string;
  "@id": string;
  // @language は付けない: ノート言語を確実に判定できないため、誤った言語タグ
  // (例: 日本語テキストに @language:"en") を付けるより無タグの方が正しい。
  label?: { "@value": string }[];
  [key: string]: any;
};

type W3CProvDocument = {
  // 1 要素目: ローカル @context（prefix + 使用する PROV 用語の定義を inline 化）
  // 2 要素目: openprovenance のリモート context（権威的な解決元として保持）
  "@context": [Record<string, any>, string];
  "@graph": W3CProvNode[];
};

// ── @type 変換マップ ──

const TYPE_MAP: Record<string, string> = {
  "prov:Entity": "Entity",
  "prov:Activity": "Activity",
  "prov:Agent": "Agent",
};

// ── Graphium 内部形式 → W3C PROV-JSON-LD 変換 ──

/** ラベル文字列を W3C 形式のラベル配列に変換。
 *  言語タグは付けない（ノート言語を確実に判定できず、誤タグは無タグより有害なため）。 */
function toW3CLabel(text: string): { "@value": string }[] {
  return [{ "@value": text }];
}

/**
 * ソース ID（derivedFromNotes / citedKnowledgeIds / derivedFromClaims に入る ID）を
 * PROV Entity の @id に解決する。
 *
 * - `pdf:` / `url:` / `document:` / `chat:` プレフィックス付き → 型付き外部ソースノード
 *   （来歴ビューの parseExternalSource と同じ解決規則。`graphium:note/document:<id>` の
 *   ような不正参照を防ぐ）
 * - それ以外 → 通常ノート参照
 *
 * `declare` は参照先 Entity を宣言するための最小ノード。これを @graph に積むことで
 * Derivation.usedEntity が宙に浮く（dangling reference）のを防ぐ。
 */
function resolveSourceEntity(id: string): { usedEntity: string; declare: W3CProvNode } {
  const ext = parseExternalSource(id);
  if (ext) {
    const usedEntity = `graphium:${ext.kind}/${encodeURIComponent(ext.key)}`;
    return {
      usedEntity,
      declare: {
        "@type": "Entity",
        "@id": usedEntity,
        label: toW3CLabel(ext.key),
        "graphium:sourceKind": ext.kind,
      },
    };
  }
  const usedEntity = `graphium:note/${encodeURIComponent(id)}`;
  return {
    usedEntity,
    declare: {
      "@type": "Entity",
      "@id": usedEntity,
      label: toW3CLabel(id),
      // このエクスポートはノート単位なので、派生元ノートの実体は別ファイルにある。
      // 参照を解決可能にするための外部スタブであることを示す。
      "graphium:external": true,
    },
  };
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

    // wasGeneratedBy は配列（同一 Entity が複数 Activity に生成され得る）。
    // 各生成元 Activity ごとに Generation を 1 本ずつ分離する。
    if (node["prov:wasGeneratedBy"]) {
      for (const ref of node["prov:wasGeneratedBy"]) {
        w3cNodes.push({
          "@type": "Generation",
          "@id": `_:generation_${node["@id"]}_${ref["@id"]}`,
          entity: node["@id"],
          activity: ref["@id"],
        });
      }
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
        // xsd:dateTime として型付け（startTime/endTime と整合。無タグだと文字列扱い）
        w3cNode["prov:generatedAtTime"] = {
          "@value": node["prov:generatedAtTime"],
          "@type": "xsd:dateTime",
        };
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
  /** Cmd-K verb 取り込み（R2 / PR3）で引用・精査した知見/洞察ノートの ID（PR4 / L2）。
   *  これらを wasDerivedFrom（Derivation）として PROV グラフに出す。 */
  citedKnowledgeIds?: string[];
  /** Atom (Insights) が抽象化した元 Claim/Concept ノートの ID（atom のみ）。
   *  Atom の上流はこの lane に入るため、export に出さないと Atom が来歴エッジを
   *  持たない孤児になる。app 内グラフ（atomize エッジ）と揃えるため Derivation を出す。 */
  derivedFromClaims?: string[];
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
    // Attribution の agent / Derivation の usedEntity が参照する Entity・Agent を
    // 「宣言済みノード」として 1 度だけ @graph に積むための dedup マップ。
    // これがないと参照先が型付きノードとして宣言されず dangling reference になる。
    const declaredRefs = new Map<string, W3CProvNode>();

    for (const wiki of wikiEntities) {
      const wikiId = `graphium:wiki/${encodeURIComponent(wiki.title)}`;
      const wikiNode: W3CProvNode = {
        "@type": "Entity",
        "@id": wikiId,
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

      // Derivation: Wiki → 上流ソース。3 つの来歴 lane を同じ規則で出す。
      //   - derivedFromNotes : 派生元ノート（外部ソース prefix を含み得る）
      //   - citedKnowledgeIds: Cmd-K verb 取り込みで引用・精査した知見/洞察（PR4 L2）
      //   - derivedFromClaims: Atom が抽象化した元 Claim/Concept（atomize lane / app グラフと整合）
      const deriveLanes: { ids: string[] | undefined; tag: string }[] = [
        { ids: wiki.derivedFromNotes, tag: "deriv" },
        { ids: wiki.citedKnowledgeIds, tag: "cited" },
        { ids: wiki.derivedFromClaims, tag: "claim" },
      ];
      for (const { ids, tag } of deriveLanes) {
        for (const sourceId of ids ?? []) {
          const { usedEntity, declare } = resolveSourceEntity(sourceId);
          graph.push({
            "@type": "Derivation",
            "@id": `_:wiki_${tag}_${encodeURIComponent(wiki.title)}_${encodeURIComponent(sourceId)}`,
            generatedEntity: wikiId,
            usedEntity,
          } as any);
          if (!declaredRefs.has(usedEntity)) declaredRefs.set(usedEntity, declare);
        }
      }

      // Attribution: Wiki → AI Agent
      const agentId = `graphium:agent/${encodeURIComponent(wiki.model)}`;
      graph.push({
        "@type": "Attribution",
        "@id": `_:wiki_attr_${encodeURIComponent(wiki.title)}`,
        entity: wikiId,
        agent: agentId,
      } as any);
      // 参照される AI Agent を prov:Agent ノードとして宣言（model 単位で dedup）
      if (!declaredRefs.has(agentId)) {
        declaredRefs.set(agentId, {
          "@type": "Agent",
          "@id": agentId,
          label: toW3CLabel(wiki.model),
          "graphium:agentType": "ai",
        });
      }
    }

    // Attribution / Derivation が参照する Agent・Entity を型付きノードとして宣言。
    // 既存ノード（graphium:wiki/* など）と @id が衝突しない参照のみが入る。
    for (const node of declaredRefs.values()) graph.push(node);
  }

  // Document Provenance（編集来歴）を Bundle として追加
  if (provDoc["graphium:documentProvenance"]) {
    const docProvNodes = convertDocumentProvenance(provDoc["graphium:documentProvenance"]);
    graph.push({
      // prov:Bundle（prov 接頭辞はローカル context で定義済み）。bare "Bundle" は
      // openprovenance context にもローカルにも未定義で prov:Bundle に展開されないため使わない。
      "@type": "prov:Bundle",
      "@id": `graphium:documentProvenance/${encodeURIComponent(title)}`,
      "@graph": docProvNodes,
    } as any);
  }

  return {
    "@context": [
      {
        // 名前空間 prefix
        prov: "http://www.w3.org/ns/prov#",
        xsd: "http://www.w3.org/2001/XMLSchema#",
        rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
        rdfs: "http://www.w3.org/2000/01/rdf-schema#",
        graphium: "https://graphium.app/ns#",
        foaf: "http://xmlns.com/foaf/0.1/",
        dcterms: "http://purl.org/dc/terms/",
        // PROV 用語を inline 定義（openprovenance context と同じ意味）。
        // 末尾の remote context が権威的解決元（オンライン時はそちらが優先されるため
        // 出力の意味は不変）。inline 定義はファイルを自己記述的にし、リモート不在時の
        // 解決手がかりを残す目的。
        Entity: "prov:Entity",
        Activity: "prov:Activity",
        Agent: "prov:Agent",
        Bundle: "prov:Bundle",
        Usage: "prov:Usage",
        Generation: "prov:Generation",
        Derivation: "prov:Derivation",
        Association: "prov:Association",
        Attribution: "prov:Attribution",
        label: { "@id": "rdfs:label" },
        type: { "@id": "rdf:type", "@type": "@id" },
        activity: { "@id": "prov:activity", "@type": "@id" },
        entity: { "@id": "prov:entity", "@type": "@id" },
        agent: { "@id": "prov:agent", "@type": "@id" },
        usedEntity: { "@id": "prov:entity", "@type": "@id" },
        generatedEntity: { "@reverse": "prov:qualifiedDerivation", "@type": "@id" },
        startTime: { "@id": "prov:startedAtTime", "@type": "xsd:dateTime" },
        endTime: { "@id": "prov:endedAtTime", "@type": "xsd:dateTime" },
      },
      "https://openprovenance.org/prov-jsonld/context.jsonld",
    ],
    "@graph": graph,
  };
}

/**
 * PROV-JSON-LD をファイルとしてダウンロード
 */
export async function exportProvJsonLd(options: {
  title: string;
  provDoc: ProvJsonLd;
  wikiEntities?: WikiEntityInfo[];
}): Promise<void> {
  const { title, provDoc, wikiEntities } = options;

  const jsonLd = buildW3CProvJsonLd(provDoc, title, wikiEntities);
  const jsonStr = JSON.stringify(jsonLd, null, 2);

  const blob = new Blob([jsonStr], { type: "application/ld+json" });
  const filename = `${title.replace(/[/\\?%*:|"<>]/g, "_")}.jsonld`;
  await downloadBlob(blob, filename);
}
