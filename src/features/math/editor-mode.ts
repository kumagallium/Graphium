// 数式エディタの入力方式（視覚 / LaTeX ソース）の記憶。
//
// 既定は視覚エディタ。LaTeX を知らない人でも数式を書けることを優先する。
// ただし LaTeX に慣れた人が毎回切り替えるのは煩わしいので、選んだ方式を端末に覚える。
// ノートのデータではなく端末の好みなので localStorage に置く（同期しない）。

export type MathEditorMode = "visual" | "latex";

const STORAGE_KEY = "graphium.math.editorMode";

export function getMathEditorMode(): MathEditorMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === "latex" ? "latex" : "visual";
  } catch {
    // プライベートモード等で localStorage が使えない場合は既定に倒す
    return "visual";
  }
}

export function setMathEditorMode(mode: MathEditorMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* 保存できなくても動作には影響しない */
  }
}
