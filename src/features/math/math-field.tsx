// MathLive の <math-field> を React から扱うラッパ。
//
// LaTeX を知らなくても数式を書けるようにするための視覚的な数式エディタ。
// `x/y` と打てば分数に、`sqrt` で根号になり、記号パレット（仮想キーボード）からも
// 入力できる。値は LaTeX 文字列なので、保存形式は LaTeX 直書きのときと同じ。
//
// JSX ではなく document.createElement で組み立てる。カスタム要素は mathlive を
// 動的 import した後でないと定義されず、JSX で書くと型定義も別途必要になるため。

import { useEffect, useRef, useState } from "react";
import { loadMathLive } from "./mathlive-setup";
import { t } from "../../i18n";

export type MathFieldProps = {
  /** LaTeX ソース */
  value: string;
  /** 入力のたびに呼ばれる（逐次保存用） */
  onChange: (latex: string) => void;
  /** 編集を終えたとき（Enter / Escape）に呼ばれる */
  onCommit?: () => void;
  /** マウント時にフォーカスする */
  autoFocus?: boolean;
  /** 本文中に置くコンパクト表示にする */
  inline?: boolean;
};

export function MathField({ value, onChange, onCommit, autoFocus, inline }: MathFieldProps) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const fieldRef = useRef<any>(null);
  const [ready, setReady] = useState(false);

  // イベントリスナーは 1 回だけ張るので、最新のコールバックを ref 経由で参照する
  const onChangeRef = useRef(onChange);
  const onCommitRef = useRef(onCommit);
  const valueRef = useRef(value);
  onChangeRef.current = onChange;
  onCommitRef.current = onCommit;
  valueRef.current = value;

  useEffect(() => {
    let cancelled = false;
    loadMathLive().then(() => {
      if (cancelled || !hostRef.current) return;

      const mf = document.createElement("math-field") as any;
      mf.value = valueRef.current;
      // 仮想キーボードはタッチ端末で自動表示。デスクトップは物理キーボードで入力する
      mf.mathVirtualKeyboardPolicy = "auto";
      mf.style.width = "100%";
      mf.style.fontSize = inline ? "1em" : "1.15em";

      mf.addEventListener("input", () => onChangeRef.current(mf.value));
      // change は Enter や blur で「編集を終えた」ときに飛ぶ
      mf.addEventListener("change", () => onCommitRef.current?.());
      // BlockNote 側にキーを渡すとブロック削除・改行挿入と競合するため止める
      mf.addEventListener("keydown", (e: KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onCommitRef.current?.();
        }
      });

      hostRef.current.appendChild(mf);
      fieldRef.current = mf;
      setReady(true);
      if (autoFocus) mf.focus();
    });

    return () => {
      cancelled = true;
      fieldRef.current?.remove();
      fieldRef.current = null;
    };
    // マウント時に 1 回だけ組み立てる（value の同期は下の effect が担当）
  }, [inline, autoFocus]);

  // 外部（undo / LaTeX ソース編集）で値が変わったときだけ書き戻す。
  // 毎回代入するとユーザーの入力中にカーソルが先頭へ飛ぶ。
  useEffect(() => {
    const mf = fieldRef.current;
    if (mf && mf.value !== value) mf.value = value;
  }, [value]);

  return (
    <span ref={hostRef} style={{ display: "block", width: "100%" }}>
      {!ready && (
        <span style={{ fontSize: 13, color: "var(--color-text-tertiary)" }}>
          {t("math.loadingEditor")}
        </span>
      )}
    </span>
  );
}
