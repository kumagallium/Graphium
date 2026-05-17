// MatPROV 形式 → Graphium ProvIngesterOutput への翻訳層（Phase 5a）。
//
// docs/internal/external-source-extraction-prompt.md §5 の規則に従う:
//   - Activity → H2 procedure heading + 段落（procedure scope を開く）
//   - Usage edge の Entity (material/tool) → 段落内の inline span
//   - Generation edge の Entity → 段落内の inline span（role: "output"）
//   - Activity の parameter → 段落内の inline attribute span
//   - Entity の parameter → 同 Entity span の直後の attribute span
//   - 別 Activity が Generation した Entity を Usage する場合、material span の
//     derivedFrom にその Activity の stepId を入れる
//
// 散文は最小限の英語コネクタ（Use / with / at / to obtain）で組み立てる。
// MatPROV gold standard と整合するのは @value の単語ベースで、prose 自体の自然さは
// 重視しない（benchmark の比較対象は MatPROV 形式の構造）。

import type {
  MatProvActivity,
  MatProvEdge,
  MatProvEntity,
  MatProvNode,
  MatProvProcedure,
} from "./matprov-types";
import { readEntityType, readLabel, readParameters } from "./matprov-types";
import type {
  ProvIngesterBlock,
  ProvIngesterOutput,
  ProvSpan,
} from "../prov-ingester";

/**
 * MatPROV procedure 1 件を ProvIngesterOutput に変換する。
 * 既存 prov-note-builder.ts でそのままノートに組み上がる構造を返す。
 */
export function matProvToProvIngester(
  procedure: MatProvProcedure,
): ProvIngesterOutput {
  const title = procedure.label?.trim() || "Material synthesis procedure";
  const blocks = buildBlocksFromProcedure(procedure);
  return { title, blocks };
}

/**
 * MatPROV procedure の @graph から ProvIngesterBlock[] を組み立てる。
 *
 * - intro 段落 1 つ（procedure ラベルを文として書く）
 * - Activity ごとに H2 procedure heading + 段落
 */
export function buildBlocksFromProcedure(
  procedure: MatProvProcedure,
): ProvIngesterBlock[] {
  const graph = procedure["@graph"];

  // node / edge を分解
  const entities = new Map<string, MatProvEntity>();
  const activities: MatProvActivity[] = [];
  const usages: MatProvEdge[] = []; // Entity → Activity
  const generations: MatProvEdge[] = []; // Activity → Entity

  for (const item of graph) {
    if (item["@type"] === "Entity") entities.set(item["@id"], item);
    else if (item["@type"] === "Activity") activities.push(item);
    else if (item["@type"] === "Usage") usages.push(item);
    else if (item["@type"] === "Generation") generations.push(item);
  }

  // Activity 出現順は MatPROV のフロー順を保持しているので、それを使う
  // （後で derivedFrom 解決にも使う）。
  const orderedActivities = activities;

  // Generation edge: entity → activity がそれを生成
  const entityGeneratedBy = new Map<string, string>(); // eid → aid
  for (const g of generations) {
    entityGeneratedBy.set(g.entity, g.activity);
  }

  // stepId 割り当て（gerund label のスラグ、重複は連番）
  const stepIdByActivity = new Map<string, string>();
  const usedStepIds = new Set<string>();
  for (const a of orderedActivities) {
    const labelText = readLabel(a.label) || a["@id"];
    let base = slugify(labelText);
    if (!base) base = `step-${a["@id"]}`;
    let stepId = base;
    let suffix = 2;
    while (usedStepIds.has(stepId)) {
      stepId = `${base}-${suffix++}`;
    }
    usedStepIds.add(stepId);
    stepIdByActivity.set(a["@id"], stepId);
  }

  // intro 段落
  const intro: ProvIngesterBlock = {
    blockType: "paragraph",
    content: [
      {
        text: introSentence(procedure.label, orderedActivities.length),
      },
    ],
  };

  const out: ProvIngesterBlock[] = [intro];

  // Activity ごとに heading + 段落を生成
  for (const activity of orderedActivities) {
    const aid = activity["@id"];
    const stepId = stepIdByActivity.get(aid)!;
    const headingText = readLabel(activity.label) || aid;

    out.push({
      blockType: "heading",
      level: 2,
      text: capitalize(headingText),
      role: "procedure",
      stepId,
    });

    const usageEids = usages.filter((u) => u.activity === aid).map((u) => u.entity);
    const generationEids = generations
      .filter((g) => g.activity === aid)
      .map((g) => g.entity);

    const spans = buildActivityParagraphSpans({
      activity,
      usageEntities: usageEids
        .map((eid) => entities.get(eid))
        .filter((e): e is MatProvEntity => !!e),
      generationEntities: generationEids
        .map((eid) => entities.get(eid))
        .filter((e): e is MatProvEntity => !!e),
      entityGeneratedBy,
      stepIdByActivity,
    });

    out.push({
      blockType: "paragraph",
      content: spans,
    });
  }

  return out;
}

