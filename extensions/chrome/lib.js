// 純関数群（chrome API に依存しない。vitest で検証する）

/** ペアリングコード "<port>.<token>" を解析する。不正なら null */
export function parsePairingCode(code) {
  if (typeof code !== "string") return null;
  const m = /^(\d{1,5})\.([A-Za-z0-9_-]{32,})$/.exec(code.trim());
  if (!m) return null;
  const port = Number(m[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { port, token: m[2] };
}

/** http/https の URL だけクリップ対象にする */
export function isClippableUrl(url) {
  if (typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** 送信 body を組み立てる。空白だけの選択は page 扱い（長さはそのまま） */
export function buildClipPayload({ selection, title, url, doi, kind, now }) {
  const hasText = typeof selection === "string" && selection.trim() !== "";
  const payload = {
    url,
    title: title || "",
    clippedAt: (now instanceof Date ? now : new Date(now ?? Date.now())).toISOString(),
    kind: hasText && kind !== "page" ? "selection" : "page",
  };
  if (hasText && payload.kind === "selection") payload.text = selection;
  if (doi) payload.doi = doi;
  return payload;
}

/** キューの末尾に追加し、max を超えたら古いものから捨てる（元の配列は変更しない） */
export function enqueue(queue, item, max = 200) {
  const next = [...(Array.isArray(queue) ? queue : []), item];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** meta の値群から DOI を取り出して "10.xxx" に正規化する。無ければ null */
export function extractDoi(metaValues) {
  for (const raw of metaValues || []) {
    if (typeof raw !== "string") continue;
    let v = raw.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "");
    try { v = decodeURIComponent(v); } catch { /* そのまま */ }
    const m = /^(10\.\d{4,9}\/\S+)$/.exec(v.trim());
    if (m) return m[1];
  }
  return null;
}
