// BlockNoteView（@blocknote/shadcn）に渡す shadcn コンポーネントの差し替え。
//
// ── なぜ必要か ────────────────────────────────────────────────
// @blocknote/shadcn が同梱する shadcn/ui の Button は、React 19 の
// 「ref を通常の prop として受け取れる」仕様を前提にした素の関数コンポーネントで、
// forwardRef を使っていない。Graphium は React 18 なので、React が
// レンダリング時に ref を props から取り除き、**ref はどこにも届かない**。
//
// これが効いてくるのが Radix のポップオーバー系。テーブルの列/行ハンドルや
// ブロックのドラッグハンドルは
//
//   Radix DropdownMenuTrigger → (asChild) → BlockNote の Handle → shadcn Button
//
// という並びで、Trigger が anchor を掴むための ref は最終的にこの Button に渡る。
// ref が落ちると Radix Popper の anchor が null のままになり、Floating UI の
// 位置計算（computePosition）が一度も走らない。すると Radix は採寸用の仮置き位置
// `transform: translate(0, -200%)`（＝自分の高さの 2 倍だけ上）を貼ったままにする。
// メニューは「反転しなかった」のではなく、そもそも一度も配置されていない。
//
// 画面の下の方では仮置き位置が偶然それらしく見えるので気付きにくいが、
// テーブルが画面上端の近くにあると仮置き位置がビューポートの外に出て、
// 項目を押せなくなる。
//
// ── どう直すか ────────────────────────────────────────────────
// BlockNote 本体には手を入れられないので、BlockNoteView が公式に用意している
// 拡張点 `shadCNComponents` から、ref を通す Button に差し替える。
// 見た目（cva のクラス）は本家の Button に任せたまま、asChild で実 DOM だけ
// こちらの <button> に差し替えて ref を受け取る。
//
// Button は BlockNote 内の 8 箇所（テーブルハンドル・サイドメニュー・
// ツールバー等）から使われているので、ここ 1 箇所で全ての Radix anchor が直る。

import { forwardRef, type ComponentProps } from "react";
import { ShadCNDefaultComponents } from "@blocknote/shadcn";

// 型定義上は `| undefined` が付いているが、実体は常にエクスポートされている。
const ShadCNButton = ShadCNDefaultComponents!.Button.Button;

type ShadCNButtonProps = ComponentProps<typeof ShadCNButton>;

const RefForwardingButton = forwardRef<HTMLButtonElement, ShadCNButtonProps>(
  function RefForwardingButton({ children, ...props }, ref) {
    // 呼び出し側が既に asChild を使っている場合、実 DOM は呼び出し側の要素なので
    // 二重に包まずそのまま流す（BlockNote 内の呼び出しは全て asChild なし）。
    if (props.asChild) {
      return <ShadCNButton {...props}>{children}</ShadCNButton>;
    }
    return (
      <ShadCNButton {...props} asChild>
        <button ref={ref}>{children}</button>
      </ShadCNButton>
    );
  },
);

export const blockNoteShadCNComponents = {
  // forwardRef 版は元の関数コンポーネント型とシグネチャが一致しないため cast する。
  // 受け取る props は同じ（ShadCNButtonProps）なので呼び出し側の互換性は保たれる。
  Button: { Button: RefForwardingButton as unknown as typeof ShadCNButton },
};
