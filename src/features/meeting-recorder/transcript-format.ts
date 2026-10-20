// transcript.json（`read_media_transcript` の JSON 文字列）を表示用の行に整える。
// 例: "[00:12] 相手: こんにちは"。壊れた JSON・segments 無しは null（呼び出し側が .txt に倒す）。

type Seg = { track?: "system" | "mic" | null; startMs?: number; text?: string };

function mmss(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatTranscriptJson(
  json: string | null | undefined,
  labels: { other: string; self: string },
): string | null {
  if (!json) return null;
  let parsed: { segments?: Seg[] };
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.segments)) return null;
  const lines = parsed.segments
    .filter((s) => typeof s.text === "string" && s.text.trim() !== "")
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (a.s.startMs ?? 0) - (b.s.startMs ?? 0) || a.i - b.i)
    .map(({ s }) => {
      const who = s.track === "system" ? labels.other : s.track === "mic" ? labels.self : null;
      return `[${mmss(s.startMs ?? 0)}] ${who ? `${who}: ` : ""}${(s.text ?? "").trim()}`;
    });
  return lines.length ? lines.join("\n") : null;
}
