// ──────────────────────────────────────────────
// GraphiumDocument マイグレーション
//
// 各プロバイダ（google-drive / local / filesystem）が loadFile 時に
// 呼び出す共通関数。読み込んだドキュメントを最新 version に正規化する。
//
// version 履歴:
//   1 → 2: links フィールドを provLinks / knowledgeLinks に分離
//   2 → 3: labels の値を日本語ブラケット（[材料] 等）から内部キー（material 等）に移行
//   3 → 4: 旧内部キー "result"（Output Entity 意味）を "output" にリネーム。
//          Phase 用の "plan" / "result"（Phase 意味）を新設したため衝突回避。
//   4 → 5: block-level inline-type ラベル（material/tool/attribute/output）を
//          BlockNote のインライン style（inlineMaterial 等）に変換。
//          LabelStore は heading 用ラベル（procedure/plan/result/free.*）に純化。
//   5 → 6: 「procedure ラベル付き見出し + スコープ範囲」を step コンテナブロックに変換。
//          工程が第一級のブロックになったため、ラベルで工程を表す旧記法を畳む。
//          見出しの id を step がそのまま引き継ぐので、activity_<id>・informed_by
//          リンク・メモ等のブロック参照はすべて生き残り、PROV グラフは変換前後で
//          同一になる（例外: 帯の撤回で意味を失った plan / result ラベルは除去し、
//          該当ノートの _plan Entity は生成されなくなる）。
// ──────────────────────────────────────────────

import type { GraphiumDocument } from "./document-types";
import { normalizeLabel, classifyLabel } from "../features/context-label/labels";

export const LATEST_DOCUMENT_VERSION = 6;

const INLINE_TYPE_LABELS = new Set(["material", "tool", "attribute", "output"]);

/**
 * 読み込んだドキュメントを最新 version に揃える（破壊的に変更して同じ参照を返す）
 * @param selfId このドキュメント自身のファイル ID（loadFile が受け取った fileId）。
 *   渡された場合、provLinks / knowledgeLinks から自己参照（targetNoteId === selfId）を
 *   除去する（過去の生成バグ由来の無意味データのサニタイズ。スキーマは変えない）。
 */
export function migrateToLatest(doc: GraphiumDocument, selfId?: string): GraphiumDocument {
  if (!doc || typeof doc !== "object") return doc;

  // v1 → v2: links を provLinks / knowledgeLinks に分離
  migrateLinksToV2(doc);

  // v2 → v3: labels の値を内部キーに正規化
  if ((doc.version ?? 1) < 3) {
    migrateLabelsToV3(doc);
    doc.version = 3;
  }

  // v3 → v4: "result" → "output" リネーム（Output Entity 意味のラベルを移行）
  if ((doc.version ?? 1) < 4) {
    migrateResultToOutputV4(doc);
    doc.version = 4;
  }

  // v4 → v5: block-level inline-type ラベルを whole-block highlight に変換
  if ((doc.version ?? 1) < 5) {
    migrateInlineLabelsToHighlightsV5(doc);
    doc.version = 5;
  }

  // v5 → v6: procedure 見出し + スコープを step コンテナに変換
  if ((doc.version ?? 1) < 6) {
    migrateProcedureHeadingsToStepsV6(doc);
    doc.version = 6;
  }

  // wikiMeta.kind: "concept" → "claim" のリネーム（提案 v4 で命名を見直したため）
  //
  // 「Concept」は事実ベースの抽出層であって哲学的概念ではないので、命名を
  // Claim（主張）に統一する。version フィールドとは独立に毎回チェックする
  // ことで、古いファイルを読むたびに idempotent に正規化する。
  migrateConceptKindToClaim(doc);

  // 未知の inline style を strip する（version 非依存、毎回 idempotent）。
  // 過去に bug や手動編集で `inlineProcedure` のような schema 外の style キーが
  // ノートに紛れ込むと BlockNote の `useCreateBlockNote` が initialContent の
  // ロードに失敗して画面全体が落ちる。schema に登録されている 4 種以外の
  // `inline*` キーは安全のため除去する。
  stripUnknownInlineStyles(doc);

  // 自己参照リンクの除去（version 非依存、毎回 idempotent）。
  // re-lift 時の温存漏れ等の過去バグにより knowledgeLinks / provLinks の
  // targetNoteId が自ノート自身を指すデータが混入することがある。
  // 読み込みのたびに掃除しておけば、旧ビルドで保存されたファイルでも
  // 描画側の防御を待たずに自己参照が解消される。
  if (selfId) {
    stripSelfReferenceLinks(doc, selfId);
  }

  return doc;
}

