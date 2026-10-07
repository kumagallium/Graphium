// 共通ツールチップ
//
// ブラウザ標準の title は「出るまで約 1 秒」「見た目が揃わない」「長い説明が 1 行に潰れる」
// 「タッチで出ない／埋め込みのブラウザで出ないことがある」ので、アプリのヒントはここに揃える。
// 方針は design.md「ヒント（ツールチップ）の 3 種類」。
//
// 使い方は属性だけ（React 側にラッパーを置かない）:
//   <button aria-label="閉じる" data-tooltip="閉じる">…</button>
//   data-tooltip           … 1 行目（名前・状態の説明）。\n で改行できる
//   data-tooltip-usage     … 2 行目（使い方）。小さく薄く出す
//   data-tooltip-graduate  … 使い方の「卒業」キー。そのキーの要素を HINT_GRADUATE_USES 回
//                            押したら 2 行目を出さない（慣れた人に説明を見せ続けない）
//
// 監視役は document に 1 つだけ置き（installTooltips）、イベントの委譲で拾う。
//   - React の外（BlockNote が描く部品・body へ出したメニュー）にも、属性さえあれば効く
//   - 要素の DOM には書き込まない（ProseMirror の管理下の DOM に属性を書くと、
//     PM が変更として拾ってループする。title を外して標準の表示を抑える、のような細工はしない）
//
// 出し方:
//   - マウスは 0.5 秒待ってから。直前に別のヒントを見ていたら待たずに出す（隣へ移るたびに待たせない）
//   - キーボードのフォーカス（:focus-visible）では待たずに出す
//   - タッチでは出さない（ホバーが無く、押した瞬間に操作が始まる）
//   - 押す・ドラッグ・スクロール・Esc で消す
//
// 押せない（disabled）ボタン: ブラウザはその上でマウスの通知を一切送らない（要素にも祖先にも）。
// 「なぜ押せないか」の説明が消えないよう、CSS で pointer-events: none にして通知を外側へ通し、
// pointermove の位置から押せない要素を探して出す（app.css の [data-tooltip]:disabled）。
//
// アクセシビリティ: ツールチップはマウスの補助で、読み上げの名前ではない。
// アイコンだけのボタンは aria-label を必ず持たせる（IconButton は aria-label から
// data-tooltip を自動で付ける）。

import { placeFloating } from "./floating-position";

const SHOW_DELAY_MS = 500;
/** 直前のヒントが消えてからこの間なら待たずに出す */
const WARM_WINDOW_MS = 800;
/** data-tooltip-graduate の要素をこの回数押したら使い方の行を出さない */
export const HINT_GRADUATE_USES = 5;
// v0.87.2 の ＋/⠿ のヒントと同じ保存先（キー add / drag の数え直しを避ける）
const STORAGE_KEY = "graphium.sideMenuHintUses";
const TIP_SELECTOR = "[data-tooltip]";
const DISABLED_TIP_SELECTOR = "[data-tooltip]:disabled";

type UseCounts = Record<string, number>;

function readUses(): UseCounts {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** 使い方の行をまだ出すか（使った回数が少ないうち） */
export function shouldShowUsage(key: string): boolean {
  const n = readUses()[key];
  return typeof n !== "number" || n < HINT_GRADUATE_USES;
}

/** 卒業キーの要素を使った回数を 1 つ数える。上限に届いたら書き込みをやめる */
export function recordHintUse(key: string): void {
  try {
    const uses = readUses();
    const n = typeof uses[key] === "number" ? uses[key] : 0;
    if (n >= HINT_GRADUATE_USES) return;
    uses[key] = n + 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(uses));
  } catch {
    // 保存できない環境では毎回使い方を出すだけ
  }
}

/** ツールチップの中身（DOM）を作る。React の HintBubble と同じクラスで描く */
export function buildBubble(title: string, usage?: string | null): HTMLElement {
  const bubble = document.createElement("div");
  bubble.className = "graphium-hint-bubble";
  const titleEl = document.createElement("div");
  titleEl.className = "graphium-hint-title";
  titleEl.textContent = title;
  bubble.appendChild(titleEl);
  if (usage) {
    const usageEl = document.createElement("div");
    usageEl.className = "graphium-hint-usage";
    usageEl.textContent = usage;
    bubble.appendChild(usageEl);
  }
  return bubble;
}

/** display: contents の包み（＋/⠿）は箱を持たないので、最初の子の矩形を使う */
function anchorRect(el: Element): DOMRect | null {
  const r = el.getBoundingClientRect();
  if (r.width > 0 || r.height > 0) return r;
  const child = el.firstElementChild;
  if (!child) return null;
  const c = child.getBoundingClientRect();
  return c.width > 0 || c.height > 0 ? c : null;
}

function isDisabledTip(el: Element | null): boolean {
  try {
    return !!el && el.matches(DISABLED_TIP_SELECTOR);
  } catch {
    return false;
  }
}

