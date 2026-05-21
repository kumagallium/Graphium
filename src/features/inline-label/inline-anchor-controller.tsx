// インラインハイライトの浮上アクション + RelationshipPicker
// Phase F (2026-05-01):
//   - クリック → モーダル直開きは廃止（テキスト編集を阻害しない）
//   - カーソルが highlight 内にある時だけ、近傍に小さな「🔗 紐付け」ボタンを表示
//   - そのボタンを押すと RelationshipPicker が開く

import { useEffect, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { Link2 } from "lucide-react";
import { useBlockNoteEditor } from "@blocknote/react";
import {
  RelationshipPicker,
  type PickerCandidate,
  type PickerSection,
  type ChipStyle,
} from "./relationship-picker";
import {
  buildMergeCandidates,
  mergeEntityIds,
  type InlineLabel,
} from "./entity-merge";
import { LABEL_TO_STYLE, STYLE_TO_LABEL } from "./styles";
import { parseAttributeBinding } from "./attribute-binding";
import {
  setAttributeParent,
  findAttributeBlockId,
  getAttributeBinding,
  collectEntitiesWithContext,
  getBlockScope,
  PARENT_ACTIVITY_MARKER,
  type EntityWithContext,
} from "./attribute-binding";
import { useT, getDisplayLabelName } from "../../i18n";
import { useLabelStore } from "../context-label/store";

const LABEL_BORDER: Record<InlineLabel, string> = {
  material: "#4B7A52",
  tool: "#c08b3e",
  attribute: "#8a8a8a",
  output: "#c26356",
};
const LABEL_BG: Record<InlineLabel, string> = {
  material: "rgba(75, 122, 82, 0.18)",
  tool: "rgba(192, 139, 62, 0.18)",
  attribute: "rgba(160, 160, 160, 0.18)",
  output: "rgba(194, 99, 86, 0.18)",
};

const ACTIVITY_BG = "rgba(91, 143, 185, 0.12)";
const ACTIVITY_BORDER = "#5b8fb9";
const ACTIVITY_CANDIDATE_ID = "__activity__";

const chipFor = (label: InlineLabel): ChipStyle => ({
  bg: LABEL_BG[label],
  border: LABEL_BORDER[label],
});

type AnchorState = {
  label: InlineLabel;
  entityId: string;
  text: string;
};

type FloatingButtonState = {
  label: InlineLabel;
  entityId: string;
  text: string;
  // ビューポート座標（fixed）
  top: number;
  left: number;
};

/**
 * インラインハイライトのクリックを拾って、RelationshipPicker を開く。
 * `<BlockNoteView>` 内に 1 つだけ置く。
 */
export function InlineAnchorController() {
  const editor = useBlockNoteEditor<any, any, any>();
  const t = useT();
  const { labels } = useLabelStore();
  const [anchor, setAnchor] = useState<AnchorState | null>(null);
  const [floating, setFloating] = useState<FloatingButtonState | null>(null);

  // ── カーソル位置トラッキング: highlight 内に入ったら浮上ボタンを表示 ──
  useEffect(() => {
    const tiptap = (editor as any)?._tiptapEditor;
    if (!tiptap) return;

    const update = () => {
      // IME 変換中は何もしない。
      // 文字挿入トランザクションごとに DOM 座標計算 + setState が走ると、
      // 日本語入力の確定タイミングと競合して文字が重複・改行が乱れる。
      if (tiptap.view?.composing) return;
      const sel = tiptap.state.selection;
      if (!sel?.empty) {
        setFloating(null);
        return;
      }
      // 現在 active な inline label style を 1 つ拾う
      const activeStyles = editor.getActiveStyles?.() ?? {};
      let label: InlineLabel | null = null;
      let raw: string | null = null;
      for (const styleKey of Object.keys(STYLE_TO_LABEL)) {
        const v = activeStyles[styleKey];
        if (typeof v === "string" && v) {
          label = STYLE_TO_LABEL[styleKey] as InlineLabel;
          raw = v;
          break;
        }
      }
      if (!label || !raw) {
        setFloating(null);
        return;
      }
      const entityId =
        label === "attribute" ? parseAttributeBinding(raw).entityId : raw;
      if (!entityId) {
        setFloating(null);
        return;
      }

      // カーソル位置の DOM 座標
      let coords: { top: number; left: number } | null = null;
      try {
        const c = tiptap.view.coordsAtPos(sel.from);
        coords = { top: c.top, left: c.left };
      } catch {
        coords = null;
      }
      if (!coords) {
        setFloating(null);
        return;
      }

      // カーソル位置の DOM ノードからハイライトテキストを取得
      let text = "";
      try {
        const dp = tiptap.view.domAtPos(sel.from);
        const node: Node | null = dp.node ?? null;
        const el =
          node?.nodeType === 1
            ? (node as HTMLElement)
            : (node?.parentElement as HTMLElement | null);
        const span = el?.closest?.(
          "[data-inline-label][data-entity-id]",
        ) as HTMLElement | null;
        text = span?.textContent ?? "";
      } catch {
        /* ignore */
      }

      setFloating({
        label,
        entityId,
        text,
        top: coords.top,
        left: coords.left,
      });
    };

    // 浮上ボタンは「カーソル位置が highlight に入ったか」を見るだけなので
    // selectionUpdate で十分。`transaction` は文字挿入のたびにも発火し、
    // IME 中に setState を連発して composition を乱すので張らない。
    tiptap.on("selectionUpdate", update);
    const onBlur = () => setFloating(null);
    tiptap.on("blur", onBlur);
    return () => {
      tiptap.off("selectionUpdate", update);
      tiptap.off("blur", onBlur);
    };
  }, [editor]);

  const sections = useMemo<PickerSection[] | null>(() => {
    if (!anchor || !editor) return null;
    const out: PickerSection[] = [];

    if (anchor.label === "attribute") {
      out.push(...buildBindingSections(editor, anchor, t, labels));
    }
    out.push(buildMergeSection(editor, anchor, t));
    return out;
  }, [anchor, editor, t, labels]);

  return (
    <>
      {floating && !anchor &&
        createPortal(
          <button
            type="button"
            onMouseDown={(e) => {
              // カーソル位置を奪わない
              e.preventDefault();
            }}
            onClick={() => {
              setAnchor({
                label: floating.label,
                entityId: floating.entityId,
                text: floating.text,
              });
              setFloating(null);
            }}
            className="fixed z-[9998] flex items-center gap-1 px-2 py-1 text-[11px] rounded-full bg-background border border-border shadow-md hover:bg-accent hover:text-accent-foreground cursor-pointer"
            style={{
              // カーソル行の上に出す（高さ 22px 想定で上にオフセット）
              top: floating.top - 28,
              left: floating.left,
            }}
            data-test="inline-anchor-floating-button"
          >
            <Link2 size={12} />
            <span>{t("linking.title")}</span>
          </button>,
          document.body,
        )}
      {anchor && sections && (
        <RelationshipPicker
      open={true}
      onClose={() => setAnchor(null)}
      title={t("linking.title")}
      source={{
        label: t("linking.target"),
        chip: {
          text: anchor.text || t("linking.untitledHighlight"),
          style: chipFor(anchor.label),
        },
        typeName: getDisplayLabelName(anchor.label),
      }}
      sections={sections.map(function wrap(sec: PickerSection): PickerSection {
        return {
          ...sec,
          onSelect: sec.onSelect
            ? (c) => {
                sec.onSelect!(c);
                setAnchor(null);
              }
            : undefined,
          subsections: sec.subsections?.map(wrap),
        };
      })}
        />
      )}
    </>
  );
}

// ──────────────────────────────────
// セクション: 「別のハイライトと同一化」（全種共通）
// ──────────────────────────────────
function buildMergeSection(
  editor: any,
  anchor: AnchorState,
  t: (k: string, p?: Record<string, string>) => string,
): PickerSection {
  const cands = buildMergeCandidates(
    editor.document,
    anchor.label,
    anchor.entityId,
  );
  const candidates: PickerCandidate[] = cands.map((c) => ({
    id: c.entityId,
    chips: c.texts.map((tx) => ({ text: tx, style: chipFor(c.label) })),
    secondary: t("linking.occurrences", { count: String(c.blockCount) }),
  }));

  return {
    title: t("linking.sectionMerge"),
    current: {
      kind: "text",
      label: t("linking.current"),
      text: t("linking.currentSelf"),
    },
    candidates,
    emptyMessage: t("linking.noMergeCandidates"),
    onSelect: (c) => {
      mergeEntityIds(editor, anchor.label, anchor.entityId, c.id);
    },
  };
}

// ──────────────────────────────────
// セクション: 「紐付け先を変更」（attribute のみ）
// 同ブロック優先 + 他ブロックは見出しテキスト付き
// ──────────────────────────────────
function buildBindingSections(
  editor: any,
  anchor: AnchorState,
  t: (k: string, p?: Record<string, string>) => string,
  labels: Map<string, string>,
): PickerSection[] {
  const ownBlockId = findAttributeBlockId(editor.document, anchor.entityId);
  const binding = getAttributeBinding(editor.document, anchor.entityId);
  const all: EntityWithContext[] = collectEntitiesWithContext(
    editor.document,
    labels,
  );

  const currentParent = binding?.parentEntityId ?? null;

  // スコープキー: procedure-label 付きブロック ID（fallback: heading パス）。
  // attribute だけのブロック（entity を持たない）は all に出てこないので、
  // ownBlockId のスコープは getBlockScope で別途取得する。
  const ownScope = ownBlockId
    ? getBlockScope(editor.document, labels, ownBlockId)
    : null;
  const ownScopeId = ownScope?.scopeId ?? null;
  const ownPath: string[] = ownScope?.headingPath ?? [];
  const samePath = (p: string[]) =>
    p.length === ownPath.length && p.every((x, i) => x === ownPath[i]);

  // merge 済 entity は複数スコープに同時に存在しうる。
  // いずれかの出現が同スコープなら「同じステップ内」扱いにする。
  const isSameScope = (e: EntityWithContext) => {
    if (ownScopeId !== null) return e.allScopeIds.has(ownScopeId);
    // procedure ラベルが無いケースは headingPath で判定（fallback）
    return e.allScopeIds.has(null) && samePath(e.headingPath);
  };
  const isInOwnBlock = (e: EntityWithContext) =>
    !!ownBlockId && e.allBlockIds.has(ownBlockId);

  const sameBlock = all.filter(isInOwnBlock);
  const sameScope = all.filter((e) => !isInOwnBlock(e) && isSameScope(e));
  const otherScope = all.filter((e) => !isInOwnBlock(e) && !isSameScope(e));

  const filterCurrent = (id: string) =>
    !(currentParent && id === currentParent) &&
    !(currentParent === PARENT_ACTIVITY_MARKER && id === ACTIVITY_CANDIDATE_ID);

  const breadcrumbOf = (e: EntityWithContext) =>
    e.headingPath.length > 0 ? e.headingPath.join("  ›  ") : "";

  const toCandidate = (e: EntityWithContext, includeBreadcrumb: boolean): PickerCandidate => {
    const labelName = getDisplayLabelName(e.label);
    const crumb = breadcrumbOf(e);
    return {
      id: e.entityId,
      chips: [
        {
          text: e.text || t("linking.untitledHighlight"),
          style: chipFor(e.label),
        },
      ],
      secondary: includeBreadcrumb && crumb
        ? `${crumb}  ›  ${labelName}`
        : labelName,
    };
  };

  // セクション 1: 同ブロック内 + Activity 直結（最頻ケース）
  const primaryCandidates: PickerCandidate[] = [
    {
      id: ACTIVITY_CANDIDATE_ID,
      chips: [
        {
          text: t("linking.bindToActivity"),
          style: { bg: ACTIVITY_BG, border: ACTIVITY_BORDER },
        },
      ],
    },
    ...sameBlock.map((e) => toCandidate(e, false)),
  ].filter((c) => filterCurrent(c.id));

  // 現在の binding の表示
  let current: PickerSection["current"];
  if (currentParent === PARENT_ACTIVITY_MARKER) {
    current = {
      kind: "chip",
      label: t("linking.current"),
      chip: {
        text: t("linking.currentActivity"),
        style: { bg: ACTIVITY_BG, border: ACTIVITY_BORDER },
      },
    };
  } else if (currentParent) {
    const parentEntity = all.find((e) => e.entityId === currentParent);
    current = parentEntity
      ? {
          kind: "chip",
          label: t("linking.current"),
          chip: {
            text: parentEntity.text || t("linking.untitledHighlight"),
            style: chipFor(parentEntity.label),
          },
        }
      : {
          kind: "text",
          label: t("linking.current"),
          text: t("linking.currentNone"),
        };
  } else {
    current = {
      kind: "text",
      label: t("linking.current"),
      text: t("linking.currentNearest"),
    };
  }

  const onSelectBinding = (c: PickerCandidate) => {
    const parent =
      c.id === ACTIVITY_CANDIDATE_ID ? PARENT_ACTIVITY_MARKER : c.id;
    setAttributeParent(editor, anchor.entityId, parent);
  };

  // サブセクション（同スコープ / 他スコープ）
  const subsections: PickerSection[] = [];
  if (sameScope.length > 0) {
    const cands = sameScope
      .map((e) => toCandidate(e, false))
      .filter((c) => filterCurrent(c.id));
    if (cands.length > 0) {
      subsections.push({
        title: t("linking.sectionSameScope"),
        candidates: cands,
        onSelect: onSelectBinding,
      });
    }
  }
  if (otherScope.length > 0) {
    const cands = otherScope
      .map((e) => toCandidate(e, true))
      .filter((c) => filterCurrent(c.id));
    if (cands.length > 0) {
      subsections.push({
        title: t("linking.sectionOtherBlocks"),
        candidates: cands,
        onSelect: onSelectBinding,
        defaultCollapsed: true,
      });
    }
  }

  return [
    {
      title: t("linking.sectionChangeBinding"),
      current,
      candidates: primaryCandidates,
      emptyMessage: t("linking.noBindingCandidates"),
      onSelect: onSelectBinding,
      resetAction: currentParent
        ? {
            label: t("linking.resetBinding"),
            onClick: () => setAttributeParent(editor, anchor.entityId, null),
          }
        : undefined,
      subsections: subsections.length > 0 ? subsections : undefined,
    },
  ];
}
