// 外の AI（MCP）がファイルへ直接書いた内容を、アプリのキャッシュへ取り込む処理（drainer）の口。
//
// アプリは doc キャッシュを正としている。MCP が書いてから知らせを処理するまでの間に利用者が
// そのページを開くと、古いキャッシュが出て、編集すると MCP の書き込みを上書きする。
// ナレッジのページの doc をエディタへ渡す入口は、キャッシュを読む前にここで知らせをさらう。
// （drainer は features/mcp-live の useMcpNotices が登録する。lib から features を参照しないため口だけ置く）

let drainer: (() => Promise<void>) | null = null;
// 直前の drain が成功した時刻。ページを開くたびに保存先の列挙が走らないよう、短い間は再実行しない
let lastDrainOkAt = 0;
/** 直前の drain が成功してからこの間は、もう一度さらわずに進む */
export const EXTERNAL_DRAIN_REUSE_MS = 1000;

/** 知らせをさらう処理を登録する（null で解除）。アプリに 1 つだけ */
export function setExternalChangeDrainer(fn: (() => Promise<void>) | null): void {
  drainer = fn;
  lastDrainOkAt = 0;
}

/** 登録中の drainer（自分が登録した口だけ外すための確認用） */
export function getExternalChangeDrainer(): (() => Promise<void>) | null {
  return drainer;
}

/**
 * 登録された drainer を実行し、終わるまで待つ。登録が無ければ即座に解決する。
 * drainer の失敗は握る。timeoutMs を過ぎたら待たずに進む（保存先が遅くても、ページを開けなくしない）
 */
export function drainExternalChanges(timeoutMs = 800): Promise<void> {
  const fn = drainer;
  if (!fn) return Promise.resolve();
  if (lastDrainOkAt > 0 && Date.now() - lastDrainOkAt < EXTERNAL_DRAIN_REUSE_MS) return Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  const run = (async () => {
    try {
      await fn();
      if (drainer === fn) lastDrainOkAt = Date.now();
    } catch (e) {
      console.warn("[external-changes] 知らせの取り込みに失敗:", e);
    }
  })();
  return Promise.race([run, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const k of Object.keys(obj).sort()) {
      if (obj[k] === undefined) continue;
      parts.push(`${JSON.stringify(k)}:${stableStringify(obj[k])}`);
    }
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * 2 つのドキュメントが同じ内容か（キーの並びは問わない。更新時刻・来歴も含む全体）。
 * 外の AI が書いた内容が、キャッシュにあるものと違うかの判定に使う
 */
export function sameDocumentContent(a: unknown, b: unknown): boolean {
  return a === b || stableStringify(a) === stableStringify(b);
}
