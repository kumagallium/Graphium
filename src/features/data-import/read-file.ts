// データファイルのテキスト読み取り
//
// 装置の出力は UTF-8 とは限らない（国内の測定器は Shift_JIS が今も多い）。
// UTF-8 として厳密にデコードして失敗したら Shift_JIS で読み直す。ここで諦めると
// 見出しが文字化けした表がそのままノートに残ってしまう。

/** UTF-8 → 失敗したら Shift_JIS の順でデコードする */
export async function readDataFileText(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    // fatal: false なので、Shift_JIS として読めない部分は置換文字になる（例外は出ない）
    return new TextDecoder("shift_jis").decode(buffer);
  }
}