/** procedure 全体の intro 段落 */
function introSentence(label: string, stepCount: number): string {
  const safeLabel = label?.trim() || "this material";
  return `Synthesis procedure for ${safeLabel} (${stepCount} step${stepCount === 1 ? "" : "s"}).`;
}

type ParaInput = {
  activity: MatProvActivity;
  usageEntities: MatProvEntity[];
  generationEntities: MatProvEntity[];
  entityGeneratedBy: Map<string, string>;
  stepIdByActivity: Map<string, string>;
};

/**
 * 1 Activity の段落を spans 配列として組む。
 *
 * 構造: "Use <materials/tools at attributes> to obtain <outputs>."
 *
 * - 入力（material/tool）が無い → "Perform <gerund>."
 * - 出力が無い → " to obtain <output>" を省略
 */
function buildActivityParagraphSpans(input: ParaInput): ProvSpan[] {
  const { activity, usageEntities, generationEntities, entityGeneratedBy, stepIdByActivity } = input;

  const materials = usageEntities.filter((e) => readEntityType(e) === "material");
  const tools = usageEntities.filter((e) => readEntityType(e) === "tool");

  // Activity 自身の parameter
  const activityParams = readParameters(activity);

  const spans: ProvSpan[] = [];

  if (materials.length + tools.length === 0) {
    // 入力なし: gerund だけ書く
    spans.push({ text: `Perform ${readLabel(activity.label) || "this step"}` });
  } else {
    spans.push({ text: "Use " });
    pushEntitySpans(spans, materials, "material", entityGeneratedBy, stepIdByActivity);
    if (tools.length > 0) {
      spans.push({ text: materials.length > 0 ? " with " : "" });
      pushEntitySpans(spans, tools, "tool", entityGeneratedBy, stepIdByActivity);
    }
  }

  // Activity parameter spans
  if (activityParams.length > 0) {
    spans.push({ text: " at " });
    for (let i = 0; i < activityParams.length; i++) {
      const p = activityParams[i];
      spans.push({
        text: formatParameter(p.key, p.value),
        role: "attribute",
      });
      if (i < activityParams.length - 1) spans.push({ text: ", " });
    }
  }

  if (generationEntities.length > 0) {
    spans.push({ text: " to obtain " });
    pushEntitySpans(spans, generationEntities, "output", entityGeneratedBy, stepIdByActivity);
  }

  spans.push({ text: "." });

  return spans;
}

/**
 * Entity 群を span に展開する。
 * - role = "material" | "tool" | "output"
 * - material は別 Activity が generate した Entity なら derivedFrom を付ける
 * - Entity 自身の parameter は直後に attribute span として並べる
 */
function pushEntitySpans(
  spans: ProvSpan[],
  entities: MatProvEntity[],
  role: "material" | "tool" | "output",
  entityGeneratedBy: Map<string, string>,
  stepIdByActivity: Map<string, string>,
): void {
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    const labelText = readLabel(e.label) || e["@id"];
    const span: ProvSpan = { text: labelText, role };
    if (role === "material") {
      const generatingActivity = entityGeneratedBy.get(e["@id"]);
      if (generatingActivity) {
        const fromStepId = stepIdByActivity.get(generatingActivity);
        if (fromStepId) span.derivedFrom = fromStepId;
      }
    }
    spans.push(span);

    // Entity の parameter（purity, form, length_thickness など）
    const params = readParameters(e as MatProvNode);
    if (params.length > 0) {
      spans.push({ text: " (" });
      for (let j = 0; j < params.length; j++) {
        const p = params[j];
        spans.push({
          text: formatParameter(p.key, p.value),
          role: "attribute",
        });
        if (j < params.length - 1) spans.push({ text: ", " });
      }
      spans.push({ text: ")" });
    }

    if (i < entities.length - 1) {
      spans.push({ text: i === entities.length - 2 ? " and " : ", " });
    }
  }
}

function formatParameter(key: string, value: string): string {
  return `${key}: ${value}`;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** kebab-case slug 化（stepId 用、STEP_ID_REGEX に合うように整形） */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