/** knowledgeLinks / provLinks から targetNoteId === selfId の自己参照を除去する */
function stripSelfReferenceLinks(doc: GraphiumDocument, selfId: string): void {
  for (const page of doc.pages ?? []) {
    if (Array.isArray(page.knowledgeLinks)) {
      page.knowledgeLinks = page.knowledgeLinks.filter((l: any) => l?.targetNoteId !== selfId);
    }
    if (Array.isArray(page.provLinks)) {
      page.provLinks = page.provLinks.filter((l: any) => l?.targetNoteId !== selfId);
    }
  }
}

const KNOWN_INLINE_STYLE_KEYS = new Set([
  "inlineMaterial",
  "inlineTool",
  "inlineAttribute",
  "inlineOutput",
]);

/**
 * BlockNote schema に登録されていない `inline*` style を strip する。
 * BlockNote default の `bold` / `italic` / `underline` / `strike` / `code` /
 * `textColor` / `backgroundColor` 等は触らない（"inline" 接頭辞ではないため）。
 */
function stripUnknownInlineStyles(doc: GraphiumDocument): void {
  for (const page of doc.pages ?? []) {
    walkBlocksForStyleCleanup(page.blocks ?? []);
  }
}

function walkBlocksForStyleCleanup(blocks: any[]): void {
  for (const b of blocks) {
    cleanupContentStyles(b?.content);
    if (Array.isArray(b?.children) && b.children.length > 0) {
      walkBlocksForStyleCleanup(b.children);
    }
  }
}

function cleanupContentStyles(content: any): void {
  if (!Array.isArray(content)) return;
  for (const c of content) {
    if (c?.type === "text" && c.styles && typeof c.styles === "object") {
      for (const key of Object.keys(c.styles)) {
        if (key.startsWith("inline") && !KNOWN_INLINE_STYLE_KEYS.has(key)) {
          delete c.styles[key];
        }
      }
    } else if (c?.type === "link" && Array.isArray(c.content)) {
      cleanupContentStyles(c.content);
    }
  }
}

/**
 * wikiMeta.kind === "concept" を "claim" に置換し、
 * 旧フィールド名 derivedFromConcepts / conceptRole も新名に移行する。
 *
 * インデックス側 (NoteIndexEntry.wikiKind) は INDEX_SCHEMA_VERSION bump
 * に伴う再構築で自然に "claim" に揃うため、ここでは触らない。
 */
function migrateConceptKindToClaim(doc: GraphiumDocument): void {
  const meta = doc.wikiMeta;
  if (!meta) return;
  // PR-B4: synthesisMode "inductive" は廃止。意味的に Atomizer 層へ移動
  // したため、Synthesis ドキュメントに残っていたら undefined に格下げ。
  // 情報は失うが、利用者が少ない時期の整理として許容する。idempotent。
  if ((meta as any).synthesisMode === "inductive") {
    (meta as any).synthesisMode = undefined;
  }
  // PR-B4.5: procedureContext は Claim でのみ意味を持つ。Atom / Synthesis に
  // PR-B3 で書かれた値が残っていたら strip する（context-stripped を contract に
  // 統一）。再現性骨格は元 Claim 側に残っているので失う情報は冗長な intersection。
  const kind = (meta as any).kind;
  if ((kind === "atom" || kind === "synthesis") && (meta as any).procedureContext) {
    (meta as any).procedureContext = undefined;
  }
  // 旧 kind の文字列リテラルが「concept」のときだけ書き換える。
  // 既に "claim" のものや別の kind には触らない。
  if ((meta.kind as unknown as string) === "concept") {
    (meta as any).kind = "claim";
  }
  const legacy = (meta as any).derivedFromConcepts;
  if (Array.isArray(legacy) && !(meta as any).derivedFromClaims) {
    (meta as any).derivedFromClaims = legacy;
    delete (meta as any).derivedFromConcepts;
  }
  // PR-B1 で一時的に書き出される可能性のあった conceptRole も移行する
  const legacyRole = (meta as any).conceptRole;
  if (Array.isArray(legacyRole) && !(meta as any).claimRole) {
    (meta as any).claimRole = legacyRole;
    delete (meta as any).conceptRole;
  }
}

