// 見出しの折りたたみ（Obsidian 方式）のコア。
//
// すべての見出しが畳める。畳む範囲の決め方は collapse-range.ts を参照。
// ノートの中身は書き換えず、ProseMirror の decoration で見えなくするだけなので、
// 保存される JSON・Markdown 書き出し・PROV には一切影響しない。
//
// 旧・Notion 式のトグル見出し（isToggleable）はこの実装に一本化した。
// スキーマ側で allowToggleHeadings を切ってあるので BlockNote 標準の ▶ は出ない。
// 既存ノートに残る children はここで畳む対象に含めてある。

import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import { createExtension } from "@blocknote/core";
import { Extension as TiptapExtension } from "@tiptap/core";
import {
  analyzeDocument,
  hidingHeadingAt,
  type HiddenRange,
  type HeadingInfo,
} from "./collapse-range";
import { loadCollapsedIds, saveCollapsedIds } from "./storage";
import { searchPluginKey } from "../document-search/search-plugin";

export const collapsibleHeadingKey = new PluginKey<CollapseState>("collapsibleHeading");

/** 隠されたブロックに付く class。CSS 側と対で使う。 */
export const HIDDEN_CLASS = "gph-heading-hidden";
/** ▶ ボタンの class。 */
export const TOGGLE_CLASS = "gph-heading-toggle";

export interface CollapseState {
  /** 畳んでいる見出しブロックの id。追加順（保存時に古いものから捨てるため）。 */
  collapsedOrder: string[];
  collapsed: Set<string>;
  ranges: HiddenRange[];
  headings: HeadingInfo[];
  decorations: DecorationSet;
  /**
   * 検索バー（Cmd+F）に語が入っている間は true。
   * その間は畳んだところも見えるようにする — 畳まれた中がヒットしても
   * 画面に出てこないと「検索が壊れている」ように見えるため。
   * 畳んだ状態（collapsedOrder）は保持しているので、検索を閉じれば元に戻る。
   */
  searchActive: boolean;
}

export type CollapseMeta =
  | { type: "toggle"; id: string }
  | { type: "expand"; id: string }
  | { type: "expandAll" }
  | { type: "collapseAll" };

// ── ▶ ボタン ────────────────────────────────────────────

// 右向き三角。畳んでいるときは data-collapsed="true" になり、CSS で回転を戻す
// （展開時 = 下向き ▼ / 折りたたみ時 = 右向き ▶）。
const ARROW_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">' +
  '<path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.5" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';

function createToggleButton(
  headingId: string,
  isCollapsed: boolean,
  label: string,
  dispatchToggle: () => void,
): HTMLElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = TOGGLE_CLASS;
  btn.dataset.collapsed = String(isCollapsed);
  btn.setAttribute("aria-expanded", String(!isCollapsed));
  btn.setAttribute("aria-label", label);
  btn.title = label;
  btn.contentEditable = "false";
  btn.innerHTML = ARROW_SVG;
  // 折りたたみは mousedown で確定させる。
  // click を待つと、押した瞬間に decoration が組み変わってボタンの DOM が
  // 入れ替わり、mouseup が別要素で起きて click が発火しないことがある。
  // mousedown の preventDefault は、押した拍子に選択が動いて
  // エディタがスクロールするのを防ぐためにも要る。
  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dispatchToggle();
  });
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    // detail === 0 はキーボード（Enter / Space）由来。
    // マウス由来は mousedown で処理済みなので、ここで二重に反応させない。
    if (e.detail === 0) dispatchToggle();
  });
  return btn;
}

// ── decoration ──────────────────────────────────────────

function buildDecorations(
  doc: any,
  collapsed: ReadonlySet<string>,
  ranges: readonly HiddenRange[],
  headings: readonly HeadingInfo[],
  labels: ToggleLabels,
  dispatch: (meta: CollapseMeta) => void,
): DecorationSet {
  const decos: Decoration[] = [];

  for (const r of ranges) {
    decos.push(Decoration.node(r.from, r.to, { class: HIDDEN_CLASS }));
  }

  for (const h of headings) {
    // 畳んでも何も隠れない見出し（配下が空）には ▶ を出さない
    const isCollapsed = collapsed.has(h.id);
    if (!h.collapsible && !isCollapsed) continue;
    const label = isCollapsed ? labels.expand : labels.collapse;
    decos.push(
      Decoration.widget(
        // 見出しノードの「内側の先頭」に置く。blockContainer 直下（h.pos + 1）だと
        // DOM 上 .bn-block-content の外に出てしまい、children を含む .bn-block の
        // 高さが基準になって縦位置が合わない。見出し要素の中なら見出し 1 行を
        // 基準にできる（CSS 側は h1/h2/h3 を position: relative にしている）。
        h.pos + 2,
        () => createToggleButton(h.id, isCollapsed, label, () => dispatch({ type: "toggle", id: h.id })),
        {
          // 同じ見出し・同じ状態なら DOM を作り直さない
          key: `gph-toggle-${h.id}-${isCollapsed ? "1" : "0"}`,
          side: -1,
          ignoreSelection: true,
          // widget 内のクリックを ProseMirror の選択処理に渡さない
          stopEvent: () => true,
        },
      ),
    );
  }

  return DecorationSet.create(doc, decos);
}

