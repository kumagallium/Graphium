// 修正案の書き込み先のうち「閉じているノート・スキル」の口（NoteApp が fm の関数を渡して作る）
//
// - 対象の決め方: "this note" はチャットが付いているノート、"skill: <題>" はスキル、それ以外はノートの題
// - 書き換えないもの: AI が作ったナレッジ（wiki）・同梱のシステムスキル・ゴミ箱のノート
//   （共有フォルダの他人のノートは手元の索引に無いので、そもそも見つからない）
// - 保存: ノートは来歴に AI の編集（ai_generation）として版を刻む。スキルは通常の保存（版は付かない）
// - サイドピーク・別ウィンドウで開いているノート: 読む前と書く前に未保存を書き出させ、書いた後にそのエディタへ流し込む
//   （MCP からの書き込みと同じ流れ。peek-save-queue の flushPeekSaves / applyLiveExternalDocDetailed）

import type { GraphiumDocument } from "../../../lib/document-types";
import { recordRevision } from "../../document-provenance/tracker";
import type { EditFileHost, EditTarget } from "./controller";

export type EditFileHostDeps = {
  /** 自分のノートの索引（ゴミ箱を除く） */
  notes(): { noteId: string; title: string; source?: string; wikiKind?: string }[];
  /** スキルの一覧（ID → 題・システムスキルか） */
  skills(): { id: string; title: string; system: boolean }[];
  loadNote(id: string): Promise<GraphiumDocument | null>;
  loadSkill(id: string): Promise<GraphiumDocument | null>;
  saveNote(id: string, doc: GraphiumDocument): Promise<boolean>;
  saveSkill(id: string, doc: GraphiumDocument): Promise<boolean>;
  openNote(id: string): void;
  openSkill(id: string): void;
  /**
   * このノートを開いているサイドピーク・別ウィンドウに未保存の編集を書き出させ、保存の列が空くまで待つ。
   * 書き出し終えて未保存が残っていなければ true（読む・書く前に呼ぶ。人の編集を古さ判定に入れ、巻き戻しを防ぐ）
   */
  settleOpenEditors(noteId: string): Promise<boolean>;
  /** 書いた doc を、このノートを開いているサイドピーク・別ウィンドウに流し込む */
  pushToOpenEditors(noteId: string, doc: GraphiumDocument): void;
  /** 来歴に残す AI の名前（チャットのモデル名） */
  agentLabel(): string;
};

const THIS_NOTE = /^(this note|current note|the note|このノート|今のノート|이 노트)$/i;
const SKILL_PREFIX = /^(skill|スキル|스킬)\s*[:：]\s*/i;

const errors = {
  noCurrent: "this chat is not attached to a note. Name the note by its exact title.",
  wiki: "AI-made knowledge pages (topics, answers, summaries) cannot be edited from chat.",
  systemSkill: "built-in skills cannot be edited from chat.",
  outOfScope: "that note is outside the folder this chat is limited to.",
};

