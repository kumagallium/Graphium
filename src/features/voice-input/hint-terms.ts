// 声の入力で whisper に渡す「用語のヒント」を、利用者のノートから作る。
//
// whisper はヒントに書かれた語の綴りを真似るので、化学式・型番・略語（LiCoO2 / XRD など）は
// ヒントがあるかで結果が大きく変わる。設定に何も書いていない人でも自分の分野の綴りで出るよう、
// ノートの題と見出しから英字と数字の語を拾い、出てくるノートの数が多い順に並べる。
//
// 測定（Crucible experiments/2026-11-22-voice-input-hints）で決めたこと:
// - 拾うのは英字の語だけ。題に多い日本語の語はほとんどが一般語で効かず（期待した語が入っていても
//   同じ音の別の語で出た）、空白で区切って並べると出力まで 1 字ずつ区切られる
// - 区切りは空白。「, 」で並べると出力にも読点が混ざる（「Z, N, S, B」）
// - 設定の「よく使う用語」は末尾に置く。whisper は末尾側を残し、Rust 側も末尾 160 文字を残す

import { getActiveNotes, type GraphiumIndex, type NoteIndexEntry } from "../navigation/index-file";

/** Rust の normalize_vocabulary が残す長さと同じ */
export const VOICE_HINT_MAX_CHARS = 160;

/** 英字で始まり、英数字が続く語（Bi2Te3・Sr14Al8Ge3・SPS・Al-Si） */
const LATIN_TERM = /[A-Za-z][A-Za-z0-9]*(?:[-+.][A-Za-z0-9]+)*/g;

/** 化学式・型番・略語らしい語か（数字を含む、または大文字が 2 つ以上） */
function isDistinctiveTerm(w: string): boolean {
  if (w.length < 3 || w.length > 24) return false;
  return /\d/.test(w) || (w.match(/[A-Z]/g) ?? []).length >= 2;
}

/** ノートの題と見出しから、英字の語を「出てくるノートの数」の多い順に返す */
export function rankLatinTerms(notes: readonly Pick<NoteIndexEntry, "title" | "headings">[]): string[] {
  const df = new Map<string, number>();
  for (const n of notes) {
    const seen = new Set<string>();
    for (const text of [n.title, ...(n.headings ?? []).map((h) => h.text)]) {
      for (const m of text.matchAll(LATIN_TERM)) {
        if (isDistinctiveTerm(m[0])) seen.add(m[0]);
      }
    }
    for (const w of seen) df.set(w, (df.get(w) ?? 0) + 1);
  }
  // 同数なら短い語・辞書順で決めて、毎回同じヒントになるようにする
  return [...df].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0])).map(([w]) => w);
}

/**
 * ヒントの文字列を組み立てる。頻度順の英字の語を空白でつなぎ、末尾に設定の用語を置く。
 * 全体が VOICE_HINT_MAX_CHARS を超えないよう、英字の語は入るところまで入れる
 */
export function buildVoiceHint(rankedTerms: readonly string[], userVocabulary: string): string {
  const user = userVocabulary.trim();
  const budget = VOICE_HINT_MAX_CHARS - (user ? user.length + 1 : 0);
  let auto = "";
  for (const w of rankedTerms) {
    const next = auto ? `${auto} ${w}` : w;
    if (next.length > budget) break;
    auto = next;
  }
  return [auto, user].filter(Boolean).join(" ");
}

// ── ノート一覧の受け渡し（note-app が最新の一覧を入れ、録音を止めたときに読む） ──
let source: GraphiumIndex | null = null;
let cache: { from: GraphiumIndex | null; terms: string[] } = { from: null, terms: [] };

export function setVoiceHintSource(index: GraphiumIndex | null): void {
  source = index;
}

/** 今のノートから拾った英字の語（一覧が変わったときだけ数え直す） */
export function currentVoiceHintTerms(): string[] {
  if (cache.from !== source) {
    cache = { from: source, terms: rankLatinTerms(getActiveNotes(source)) };
  }
  return cache.terms;
}
