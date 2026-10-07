// ブロック左の ＋ / ⠿ に出すツールチップ
//
// BlockNote のサイドメニューのボタンは aria-label しか持たず、見た目のヒントが無い。
// Notion 系のエディタを知らない人は「⠿ を掴むと動く」「押すとメニューが出る」に
// 気付けないので、ホバーで名前と使い方を出す。
//
// ヒントは 2 段に分ける（design.md「ツールチップの 3 種類」）:
//   - 名前（例: ブロックの操作）… いつでも出す
//   - 使い方（例: ドラッグで移動・クリックでメニュー）… 数回使ったら出さない。
//     慣れた人に毎回説明を見せるとうるさいだけなので「卒業」させる
//
// 出し方:
//   - マウスのときだけ（タッチではホバーが無く、タップで出すと操作の邪魔になる）
//   - 0.5 秒待ってから出す（通過しただけで出さない）。直前に別のヒントを
//     見ていたら待たずに出す（＋ から ⠿ へ移ったときに毎回待たせない）
//   - 押した・掴んだ瞬間に消す（メニューやドラッグの邪魔をしない）
//
// BlockNote の AddBlockButton / DragHandleButton は自前でボタンを描くので、
// display: contents の span で包んでイベントだけ拾う（並びのレイアウトは変わらない）。

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";
import { placeFloating } from "../ui/floating-position";

export type SideMenuHintKind = "add" | "drag";

const SHOW_DELAY_MS = 500;
/** 直前のヒントが消えてからこの間なら待たずに出す */
const WARM_WINDOW_MS = 800;
/** この回数使ったら使い方の行を出さない */
export const HINT_GRADUATE_USES = 5;
const STORAGE_KEY = "graphium.sideMenuHintUses";

let lastHiddenAt = 0;

type UseCounts = Partial<Record<SideMenuHintKind, number>>;

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
export function shouldShowUsage(kind: SideMenuHintKind): boolean {
  const n = readUses()[kind];
  return typeof n !== "number" || n < HINT_GRADUATE_USES;
}

/** ボタンを使った回数を 1 つ数える。上限に届いたら書き込みをやめる */
export function recordHintUse(kind: SideMenuHintKind): void {
  try {
    const uses = readUses();
    const n = typeof uses[kind] === "number" ? (uses[kind] as number) : 0;
    if (n >= HINT_GRADUATE_USES) return;
    uses[kind] = n + 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(uses));
  } catch {
    // 保存できない環境では毎回使い方を出すだけ
  }
}

/** ツールチップの見た目だけ（Storybook からも使う） */
export function HintBubble({ title, usage }: { title: string; usage?: string }) {
  return (
    <div className="graphium-hint-bubble" role="tooltip">
      <div className="graphium-hint-title">{title}</div>
      {usage && <div className="graphium-hint-usage">{usage}</div>}
    </div>
  );
}

type Anchor = { top: number; left: number; bottom: number; right: number };

function FloatingHint({ anchor, title, usage }: { anchor: Anchor; title: string; usage?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // 描いてから測り、ボタンの真下（入らなければ真上）に中央揃えで置く
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const center = (anchor.left + anchor.right) / 2;
    const placed = placeFloating({
      anchor: { ...anchor, left: center - width / 2, right: center + width / 2 },
      size: { width, height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      placement: "bottom-start",
      gap: 6,
    });
    setPos({ top: placed.top, left: placed.left });
  }, [anchor]);

  return createPortal(
    <div
      ref={ref}
      data-graphium-side-menu-hint=""
      style={{
        position: "fixed",
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        visibility: pos ? "visible" : "hidden",
        pointerEvents: "none",
        zIndex: 10002,
      }}
    >
      <HintBubble title={title} usage={usage} />
    </div>,
    document.body,
  );
}

export function SideMenuHint({ kind, children }: { kind: SideMenuHintKind; children: ReactNode }) {
  const t = useT();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [showUsage, setShowUsage] = useState(true);
  const timer = useRef<number | null>(null);
  // 1 回の押下で pointerdown が 2 度届くことがある（実ブラウザで確認）ので、
  // 乗せてから離れるまでに数えるのは 1 回だけにする
  const counted = useRef(false);

  const clearTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const hide = useCallback(() => {
    clearTimer();
    setAnchor((prev) => {
      if (prev) lastHiddenAt = Date.now();
      return null;
    });
  }, []);

  useEffect(() => clearTimer, []);

  // ⠿ のメニューは body へ Portal で出るが、React のイベントは React のツリーを伝って
  // ここまで上がってくる。メニュー項目の上の出来事を拾わないよう、実 DOM の中だけ見る
  const isOwnTarget = (e: SyntheticEvent) =>
    (e.currentTarget as HTMLElement).contains(e.target as Node);

  const onPointerEnter = (e: ReactPointerEvent) => {
    if (!isOwnTarget(e)) return;
    counted.current = false;
    if (e.pointerType !== "mouse") return;
    const button = (e.target as HTMLElement).closest("button");
    if (!button) return;
    clearTimer();
    const show = () => {
      const r = button.getBoundingClientRect();
      setShowUsage(shouldShowUsage(kind));
      setAnchor({ top: r.top, left: r.left, bottom: r.bottom, right: r.right });
    };
    if (Date.now() - lastHiddenAt < WARM_WINDOW_MS) show();
    else timer.current = window.setTimeout(show, SHOW_DELAY_MS);
  };

  // ＋ は押した時点で使ったとみなす。⠿ は押す（メニュー）か掴む（ドラッグ）かが
  // まだ分からないが、どちらも使い方を覚えた印なので押した時点で数える
  const onPointerDown = (e: ReactPointerEvent) => {
    if (!isOwnTarget(e)) return;
    if (!counted.current) {
      counted.current = true;
      recordHintUse(kind);
    }
    hide();
  };

  const title = kind === "add" ? t("sideMenuHint.addTitle") : t("sideMenuHint.dragTitle");
  const usage = kind === "add" ? t("sideMenuHint.addUsage") : t("sideMenuHint.dragUsage");

  return (
    <span
      style={{ display: "contents" }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={hide}
      onPointerDown={onPointerDown}
      onDragStart={hide}
    >
      {children}
      {anchor && <FloatingHint anchor={anchor} title={title} usage={showUsage ? usage : undefined} />}
    </span>
  );
}
