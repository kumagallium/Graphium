// いま画面で開いているノートのエディタ（サイドピークが登録する）
//
// 開いていないノートには、ファイルを読み・足し・保存して書き込める。けれどもそのノートが
// サイドピークで開いているときにファイルへ書くと、ピークの自動保存が開いた時点の本文で
// 上書きして、足した分が消える。そこで開いているノートは、ここに登録されたエディタへ直接足す。

/** 開いているノートへの書き込み口（エディタと、そのノートのリンクの記録先） */
export type OpenNoteEditor = {
  getEditor: () => any;
  addLink: (link: {
    sourceBlockId: string;
    targetBlockId: string;
    type: "reference";
    createdBy: "human" | "ai" | "system";
    targetNoteId?: string;
  }) => unknown;
};

const editors = new Map<string, OpenNoteEditor>();

/** 開いているあいだ登録する。戻り値で外す（同じノートを後から開き直した登録は消さない） */
export function registerOpenNoteEditor(noteId: string, entry: OpenNoteEditor): () => void {
  editors.set(noteId, entry);
  return () => {
    if (editors.get(noteId) === entry) editors.delete(noteId);
  };
}

export function getOpenNoteEditor(noteId: string): OpenNoteEditor | null {
  const entry = editors.get(noteId);
  return entry && entry.getEditor() ? entry : null;
}
