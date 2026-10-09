// <sup> / <sub> 入りの文字列を、上付き・下付きにして表示する。
// 出典照合の原文はノート・Word とも上付き・下付きを <sup> / <sub> で AI に渡すので、
// 引用（quote）や判定の理由にタグが入る。文字のまま出すと「10<sup>5</sup>」と読めてしまう。

import { Fragment } from "react";
import { scriptStyleTag, splitScriptTags } from "../../../lib/script-styles";

export function ScriptText({ text }: { text: string }) {
  return (
    <>
      {splitScriptTags(text).map((piece, i) => {
        if (!piece.style) return <Fragment key={i}>{piece.text}</Fragment>;
        const Tag = scriptStyleTag(piece.style);
        return <Tag key={i}>{piece.text}</Tag>;
      })}
    </>
  );
}
