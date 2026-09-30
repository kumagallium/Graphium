// 表キャプション層（TableCaptionLayer）が描く要素のうち、来歴ラベルのチップの位置に
// 効くものだけを見張る。
//
// - 名前の行: 幅が変わるとチップを逃がす位置が変わる（狭い表でチップが「表 N」に
//   重ならないようにするため）。ResizeObserver で見る。
// - <style>（表の上余白 marginCss）: 中身が書き換わると表が下がる。React は <style> の
//   子の文字列を既存の text node の書き換えで更新するので childList に出ず、
//   wrapper 全体の childList 監視では拾えない。かといって wrapper 全体に characterData を
//   掛けると本文の入力のたびに走る。そこで <style> だけを対象にする。
//   <style> は表キャプション層が描いた後で（ノートをサイドピークで直接開いた直後などは
//   エディタと同じ描画で）現れたり差し替わったりする。見張りを張る前に 1 回 sync しただけだと
//   後から出る <style> を購読できず、上余白が反映された後の位置を測り直せない（チップが
//   表の上余白 26px × 表の通し番号ぶん上にずれたまま、resize で初めて直る、が実際に起きた）。
//   そこで wrapper の childList を自前で監視して、<style> の出現・差し替えのたびに
//   見張りを張り直し、その出現自体も「変わった」として通知する。
// - エディタ本体（.bn-editor と、wrapper までの祖先）の寸法: 表に上余白が入る・上の画像が
//   読み込まれる、などで表が下がると、本文の高さが変わる。<style> の購読とは独立の保険として、
//   高さの変化でも測り直す（表の位置は表自身の寸法では分からない）。BlockNote は
//   .bn-block-outer の margin を 0.2s かけて動かすので、高さは遷移の間じゅう変わり続け、
//   終わった位置まで追いかけられる（上余白そのものは caption-layer が transition:none で
//   即時に効かせる。遷移の途中で測るのが、直らなかった本当の原因だった）。

/** 名前の行の目印（caption-layer.tsx が付ける。値は blockId） */
export const CAPTION_ROW_ATTR = "data-table-caption-row";
/** 上余白 CSS の <style> の目印（caption-layer.tsx が付ける） */
export const CAPTION_STYLE_ATTR = "data-table-caption-css";

export type CaptionWatch = {
  /** wrapper 内の対象を探し直して、新しいものを監視に加え、外れたものを外す */
  sync: () => void;
  disconnect: () => void;
};

/** 本文の高さの変化を見張る対象（エディタ本体）の目印 */
const EDITOR_SELECTOR = ".bn-editor";

/** <style> の出現・差し替えを含む変更記録か */
function touchesCaptionStyle(records: MutationRecord[]): boolean {
  const isStyleNode = (node: Node): boolean =>
    node instanceof Element &&
    (node.hasAttribute(CAPTION_STYLE_ATTR) || node.querySelector(`style[${CAPTION_STYLE_ATTR}]`) !== null);
  return records.some(
    (r) =>
      r.type === "childList" &&
      (Array.from(r.addedNodes).some(isStyleNode) || Array.from(r.removedNodes).some(isStyleNode)),
  );
}

export function watchCaptionTargets(
  wrapper: Element,
  resizeObserver: ResizeObserver,
  onStyleChange: () => void
): CaptionWatch {
  const rows = new Set<Element>();
  // エディタ本体と、wrapper までの祖先（本文の高さが変わると寸法が変わる）
  const flow = new Set<Element>();
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
    // エディタ本体から wrapper の手前までの祖先を数え直す。wrapper 自体は呼び出し側が見ている
    const chain = new Set<Element>();
    wrapper.querySelectorAll(EDITOR_SELECTOR).forEach((editor) => {
      for (let el: Element | null = editor; el && el !== wrapper; el = el.parentElement) chain.add(el);
    });
    chain.forEach((el) => {
      if (flow.has(el)) return;
      flow.add(el);
      resizeObserver.observe(el);
    });
    flow.forEach((el) => {
      if (chain.has(el)) return;
      resizeObserver.unobserve(el);
      flow.delete(el);
    });
  };

  // <style>・名前の行・エディタが後から現れても、見張りを張り直す。<style> の出現・差し替えは
  // それ自体が上余白の反映なので、通知もする
  const structureObserver = new MutationObserver((records) => {
    sync();
    if (touchesCaptionStyle(records)) onStyleChange();
  });
  structureObserver.observe(wrapper, { childList: true, subtree: true });

  const disconnect = () => {
    structureObserver.disconnect();
    styleObserver.disconnect();
    rows.forEach((row) => resizeObserver.unobserve(row));
    rows.clear();
    flow.forEach((el) => resizeObserver.unobserve(el));
    flow.clear();
  };

  return { sync, disconnect };
}
