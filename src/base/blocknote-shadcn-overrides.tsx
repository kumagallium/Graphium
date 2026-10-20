// BlockNoteView（@blocknote/shadcn）に渡す shadcn コンポーネントの差し替え。
//
// ── なぜ必要か ────────────────────────────────────────────────
// @blocknote/shadcn が同梱する shadcn/ui の Button / Toggle は、React 19 の
// 「ref を通常の prop として受け取れる」仕様を前提にした素の関数コンポーネントで、
// forwardRef を使っていない。Graphium は React 18 なので、React が
// レンダリング時に ref を props から取り除き、**ref はどこにも届かない**。
//
// これが効いてくるのがポップオーバー系のトリガー。テーブルの列/行ハンドルや
// ブロックのドラッグハンドル、書式ツールバーのボタンは
//
//   base-ui の Trigger → (render={<Button/>}) → BlockNote の Handle → shadcn Button
//
// という並びで、Trigger が anchor を掴むための ref は最終的にこの Button に渡る。
// ref が落ちると anchor が null のままになり、位置計算が一度も走らず、
// メニューが画面の外に飛んだり押せなくなったりする（BlockNote 0.47 + Radix の頃に
// テーブルが画面上端にあるケースで実際に起きた。base-ui（0.53〜）でも仕組みは同じ）。
//
// ── どう直すか ────────────────────────────────────────────────
// BlockNote 本体には手を入れられないので、BlockNoteView が公式に用意している
// 拡張点 `shadCNComponents` から、ref を通す Button / Toggle に差し替える。
// 見た目（cva のクラス）は本家に任せたまま、base-ui の `render` で実 DOM だけ
// こちらの <button> に差し替えて ref を受け取る（0.52 までは Radix の asChild で同じことをしていた）。
//
// ── 以前あった Portal の自前実装について ──────────────────────
// 0.52 までは DropdownMenuContent / PopoverContent が Portal を使わず本文の枠の中に
// 描かれて切られたので、body 直下の専用の入れ物へ createPortal で出していた。
// 0.53 からは本家が base-ui の Portal で BlockNoteView の portalElement（body 直下・
// `.bn-root .bn-shadcn` 付き）へ出すので、その差し替えは不要になった。
// ピーク（z-index 100）より上に出すための z-index は app.css の `body > .bn-root` で付ける。

import { forwardRef, type ComponentProps } from "react";
import { ShadCNDefaultComponents } from "@blocknote/shadcn";

// 型定義上は `| undefined` が付いているが、実体は常にエクスポートされている。
const ShadCNButton = ShadCNDefaultComponents!.Button.Button;

type ShadCNButtonProps = ComponentProps<typeof ShadCNButton>;

const RefForwardingButton = forwardRef<HTMLButtonElement, ShadCNButtonProps>(
  function RefForwardingButton({ children, ...props }, ref) {
    // 呼び出し側が既に render で実 DOM を差し替えている場合はそのまま流す
    // （BlockNote 内の呼び出しは全て render なし）。
    if (props.render) {
      return <ShadCNButton {...props}>{children}</ShadCNButton>;
    }
    // base-ui は render に渡した要素へ自分の props と ref を合成する（この ref も含めて
    // 実 DOM の <button> に届く）
    return (
      <ShadCNButton {...props} render={<button ref={ref} />}>
        {children}
      </ShadCNButton>
    );
  },
);

// ── Toggle も同じ理由で ref を落とす ──────────────────────────
// 書式ツールバーの ToolbarButton は isSelected が定義されたボタン（太字・斜体・揃え・
// 「リンクを編集」など）で Button ではなく shadcn の Toggle を使う。Toggle も forwardRef
// を使わない素の関数コンポーネントなので、Tooltip / Popover の render トリガーが渡す ref が
// 落ち、ヒントやリンク編集のポップオーバーが一度も配置されず画面の外に飛ぶ。
// Button と同じ方式で ref を実 DOM の <button> に通す。
const ShadCNToggle = ShadCNDefaultComponents!.Toggle.Toggle;

type ShadCNToggleProps = ComponentProps<typeof ShadCNToggle>;

const RefForwardingToggle = forwardRef<HTMLButtonElement, ShadCNToggleProps>(
  function RefForwardingToggle({ children, ...props }, ref) {
    // 呼び出し側が render で実 DOM を差し替えている場合はそのまま流す
    if (props.render) {
      return <ShadCNToggle {...props}>{children}</ShadCNToggle>;
    }
    return (
      <ShadCNToggle {...props} render={<button ref={ref} />}>
        {children}
      </ShadCNToggle>
    );
  },
);

export const blockNoteShadCNComponents = {
  // forwardRef 版は元の関数コンポーネント型とシグネチャが一致しないため cast する。
  // 受け取る props は同じ（ShadCNButtonProps）なので呼び出し側の互換性は保たれる。
  Button: { Button: RefForwardingButton as unknown as typeof ShadCNButton },
  Toggle: { Toggle: RefForwardingToggle as unknown as typeof ShadCNToggle },
};
