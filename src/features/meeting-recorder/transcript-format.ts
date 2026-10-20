// transcript.json（`read_media_transcript` の JSON 文字列）を表示用の行に整える。
// 例: "[00:12] 相手: こんにちは"。壊れた JSON・segments 無しは null（呼び出し側が .txt に倒す）。

type Seg = { track?: "system" | "mic" | null; startMs?: number; endMs?: number; text?: string };

/** 表示用に整えた発言 1 件（時刻順） */
export type TranscriptSegment = { track: "system" | "mic" | null; startMs: number; endMs?: number; text: string };

export function mmss(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** 発言 1 件を "[00:12] 相手: こんにちは" の行にする */
export function formatSegmentLine(s: TranscriptSegment, labels: { other: string; self: string }): string {
  const who = s.track === "system" ? labels.other : s.track === "mic" ? labels.self : null;
  return `[${mmss(s.startMs)}] ${who ? `${who}: ` : ""}${s.text.trim()}`;
}

/** 発言を時刻順に並べる（同時刻は元の順）。空の発言は捨てる */
export function sortSegments(segs: ReadonlyArray<Seg>): TranscriptSegment[] {
  return segs
    .filter((s) => typeof s.text === "string" && s.text.trim() !== "")
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (a.s.startMs ?? 0) - (b.s.startMs ?? 0) || a.i - b.i)
    .map(({ s }) => ({
      track: s.track ?? null,
      startMs: s.startMs ?? 0,
      ...(typeof s.endMs === "number" ? { endMs: s.endMs } : {}),
      text: (s.text ?? "").trim(),
    }));
}

/** transcript.json を発言の配列にする。壊れた JSON・segments 無しは null */
export function parseTranscriptSegments(json: string | null | undefined): TranscriptSegment[] | null {
  if (!json) return null;
  let parsed: { segments?: Seg[] };
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.segments)) return null;
  return sortSegments(parsed.segments);
}

export function formatTranscriptJson(
  json: string | null | undefined,
  labels: { other: string; self: string },
): string | null {
  const segs = parseTranscriptSegments(json);
  if (!segs) return null;
  const lines = segs.map((s) => formatSegmentLine(s, labels));
  return lines.length ? lines.join("\n") : null;
}
