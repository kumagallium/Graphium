// 表キャプション層（TableCaptionLayer）が描く要素のうち、来歴ラベルのチップの位置に
// 効くものだけを見張る。
//
// - 名前の行: 幅が変わるとチップを逃がす位置が変わる（狭い表でチップが「表 N」に
//   重ならないようにするため）。ResizeObserver で見る。
// - <style>（表の上余白 marginCss）: 中身が書き換わると表が下がる。React は <style> の
//   子の文字列を既存の text node の書き換えで更新するので childList に出ず、
//   wrapper 全体の childList 監視では拾えない。かといって wrapper 全体に characterData を
//   掛けると本文の入力のたびに走る。そこで <style> だけを対象にする。

/** 名前の行の目印（caption-layer.tsx が付ける。値は blockId） */
export const CAPTION_ROW_ATTR = "data-table-caption-row";
/** 上余白 CSS の <style> の目印（caption-layer.tsx が付ける） */
export const CAPTION_STYLE_ATTR = "data-table-caption-css";

export type CaptionWatch = {
  /** wrapper 内の対象を探し直して、新しいものを監視に加え、外れたものを外す */
  sync: () => void;
  disconnect: () => void;
};

export function watchCaptionTargets(
  wrapper: Element,
  resizeObserver: ResizeObserver,
  onStyleChange: () => void
): CaptionWatch {
  const rows = new Set<Element>();
  const styleObserver = new MutationObserver(onStyleChange);

  const sync = () => {
    wrapper.querySelectorAll(`[${CAPTION_ROW_ATTR}]`).forEach((row) => {
      if (rows.has(row)) return;
      rows.add(row);
      resizeObserver.observe(row);
    });
    // 外れた行は監視から外す（ResizeObserver は対象を強参照するため）
    rows.forEach((row) => {
      if (row.isConnected) return;
      resizeObserver.unobserve(row);
      rows.delete(row);
    });
    // 同じ要素を再度 observe しても購読は重複しない（オプションが置き換わるだけ）
    wrapper.querySelectorAll(`style[${CAPTION_STYLE_ATTR}]`).forEach((styleEl) => {
      styleObserver.observe(styleEl, {
        characterData: true,
        childList: true,
        subtree: true,
      });
    });
  };

  const disconnect = () => {
    styleObserver.disconnect();
    rows.forEach((row) => resizeObserver.unobserve(row));
    rows.clear();
  };

  return { sync, disconnect };
}