function contains(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function closestTip(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>(TIP_SELECTOR);
}

type Controller = {
  /** テスト用: 表示中の吹き出し */
  current(): HTMLElement | null;
  hide(): void;
  uninstall(): void;
};

let installed: Controller | null = null;

export function installTooltips(doc: Document = document): Controller {
  if (installed) return installed;

  let layer: HTMLElement | null = null;
  let activeEl: HTMLElement | null = null;
  let pendingEl: HTMLElement | null = null;
  let timer: number | null = null;
  let lastHiddenAt = 0;

  const clearTimer = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    pendingEl = null;
  };

  const hide = () => {
    clearTimer();
    if (layer) {
      layer.remove();
      layer = null;
      lastHiddenAt = Date.now();
    }
    activeEl = null;
  };

  const show = (el: HTMLElement) => {
    clearTimer();
    const title = el.getAttribute("data-tooltip")?.trim();
    if (!title || !el.isConnected) return hide();
    const rect = anchorRect(el);
    if (!rect) return hide();
    const graduate = el.getAttribute("data-tooltip-graduate");
    const usageRaw = el.getAttribute("data-tooltip-usage");
    const usage = usageRaw && (!graduate || shouldShowUsage(graduate)) ? usageRaw : null;

    if (layer) layer.remove();
    layer = doc.createElement("div");
    layer.setAttribute("data-graphium-tooltip", "");
    layer.setAttribute("role", "tooltip");
    layer.style.cssText =
      "position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;z-index:10003";
    layer.appendChild(buildBubble(title, usage));
    doc.body.appendChild(layer);

    // 描いてから測り、要素の真下（入らなければ真上）に中央揃えで置く
    const width = layer.offsetWidth;
    const height = layer.offsetHeight;
    const center = (rect.left + rect.right) / 2;
    const placed = placeFloating({
      anchor: { top: rect.top, bottom: rect.bottom, left: center - width / 2, right: center + width / 2 },
      size: { width, height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      placement: "bottom-start",
      gap: 6,
    });
    layer.style.top = `${placed.top}px`;
    layer.style.left = `${placed.left}px`;
    layer.style.visibility = "visible";
    activeEl = el;
  };

  const schedule = (el: HTMLElement) => {
    if (el === activeEl || el === pendingEl) return;
    hide();
    if (Date.now() - lastHiddenAt < WARM_WINDOW_MS) {
      show(el);
      return;
    }
    pendingEl = el;
    timer = window.setTimeout(() => show(el), SHOW_DELAY_MS);
  };

  const onPointerOver = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const el = closestTip(e.target);
    if (el) schedule(el);
    // 押せない要素の上は通知が外側に来るので、出入りは pointermove で決める
    else if ((activeEl || pendingEl) && !isDisabledTip(activeEl ?? pendingEl)) hide();
  };

  // 押せない要素のための位置判定（1 フレームに 1 回）
  let moveFrame = 0;
  let lastX = 0;
  let lastY = 0;
  let lastTarget: EventTarget | null = null;
  const checkDisabledAtPoint = () => {
    moveFrame = 0;
    const cur = activeEl ?? pendingEl;
    if (cur && isDisabledTip(cur)) {
      const r = anchorRect(cur);
      if (!r || !contains(r, lastX, lastY)) hide();
      return;
    }
    if (closestTip(lastTarget)) return; // ふつうの要素は pointerover の側で扱う
    for (const el of Array.from(doc.querySelectorAll<HTMLElement>(DISABLED_TIP_SELECTOR))) {
      const r = anchorRect(el);
      if (r && contains(r, lastX, lastY)) {
        schedule(el);
        return;
      }
    }
  };
  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    lastX = e.clientX;
    lastY = e.clientY;
    lastTarget = e.target;
    if (!moveFrame) moveFrame = window.requestAnimationFrame(checkDisabledAtPoint);
  };

  const onPointerOut = (e: PointerEvent) => {
    const el = activeEl ?? pendingEl;
    if (!el || isDisabledTip(el)) return;
    const to = e.relatedTarget;
    if (to instanceof Node && el.contains(to)) return;
    hide();
  };

  const onPointerDown = (e: PointerEvent) => {
    const el = closestTip(e.target);
    const key = el?.getAttribute("data-tooltip-graduate");
    // 1 回の押下で pointerdown が 2 度届くことがある（実ブラウザで確認）。
    // 表示中・表示待ちの要素だけ数え、数えたら hide で外すので 2 度目は数えない
    if (key && (el === activeEl || el === pendingEl)) recordHintUse(key);
    hide();
  };

  const onFocusIn = (e: FocusEvent) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    let focusVisible = false;
    try {
      focusVisible = target.matches(":focus-visible");
    } catch {
      focusVisible = false;
    }
    if (!focusVisible) return;
    const el = closestTip(target);
    if (el) show(el);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && (activeEl || pendingEl)) hide();
  };

  const listeners: Array<[string, EventListener]> = [
    ["pointerover", onPointerOver as EventListener],
    ["pointerout", onPointerOut as EventListener],
    ["pointermove", onPointerMove as EventListener],
    ["pointerdown", onPointerDown as EventListener],
    ["focusin", onFocusIn as EventListener],
    ["focusout", hide],
    ["keydown", onKeyDown as EventListener],
    ["dragstart", hide],
    ["scroll", hide],
    ["wheel", hide],
  ];
  for (const [type, fn] of listeners) doc.addEventListener(type, fn, { capture: true, passive: true });

  installed = {
    current: () => layer,
    hide,
    uninstall: () => {
      hide();
      if (moveFrame) window.cancelAnimationFrame(moveFrame);
      for (const [type, fn] of listeners) doc.removeEventListener(type, fn, { capture: true });
      installed = null;
    },
  };
  return installed;
}
