// 投入口モーダルのストーリー
//
// idle（受け皿） / running（進行中） / done（復元レポート）の 3 状態を並べる。
// 各状態の合否はストーリー先頭のコメントを参照。

import type { Meta, StoryObj } from "@storybook/react-vite";
import { IntakeModal, type IntakeConversationProps, type IntakeState } from "./IntakeModal";
import type { ConversationWorkdirItem } from "../conversation-import/api";
import type { ConversationIntakeState } from "../conversation-import/use-conversation-intake";

const meta: Meta<typeof IntakeModal> = {
  title: "Features/Intake/IntakeModal",
  component: IntakeModal,
  parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<typeof IntakeModal>;

const noop = () => {};

/** 受け皿。「規則の 1 文が読める」「ボタン 2 つの主従が分かる」が合否 */
export const Idle: Story = {
  args: {
    open: true,
    state: { kind: "idle" },
    onClose: noop,
    onFilesSelected: noop,
  },
};

/** dragActive: true。受け皿が強調される */
export const IdleDragging: Story = {
  args: {
    open: true,
    state: { kind: "idle" },
    dragActive: true,
    onClose: noop,
    onFilesSelected: noop,
  },
};

/** 進行中。進捗バーとファイル名の表示が既存の importProgress と揃っているかが合否 */
export const Running: Story = {
  args: {
    open: true,
    state: {
      kind: "running",
      done: 12,
      total: 40,
      current: "2023-05-14 焼成テスト.md",
      failed: [],
    },
    onClose: noop,
    onFilesSelected: noop,
  },
};

/** 進行中 + 失敗あり。失敗件数の表示位置が合否 */
export const RunningWithFailures: Story = {
  args: {
    open: true,
    state: {
      kind: "running",
      done: 30,
      total: 40,
      current: "2023-05-14 焼成テスト.md",
      failed: ["broken.md", "old-notes.md"],
    },
    onClose: noop,
    onFilesSelected: noop,
  },
};

/** 復元レポート。数字の一覧と「次の動作」の並びが合否 */
export const Done: Story = {
  args: {
    open: true,
    state: {
      kind: "done",
      notes: 38,
      notesExisting: 0,
      materials: 17,
      linksResolved: 120,
      linksUnresolved: 0,
      failed: [],
      skipped: 0,
      skippedByExt: {},
      folders: 0,
      materialsExisting: 0,
      createdNoteIds: ["note-1", "note-2"],
      mediaFileIds: ["file-1", "file-2"],
      ocrPending: 0,
      officeDerived: 0,
      officeSkipped: 0,
      aiAvailable: true,
    },
    onClose: noop,
    onFilesSelected: noop,
    onSearch: noop,
    onShowGraph: noop,
    onAskAi: noop,
    onIngestAll: noop,
  },
};

/** 復元レポート + 未解決リンク・失敗あり。注意書きが2つとも出るかが合否 */
export const DoneWithIssues: Story = {
  args: {
    open: true,
    state: {
      kind: "done",
      notes: 36,
      notesExisting: 2,
      materials: 17,
      linksResolved: 117,
      linksUnresolved: 3,
      failed: ["broken.md", "old-notes.md"],
      skipped: 4,
      skippedByExt: { ".ppt": 2, ".xls": 1, ".bak": 1 },
      folders: 3,
      materialsExisting: 5,
      createdNoteIds: ["note-1", "note-2"],
      mediaFileIds: ["file-1", "file-2"],
      ocrPending: 6,
      officeDerived: 12,
      officeSkipped: 3,
      aiAvailable: true,
    },
    onClose: noop,
    onFilesSelected: noop,
    onSearch: noop,
    onShowGraph: noop,
    onAskAi: noop,
    onIngestAll: noop,
  },
};

/** 復元レポート・AI 未設定。「AI に聞く」の代わりに「AI を設定する」が出るかが合否 */
export const DoneNoAi: Story = {
  args: {
    open: true,
    state: {
      kind: "done",
      notes: 38,
      notesExisting: 0,
      materials: 17,
      linksResolved: 120,
      linksUnresolved: 0,
      failed: [],
      skipped: 0,
      skippedByExt: {},
      folders: 0,
      materialsExisting: 0,
      createdNoteIds: ["note-1", "note-2"],
      mediaFileIds: ["file-1", "file-2"],
      ocrPending: 0,
      officeDerived: 0,
      officeSkipped: 0,
      aiAvailable: false,
    },
    onClose: noop,
    onFilesSelected: noop,
    onSearch: noop,
    onShowGraph: noop,
    onSetupAi: noop,
  },
};

/** PDF を 1 本取り込んだ直後。主ボタンが「開く」、続いて「ナレッジ化」「AI に聞く」。探す・つながりは出ない */
export const DoneSinglePdf: Story = {
  args: {
    open: true,
    state: {
      kind: "done",
      notes: 0,
      notesExisting: 0,
      materials: 1,
      linksResolved: 0,
      linksUnresolved: 0,
      failed: [],
      skipped: 0,
      skippedByExt: {},
      folders: 0,
      materialsExisting: 0,
      createdNoteIds: [],
      mediaFileIds: ["file-1"],
      ocrPending: 0,
      officeDerived: 0,
      officeSkipped: 0,
      aiAvailable: true,
    },
    onClose: noop,
    onFilesSelected: noop,
    onAskAi: noop,
    onIngestAll: noop,
    onOpen: noop,
  },
};

/** 登録済みの PDF を入れ直したとき。「1 件は登録済み」と出るが、ボタンは初回と同じ */
export const DoneSinglePdfAlreadyInLibrary: Story = {
  args: {
    ...DoneSinglePdf.args,
    state: {
      ...(DoneSinglePdf.args!.state as Extract<IntakeState, { kind: "done" }>),
      materialsExisting: 1,
    },
  },
};

// ── AI との会話の区画 ─────────────────────────────────────────

function convRow(
  name: string,
  sessions: number,
  unattendedSessions: number,
  ownChars: number,
  startedAt: string,
  endedAt: string,
): ConversationWorkdirItem {
  const attended = sessions - unattendedSessions;
  return {
    workdir: `/Users/example/${name}`,
    sessions,
    unattendedSessions,
    candidateSessions: Math.floor(attended / 3),
    ownTurns: attended * 6,
    ownChars,
    startedAt,
    endedAt,
    sessionRefs: Array.from({ length: attended }, (_, i) => ({
      dirName: `-Users-example-${name}`,
      fileName: `session-${i}.jsonl`,
    })),
  };
}

const CONV_ITEMS: ConversationWorkdirItem[] = [
  convRow("bakery-notes", 12, 0, 18_420, "2026-03-04T09:12:00", "2026-10-21T18:40:00"),
  convRow("curry-lab", 9, 3, 9_870, "2026-05-11T10:00:00", "2026-09-02T21:05:00"),
  convRow("sourdough-log", 4, 0, 3_150, "2026-08-19T08:30:00", "2026-08-19T20:15:00"),
  convRow("spice-ledger", 6, 6, 0, "2026-06-01T12:00:00", "2026-06-30T12:00:00"),
];

const convBase = {
  open: true,
  state: { kind: "idle" },
  onClose: noop,
  onFilesSelected: noop,
} as const;

function conv(
  state: ConversationIntakeState,
  section: "files" | "conversations" = "conversations",
): IntakeConversationProps {
  return {
    state,
    section,
    onSectionChange: noop,
    onToggle: noop,
    onToggleAll: noop,
    onImport: noop,
    onRetry: noop,
    onViewMaterials: noop,
  };
}

/** タブが出たファイル側。タブの下に、今までの受け皿がそのまま出るかが合否 */
export const FilesWithTabs: Story = {
  args: { ...convBase, conversation: conv({ kind: "idle" }, "files") },
};

/** 一覧を読んでいる間。「会話の記録を調べています…」が出るかが合否 */
export const ConversationLoading: Story = {
  args: { ...convBase, conversation: conv({ kind: "loading" }) },
};

/** 一覧が出た直後。何も選んでいないので「取り込む」が押せない */
export const ConversationReady: Story = {
  args: {
    ...convBase,
    conversation: conv({ kind: "ready", items: CONV_ITEMS, selected: new Set(), searchedPath: "~/.claude/projects" }),
  },
};

/** 2 つ選んだ状態。「取り込む」が押せる */
export const ConversationReadySelected: Story = {
  args: {
    ...convBase,
    conversation: conv({
      kind: "ready",
      items: CONV_ITEMS,
      selected: new Set([CONV_ITEMS[0].workdir, CONV_ITEMS[1].workdir]),
      searchedPath: "~/.claude/projects",
    }),
  },
};

/** ブラウザ版。理由なしの 1 行だけが出る */
export const ConversationUnavailable: Story = {
  args: { ...convBase, conversation: conv({ kind: "unavailable" }) },
};

/** 読めなかったとき。文と「もう一度」が出る */
export const ConversationError: Story = {
  args: { ...convBase, conversation: conv({ kind: "error" }) },
};

/** 取り込み中。ファイルの進行中と同じ進捗バー（ファイル名の行は無い） */
export const ConversationImporting: Story = {
  args: { ...convBase, conversation: conv({ kind: "importing", done: 40, total: 100 }) },
};

/** 完了。4 行の数字と「素材で見る」。「まとめてナレッジ化」は出ない */
export const ConversationDone: Story = {
  args: {
    ...convBase,
    conversation: conv({ kind: "done", created: 21, updated: 3, unchanged: 8, failed: 0, importedIds: [], changedIds: [] }),
  },
};

/** 完了 + 申し出。候補の本数と AI の利用の見込みを 1 行で伝え、押したときだけナレッジ化が走る */
export const ConversationDoneWithOffer: Story = {
  args: {
    ...convBase,
    conversation: {
      ...conv({ kind: "done", created: 21, updated: 3, unchanged: 8, failed: 0, importedIds: [], changedIds: [] }),
      offer: { total: 32, candidates: 9, onIngest: () => {} },
    },
  },
};

/** 完了 + 失敗あり。失敗の数字が赤になる */
export const ConversationDoneWithFailures: Story = {
  args: {
    ...convBase,
    conversation: conv({ kind: "done", created: 18, updated: 0, unchanged: 5, failed: 2, importedIds: [], changedIds: [] }),
  },
};