let migrationLinkIdCounter = 0;
/** 移行専用の id 生成。BlockLink.id が欠けている旧データ救済用（通常は不要） */
function generateMigrationLinkId(): string {
  return `link-migrated-${Date.now()}-${migrationLinkIdCounter++}`;
}

/**
 * BlockLink の必須フィールド（id / createdBy）が欠けたまま v2 に流れないよう補完する。
 * 通常の運用データでは id / createdBy は常に付与済み（features/block-link/store.tsx
 * generateLinkId）だが、旧バージョンや外部由来データで欠けている可能性を排除できないため、
 * ここで型を満たすところまで面倒を見る（スキーマは変えない・値の補完のみ）。
 */
function ensureBlockLinkFields(link: any): any {
  return {
    ...link,
    id: typeof link.id === "string" && link.id ? link.id : generateMigrationLinkId(),
    createdBy: link.createdBy ?? "human",
  };
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
        const migrated = ensureBlockLinkFields(link);
        if (isProv) {
          provLinks.push({ ...migrated, layer: "prov" });
        } else {
          knowledgeLinks.push({ ...migrated, layer: "knowledge" });
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

/**
 * v3 → v4: 旧内部キー "result"（Output Entity 意味）を "output" にリネーム。
 *
 * Phase A で 3 層構造（Section / Phase / Inline）に再編した際、
 * Phase 用に新ラベル "plan" / "result" を導入した。旧 v3 では "result" は
 * Output Entity を意味していたため、衝突回避のため Output 側を "output" に移す。
 *
 * 既存ノートの labels マップ内の "result" は **無条件に "output" へ書き換える**。
 * （v3 時点では Phase 意味の "result" は存在しないため安全）。
 */
function migrateResultToOutputV4(doc: GraphiumDocument): void {
  for (const page of doc.pages ?? []) {
    if (!page.labels) continue;
    const next: Record<string, string> = {};
    for (const [blockId, rawLabel] of Object.entries(page.labels)) {
      if (typeof rawLabel !== "string") {
        continue;
      }
      next[blockId] = rawLabel === "result" ? "output" : rawLabel;
    }
    page.labels = next;
  }
}

/**
 * v4 → v5: block-level inline-type ラベル（material/tool/attribute/output）を
 * BlockNote のインライン style（inlineMaterial 等）に変換する。
 *
 * Phase C 設計（docs/internal/provenance-layer-design.md）:
 *   - block-level inline-type ラベルは廃止。BlockNote の text style として永続化する
 *   - 各 inline-type ラベルは BlockNote style として `inlineMaterial / inlineTool /
 *     inlineAttribute / inlineOutput` に対応し、値は entityId 文字列
 *   - LabelStore は heading 用（procedure/plan/result/free.*）に純化される
 *
 * 変換規則:
 *   - 該当ブロックの content[] 内の全 text inline に対応 style を付与
 *   - 1 ブロック = 1 entityId（同 ID で集約）
 *   - 該当ブロックが見つからない場合は label 削除のみ
 *
 * NOTE: C-1 で導入した `page.highlights[]` 配列は **使わず**、BlockNote ネイティブの
 * style を真の保存先とする。`highlights[]` フィールドはスキーマ上は残るが現状未使用。
 */
function migrateInlineLabelsToHighlightsV5(doc: GraphiumDocument): void {
  for (const page of doc.pages ?? []) {
    if (!page.labels) continue;
    const blockIndex = buildBlockIndex(page.blocks ?? []);
    const remainingLabels: Record<string, string> = {};

    for (const [blockId, rawLabel] of Object.entries(page.labels)) {
      if (typeof rawLabel !== "string") continue;

      if (!INLINE_TYPE_LABELS.has(rawLabel)) {
        // heading 用ラベル / free ラベルはそのまま残す
        remainingLabels[blockId] = rawLabel;
        continue;
      }

      const block = blockIndex.get(blockId);
      if (block) {
        const styleKey = `inline${rawLabel[0].toUpperCase()}${rawLabel.slice(1)}`;
        const entityId = `ent_${blockId}`;
        applyStyleToBlockContent(block, styleKey, entityId);
      }
      // labels からは消す（block が見つからなくても削除）
    }

    page.labels = remainingLabels;
  }
}

/**
 * ブロックの content[] 内の text/link inline 全てに style を適用する。
 *   - { type: "text", styles: { ... } } → styles[styleKey] = entityId
 *   - { type: "link", content: [...] } → 配下の text にも適用
 *   - 文字列 / image / table 等は無視
 */
function applyStyleToBlockContent(block: any, styleKey: string, entityId: string): void {
  const content = block?.content;
  if (!Array.isArray(content)) return;
  for (const c of content) {
    if (c?.type === "text") {
      c.styles = { ...(c.styles ?? {}), [styleKey]: entityId };
    } else if (c?.type === "link" && Array.isArray(c.content)) {
      for (const lc of c.content) {
        if (lc?.type === "text") {
          lc.styles = { ...(lc.styles ?? {}), [styleKey]: entityId };
        }
      }
    }
  }
}

/**
 * ブロックツリーを再帰的に走査して `Map<blockId, block>` を作る。
 */
function buildBlockIndex(blocks: any[]): Map<string, any> {
  const index = new Map<string, any>();
  const walk = (nodes: any[]) => {
    for (const node of nodes ?? []) {
      if (node && typeof node.id === "string") {
        index.set(node.id, node);
      }
      if (node?.children?.length) {
        walk(node.children);
      }
    }
  };
  walk(blocks);
  return index;
}


// ──────────────────────────────────────────────
// v5 → v6: procedure 見出し + スコープ → step コンテナ
// ──────────────────────────────────────────────

/**
 * 「procedure ラベル付き見出し」を step ブロックに変換する（共有・冪等）。
 *
 * v6 マイグレーションの中核だが、AI 生成側（URL/PDF Ingester・チャットの
 * ラベル付き挿入・テンプレート）も旧記法で組み立ててからこれを通すことで、
 * 生成物が常に step ブロックになる。プロンプトやパーサは旧語彙のまま
 * 変えなくてよい。
 *
 * - スコープ = 見出しの後ろから、同レベル以上の次の見出しの手前まで
 *   （generator の scopeStack / collectBlockScope と同じ境界規則）。
 *   その範囲のブロックが step の children になる。
 * - step の id は見出しの id を引き継ぐ。activity_<id>・informed_by リンク・
 *   メモのアンカー等、ブロック id への参照はすべてそのまま生きる。
 * - 下位レベルの procedure 見出しがスコープ内にあれば、再帰的に入れ子の
 *   step へ変換される。
 * - plan / result ラベルは除去する（帯撤回済みの legacy）。
 *
 * labels は破壊的に更新される（消費したエントリを削除）。
 */
export function convertProcedureHeadingsToSteps(
  blocks: any[],
  labels: Record<string, string>,
): any[] {
  const normalizedOf = (blockId: string): string | null => {
    const raw = labels[blockId];
    return raw ? normalizeLabel(raw) : null;
  };

  const convertList = (list: any[]): any[] => {
    const result: any[] = [];
    let i = 0;
    while (i < list.length) {
      const b = list[i];
      if (!b || typeof b !== "object") {
        i++;
        continue;
      }
      const isHeading = b.type === "heading";
      const label = b.id ? normalizedOf(b.id) : null;

      if (isHeading && label === "procedure") {
        const level = b.props?.level ?? 2;
        // スコープ終端: 同レベル以上の次の見出し
        let j = i + 1;
        while (
          j < list.length &&
          !(
            list[j]?.type === "heading" &&
            (list[j].props?.level ?? 1) <= level
          )
        ) {
          j++;
        }
        const scope = list.slice(i + 1, j);
        const children = convertList(scope);
        // 見出しが（通常は無いが）children を持っていたら末尾に残す
        if (Array.isArray(b.children) && b.children.length > 0) {
          children.push(...convertList(b.children));
        }
        result.push({
          id: b.id,
          type: "step",
          props: {
            textAlignment: b.props?.textAlignment ?? "left",
            variant: "step",
          },
          content: b.content ?? [],
          children,
        });
        delete labels[b.id];
        i = j;
        continue;
      }

      // phase（plan / result）ラベルは除去（帯撤回済みの legacy）
      if (b.id && (label === "plan" || label === "result")) {
        delete labels[b.id];
      }
      if (Array.isArray(b.children) && b.children.length > 0) {
        b.children = convertList(b.children);
      }
      result.push(b);
      i++;
    }
    return result;
  };

  return convertList(blocks);
}

/** v5 → v6: 各ページに convertProcedureHeadingsToSteps を適用する */
function migrateProcedureHeadingsToStepsV6(doc: GraphiumDocument): void {
  for (const page of doc.pages ?? []) {
    const labels: Record<string, string> = (page as any).labels ?? {};
    page.blocks = convertProcedureHeadingsToSteps(page.blocks ?? [], labels);
  }
}
