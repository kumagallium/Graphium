// 「保存される形」を比べるための正規化関数（no-write-on-open の土台）。
//
// ノートを開くと、保存されていた付加情報（ラベル・リンク・表の注釈・画像のラベル・
// 配置・OCR）をストアへ戻す。この復元はストアの参照を作り直すだけなので、内容は
// 変わっていない。しかし「ストアの参照が変わったら編集があった」とみなす effect
// （note-app.tsx / side-peek.tsx）がこれを編集と取り違え、markDirty/handleChange を
// 呼び、3 秒後に無条件で書き込む・更新日時を進めてしまう。
//
// これを防ぐため、保存の直前に「これから書く形」と「最後に保存先にあった形」を
// 突き合わせ、同じなら書き込まない（handleSave / flushPending / doSave）。
// 未保存表示も同様に、参照が変わっただけで出さないよう、このハッシュ関数で確かめる
// （note-app.tsx の 3728 行の effect / side-peek.tsx の alignments・links・labels・
// tableMetas を見る 4 つの effect）。
//
// 除く項目は「保存したという事実だけで変わる」もの。**これ以外はすべて比べる**
// （「比べる項目を選ぶ」のではなく「除く項目を選ぶ」設計にする。項目が増えても
// 比べ忘れが起きないため）:
//   - modifiedAt: 保存のたびに必ず進める（呼び出し側の不変条件。書き込むときに
//     進めない、という経路は作らない）
//   - documentProvenance.revisions[].driveRevisionId: 保存成功後に非同期で
//     Drive Revision ID を取得して書き込む（note-app.tsx handleSave）。内容は
//     変わっていないのにこのフィールドだけ後から埋まると、次回の比較で
//     「変わった」と誤判定し、書かなくていい保存が走ってしまう

import type { GraphiumDocument } from "../../lib/document-types";

/**
 * キー順序・undefined キーの有無に依らない正規化を行う。
 * 配列の順序は意味を持つ（例: chats・blocks の並び）ので、そのまま保つ。
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const v = obj[key];
      if (v === undefined) continue;
      sorted[key] = canonicalize(v);
    }
    return sorted;
  }
  return value;
}

/**
 * 保存される形の比較用文字列を作る。
 *
 * `doc` そのものではなく、保存のたびに必ず変わる項目（modifiedAt・
 * driveRevisionId）を除いた正規化 JSON 文字列を返す。呼び出し側は、これから
 * 書く doc の形と、最後に保存先にあった形（同じ関数で作った文字列）を
 * `===` で突き合わせる。
 */
export function buildSavedForm(doc: GraphiumDocument): string {
  const { modifiedAt: _modifiedAt, ...rest } = doc;
  const withoutMechanicalFields = {
    ...rest,
    documentProvenance: rest.documentProvenance
      ? {
          ...rest.documentProvenance,
          revisions: rest.documentProvenance.revisions.map(
            ({ driveRevisionId: _driveRevisionId, ...revision }) => revision,
          ),
        }
      : rest.documentProvenance,
  };
  return JSON.stringify(canonicalize(withoutMechanicalFields));
}