interface ToggleLabels {
  collapse: string;
  expand: string;
}

// ── プラグイン本体 ───────────────────────────────────────

function applyMeta(order: string[], set: Set<string>, meta: CollapseMeta, headings: readonly HeadingInfo[]): string[] {
  switch (meta.type) {
    case "toggle":
      return set.has(meta.id) ? order.filter((x) => x !== meta.id) : [...order, meta.id];
    case "expand":
      return order.filter((x) => x !== meta.id);
    case "expandAll":
      return [];
    case "collapseAll": {
      const next = [...order];
      for (const h of headings) {
        if (h.collapsible && !set.has(h.id)) next.push(h.id);
      }
      return next;
    }
  }
}

/**
 * 畳んでいる id を保存する。
 * 今開いているノートの見出しぶんだけを差し替え、他ノートの分は残す
 * （保存は 1 キーにまとめてあり、doc からは他ノートの見出しが見えないため）。
 */
function persist(order: readonly string[], headings: readonly HeadingInfo[]): void {
  const present = new Set(headings.map((h) => h.id));
  const others = loadCollapsedIds().filter((id) => !present.has(id));
  saveCollapsedIds([...others, ...order]);
}

function createCollapsePlugin(labels: ToggleLabels): Plugin<CollapseState> {
  let dispatchToggle: (meta: CollapseMeta) => void = () => {};

  const recompute = (doc: any, order: string[], searchActive: boolean): CollapseState => {
    const collapsed = new Set(order);
    const { ranges, headings } = analyzeDocument(doc, collapsed);
    // 検索中は隠さない（widget の ▶ は出したままにして、状態が分かるようにする）
    const effective = searchActive ? [] : ranges;
    return {
      collapsedOrder: order,
      collapsed,
      ranges: effective,
      headings,
      decorations: buildDecorations(doc, collapsed, effective, headings, labels, (m) => dispatchToggle(m)),
      searchActive,
    };
  };

  return new Plugin<CollapseState>({
    key: collapsibleHeadingKey,
    view(view) {
      // widget のクリックから transaction を投げるための入り口。
      // plugin state からは view に触れないので、ここで捕まえておく。
      dispatchToggle = (meta: CollapseMeta) => {
        view.dispatch(view.state.tr.setMeta(collapsibleHeadingKey, meta));
      };
      return {};
    },
    state: {
      init(_config, state: EditorState): CollapseState {
        // 保存済みの状態のうち、この doc に実在する見出しの分だけを復元する。
        // 他ノートの id は落とさない（保存し直すのは実際に操作したときだけ）。
        const saved = loadCollapsedIds();
        const { headings } = analyzeDocument(state.doc, new Set());
        const present = new Set(headings.map((h) => h.id));
        return recompute(state.doc, saved.filter((id) => present.has(id)), false);
      },
      apply(tr: Transaction, value: CollapseState, _old: EditorState, newState: EditorState): CollapseState {
        const meta = tr.getMeta(collapsibleHeadingKey) as CollapseMeta | undefined;

        // 検索バーの開閉・入力。search プラグインの state を直に読むと
        // apply の途中で古い値を掴むので、transaction の meta から判断する。
        const searchMeta = tr.getMeta(searchPluginKey) as
          | { type: "set"; query: string }
          | { type: "clear" }
          | undefined;
        if (searchMeta) {
          const nextActive = searchMeta.type === "set" && searchMeta.query.length > 0;
          if (nextActive !== value.searchActive) {
            return recompute(newState.doc, value.collapsedOrder, nextActive);
          }
        }

        if (meta) {
          const order = applyMeta(value.collapsedOrder, value.collapsed, meta, value.headings);
          persist(order, value.headings);
          return recompute(newState.doc, order, value.searchActive);
        }

        if (tr.docChanged) {
          return recompute(newState.doc, value.collapsedOrder, value.searchActive);
        }

        // カーソルが畳んだ中に入ったら、その見出しを開く。
        // 畳んだ直後に見出し自身へカーソルを置く操作もここを通るが、
        // 見出しは範囲の外なので開かない。
        if (tr.selectionSet && value.ranges.length > 0) {
          const pos = newState.selection.from;
          const owner = hidingHeadingAt(value.ranges, pos);
          if (owner) {
            // 自動で開いたぶんも保存する。開いた状態が今のユーザーの意図なので、
            // 次に開いたときにまた畳まれていると「戻された」ように見える。
            const order = value.collapsedOrder.filter((x) => x !== owner);
            persist(order, value.headings);
            return recompute(newState.doc, order, value.searchActive);
          }
        }

        return value;
      },
    },
    props: {
      decorations(state) {
        return collapsibleHeadingKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
  });
}

/**
 * BlockNote の editor 生成時に `extensions` へ渡す折りたたみ拡張。
 * documentSearchExtension と同じ createExtension パターン。
 *
 * labels は aria-label / title に使う文言（i18n 済みの文字列を渡す）。
 */
export function collapsibleHeadingExtension(labels: ToggleLabels) {
  return createExtension({
    key: "collapsible-heading",
    tiptapExtensions: [
      TiptapExtension.create({
        name: "collapsibleHeading",
        addProseMirrorPlugins() {
          return [createCollapsePlugin(labels)];
        },
      }),
    ],
  });
}