export function createEditFileHost(deps: EditFileHostDeps): EditFileHost {
  const findSkill = (key: string) => {
    const all = deps.skills();
    const exact = all.filter((s) => s.title === key || s.id === key);
    const loose = exact.length > 0 ? exact : all.filter((s) => s.title.toLowerCase() === key.toLowerCase());
    return { all, hits: loose };
  };

  const skillTarget = (key: string): EditTarget | { error: string } => {
    const { all, hits } = findSkill(key);
    if (hits.length === 0) {
      const names = all.filter((s) => !s.system).map((s) => `"${s.title}"`);
      return { error: `no skill titled "${key}". Skills: ${names.join(", ") || "(none)"}` };
    }
    if (hits.length > 1) return { error: `several skills are titled "${key}".` };
    if (hits[0].system) return { error: errors.systemSkill };
    return { kind: "skill", id: hits[0].id, title: hits[0].title };
  };

  const noteById = (id: string, onlyIds?: ReadonlySet<string>): EditTarget | { error: string } => {
    const entry = deps.notes().find((n) => n.noteId === id);
    if (!entry) return { error: "the note was not found." };
    if (entry.wikiKind || entry.source === "ai") return { error: errors.wiki };
    if (onlyIds && !onlyIds.has(id)) return { error: errors.outOfScope };
    return { kind: "note", id, title: entry.title };
  };

  return {
    resolveTarget(ref, ctx) {
      const text = ref.trim().replace(/^"|"$/g, "");
      if (THIS_NOTE.test(text)) {
        const current = ctx.currentNoteId;
        if (!current) return { error: errors.noCurrent };
        if (current.startsWith("wiki:")) return { error: errors.wiki };
        if (current.startsWith("skill:")) {
          const id = current.slice("skill:".length);
          const s = deps.skills().find((k) => k.id === id);
          if (!s) return { error: "the skill was not found." };
          if (s.system) return { error: errors.systemSkill };
          return { kind: "skill", id, title: s.title };
        }
        return noteById(current, ctx.onlyIds);
      }
      const skillKey = text.match(SKILL_PREFIX) ? text.replace(SKILL_PREFIX, "").trim() : null;
      if (skillKey !== null) return skillTarget(skillKey);

      const notes = deps.notes().filter((n) => n.title === text);
      const own = notes.filter((n) => !n.wikiKind && n.source !== "ai");
      if (own.length === 1) return noteById(own[0].noteId, ctx.onlyIds);
      if (own.length > 1) return { error: `several notes are titled "${text}". Ask the user which one, or open it and use "this note".` };
      if (notes.length > 0) return { error: errors.wiki };
      // 題が合うスキルがあれば、それを指していると読む
      const { hits } = findSkill(text);
      if (hits.length === 1) return hits[0].system ? { error: errors.systemSkill } : { kind: "skill", id: hits[0].id, title: hits[0].title };
      return { error: `no note titled "${text}". Use the exact title.` };
    },

    checkTarget(target) {
      if (target.kind === "skill") {
        const s = deps.skills().find((k) => k.id === target.id);
        if (!s) return "the skill was not found.";
        return s.system ? errors.systemSkill : null;
      }
      const r = noteById(target.id);
      return "error" in r ? r.error : null;
    },

    listSkills() {
      return deps.skills().filter((s) => !s.system).map(({ id, title }) => ({ id, title }));
    },

    async readFile(target) {
      if (target.kind === "note") await deps.settleOpenEditors(target.id);
      const doc = target.kind === "skill" ? await deps.loadSkill(target.id) : await deps.loadNote(target.id);
      const blocks = doc?.pages?.[0]?.blocks;
      return Array.isArray(blocks) ? blocks : null;
    },

    async writeFile(target, blocks) {
      // ピーク・別ウィンドウの未保存を先に書き出させる。書き出せないまま残るなら書かない（後勝ちで巻き戻るため）
      if (target.kind === "note" && !(await deps.settleOpenEditors(target.id))) return "busy";
      const doc = target.kind === "skill" ? await deps.loadSkill(target.id) : await deps.loadNote(target.id);
      const page = doc?.pages?.[0];
      if (!doc || !page) return false;
      const next: GraphiumDocument = {
        ...doc,
        modifiedAt: new Date().toISOString(),
        pages: [{ ...page, blocks }, ...doc.pages.slice(1)],
      };
      if (target.kind === "skill") return deps.saveSkill(target.id, next);
      const revised = await recordRevision(next, page, "ai_generation", { agentLabel: deps.agentLabel(), force: true });
      const ok = await deps.saveNote(target.id, revised);
      if (ok) deps.pushToOpenEditors(target.id, revised);
      return ok;
    },

    openTarget(target) {
      if (target.kind === "skill") deps.openSkill(target.id);
      else deps.openNote(target.id);
    },
  };
}
