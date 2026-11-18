// story 用のサンプル（パン作りのオーブン温度ログ）。決定的に作る

import { profileColumns } from "../profile";
import type { ColumnProfile } from "../types";

export const BREAD_HEADERS = ["time", "temp_c", "rise_mm", "dough", "note"];

const DOUGHS = ["baguette", "country", "brioche"];
const NOTES = ["ok", "ok", "ok", "steam on", "door opened", ""];

export const BREAD_ROWS: string[][] = Array.from({ length: 120 }, (_, i) => [
  `${Math.floor(i / 2)}:${i % 2 === 0 ? "00" : "30"}`,
  String(180 + (i % 40) * 2),
  `${(i * 0.37).toFixed(1)} mm`,
  DOUGHS[i % 3],
  NOTES[i % NOTES.length],
]);

export const BREAD_PROFILES: ColumnProfile[] = profileColumns(BREAD_HEADERS, BREAD_ROWS);

/** 列が多い表（20 列以上）。チェックの並びが中でスクロールする */
export const WIDE_PROFILES: ColumnProfile[] = [
  ...BREAD_PROFILES,
  ...Array.from({ length: 21 }, (_, i): ColumnProfile => ({
    name: `probe_${String(i + 1).padStart(2, "0")}`,
    kind: i % 3 === 0 ? "text" : "number",
  })),
];
