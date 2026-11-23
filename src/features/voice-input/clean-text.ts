// whisper の出力を入力欄向けに整える（純関数）

const FILLERS = ["えっと", "えーと", "えー", "あのー", "あの", "うーん", "um", "uh", "er"];
// 長い語を先に試す（「えーと」が「えー」に先に食われないように）
const FILLER_ALT = [...FILLERS].sort((a, b) => b.length - a.length).join("|");
// 先頭: 言いよどみ + 後ろの読点・空白
const LEADING = new RegExp(`^(?:(?:${FILLER_ALT})(?![A-Za-z])[\\s、,，]*)+`, "i");
// 末尾: 前の読点・空白 + 言いよどみ（+ 句読点）
const TRAILING = new RegExp(`(?:[\\s、,，]*(?<![A-Za-z])(?:${FILLER_ALT}))+[\\s。．.、,，！!？?]*$`, "i");
const END_PUNCT = /[。．.、,，！!？?]+$/;

export function cleanVoiceText(raw: string): string {
  let s = raw.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s.replace(LEADING, "").replace(TRAILING, "").replace(END_PUNCT, "").trim();
    if (s === before) break;
  }
  return s;
}

/** 入力欄が空ならそのまま、空でなければ半角空白でつないで末尾に足す */
export function appendVoiceText(current: string, text: string): string {
  if (!current) return text;
  return `${current} ${text}`;
}
