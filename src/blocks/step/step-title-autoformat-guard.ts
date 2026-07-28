// step タイトルの markdown 自動変換ガード
//
// BlockNote の input rule は「1. 」「- 」「# 」等をブロック変換のトリガーにするが、
// 除外は heading だけで、カスタムブロックも変換対象になる（core の
// NumberedListItem/block.ts などを参照）。step のタイトルは「1. 前処理」のように
// 連番で始めるのがごく自然なので、放置すると **タイトルを打った瞬間に step カードが
// 番号付きリストへ化けて、カード（と PROV の Activity 境界）が消える**。
//
// この拡張は handleTextInput で「step タイトル内で、いま打った 1 文字により
// 変換トリガーが完成する」場合だけ、テキストを挿入して true を返す。
// input rule も handleTextInput で動くため、先に消費すれば発火しない
// （priority 400 > blocknote-input-rules の既定 100）。トリガー未完成の通常入力には触れない。
//
// 既知の抜け: input rule 側は compositionend 直後にも走る（handleDOMEvents 経由）ため、
// IME の確定文字列そのものがトリガーを完成させた場合はガードを素通りして変換が起きる。
// 日本語 IME で末尾に半角スペースを確定させるのは稀で、起きても undo 可能なので許容する。

import { Extension as TiptapExtension } from "@tiptap/core";
import { Plugin, PluginKey } from "prosemirror-state";
import { createExtension } from "@blocknote/core";

const pluginKey = new PluginKey("stepTitleAutoformatGuard");

// BlockNote 組み込みのブロック変換トリガー（core の各 block.ts の find: と同じもの）。
// バージョン更新でトリガーが増えても、漏れた分は「変換されてしまう」だけで
// データ破壊ではない（undo 可能）。既知のものを列挙する。
const CONVERSION_TRIGGERS: RegExp[] = [
  /^\s?(\d+)\.\s$/, // numberedListItem
  /^\s?[-+*]\s$/, // bulletListItem
  /^\s?\[\s*\]\s$/, // checkListItem（未チェック）
  /^\s?\[[Xx]\]\s$/, // checkListItem（チェック済み）
  /^#{1,6}\s$/, // heading
  /^>\s$/, // quote
  /^```(.*?)\s$/, // codeBlock
  /^---$/, // divider
];

const tiptapExt = TiptapExtension.create({
  name: "stepTitleAutoformatGuard",
  // blocknote-input-rules（優先度既定 = 100）より先に handleTextInput が
  // 呼ばれるよう高優先度に置く（ime-confirm-enter-guard の 300 と同じ理由）。
  priority: 400,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pluginKey,
        props: {
          handleTextInput(
            view,
            from,
            to,
            text,
            // prosemirror-view は第 5 引数に「デフォルト挿入の tr を作る関数」を渡す
            // （composition メタ・選択解決・scrollIntoView 込み）。型定義には未掲載。
            deflt?: () => unknown,
          ) {
            // IME 合成中は何もしない。input rule 側も合成中は発火しない
            // （@handlewithcare/prosemirror-inputrules の run() 先頭と同じガード）ので、
            // ここで tr を発行すると合成だけを壊すことになる（WKWebView が特に脆い）。
            if (view.composing) return false;

            // step のタイトル（= step ノードの inline content）内だけが対象。
            // selection ではなく from を起点に解決する（autocorrect 等で
            // 入力位置が選択位置とずれるケースがあるため）。
            const $from = view.state.doc.resolve(from);
            if ($from.parent.type.name !== "step") return false;

            // ブロック先頭から入力位置までのテキスト + 今回の入力で判定する
            // （input rule と同じ材料）
            const before = $from.parent.textBetween(0, $from.parentOffset);
            const prospective = before + text;
            if (!CONVERSION_TRIGGERS.some((re) => re.test(prospective))) {
              return false;
            }

            // トリガー完成 → 変換させず、文字だけを入れる。
            // deflt があればそれを使う（prosemirror-view が組むデフォルト挿入 tr）。
            const tr = deflt
              ? (deflt() as Parameters<typeof view.dispatch>[0])
              : view.state.tr.insertText(text, from, to);
            if (tr) view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },
});

export const stepTitleAutoformatGuardExtension = createExtension({
  key: "step-title-autoformat-guard",
  tiptapExtensions: [tiptapExt],
});
