// 音声ノートのブロックから呼ぶ、アプリ側のノート操作（メインエディタが登録する）
//
// ブロックは BlockNote の中で描かれ、NoteApp の関数（新しいノートの作成・サイドピーク・
// ノート間の派生の線）に直接は届かない。メインエディタ（NoteEditorInner）が開いているあいだ、
// ここに関数を登録し、ブロックはそれを呼ぶ（currentNoteTitleForHint と同じ流儀）。
// サイドピークの中のブロックからは使わない（派生の線をメインのノートに誤って足さないため）。

export type MeetingNoteActions = {
  /** このブロックがメインエディタのものか（サイドピークの中では「メモを取る」を出さない） */
  isMainEditor: (editor: unknown) => boolean;
  /** 新しいノートを作る（派生元はいま開いているノート）。作れなければ null */
  createLinkedNote: (title: string) => Promise<string | null>;
  /** ノートをサイドピークで開く */
  openInSidePeek: (noteId: string) => void;
  /** 開いているノートの noteLinks に「このブロックから noteId へ」の派生の線を足す */
  linkDerived: (noteId: string, sourceBlockId: string) => void;
  /** 開いていないノートの本文の文字（清書・要約の手がかり用）。読めなければ null */
  loadNoteText: (noteId: string) => Promise<string | null>;
};

let actions: MeetingNoteActions | null = null;

export function setMeetingNoteActions(next: MeetingNoteActions | null): void {
  actions = next;
}

export function getMeetingNoteActions(): MeetingNoteActions | null {
  return actions;
}
