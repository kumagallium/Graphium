// LP のコンセプトの絵。
// 「場面が違っても同じ場所に残り、あとから同じ言葉で見つかる」を 1 枚で伝える。
// 左はアプリの「記録」の画面を小さく写したもの（札の言葉と色・残した人の印はアプリと同じ）、
// 右は同じ記録が言葉で見つかる様子。画面に入ると、言葉が打たれて結果が順に現れる。
// 絵に出すのは、いまの記録の画面で実際に起きることだけにする（札は records.origin.* の言葉、
// 見つかるのは題・見出し・ノートの本文・メモの本文・URL の抜粋。v0.139.0 で確かめた）。
// 「録音から」は、録音済みの文字起こしブロックを持つノートに付く札。絵の 1 文はそのノートに
// 書いた本文で、文字起こしの中の言葉ではない（文字起こしの言葉で見つかるのは録音の素材のほう）。
// 実装が変わったら、ここも合わせる。
// ヒーローの中（ボタンの下、動画の上）に置く。文言は i18n.ts の moments.* にある。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { en, useI18n } from "../i18n";
import {
  Globe,
  Image as ImageIcon,
  MessagesSquare,
  Mic,
  Search,
  Smartphone,
  StickyNote,
  type LucideIcon,
} from "lucide-react";

// 札の色。アプリの記録の画面（record-dashboard.css の data-tone）と同じ割り当て
type Tone = "rose" | "amber" | "sky" | "forest" | "plain";
// 残した人。印の形もアプリと同じ（自分 = 塗りの丸 / 自分と AI = 丸に輪）
type Who = "self" | "selfWithAi";

type Moment = {
  id: string;
  time: string;
  icon: LucideIcon;
  tone: Tone;
  // どこで残したか
  where: string;
  who: Who;
  // 何を（題）。メモは題を持たない
  title?: string;
  // 何を（題の下の 1 行）。メモは本文、ノートは本文の中の 1 文、Web クリップは抜粋。写真は持たない。
  // v0.139.0 から、記録の画面はノートの本文でも当たり、当たった 1 文を題の下に出す
  text?: string;
  // 写真などのファイル名
  file?: string;
};

type Copy = {
  moments: Moment[];
  heading: string;
  date: string;
  count: string;
  legend: [string, string, string, string];
  who: Record<Who, string>;
  query: string;
  placeholder: string;
  hits: string;
  foot: string;
  note: string;
};

// 記録の並び。言葉（どこで・題・題の下の 1 行・ファイル名）は i18n.ts の moments.<id>.* に置く
const ROWS: Pick<Moment, "id" | "time" | "icon" | "tone" | "who">[] = [
  { id: "memo", time: "09:05", icon: StickyNote, tone: "plain", who: "self" },
  { id: "meeting", time: "10:12", icon: Mic, tone: "rose", who: "self" },
  { id: "photo", time: "11:30", icon: Smartphone, tone: "forest", who: "self" },
  { id: "web", time: "13:40", icon: Globe, tone: "amber", who: "self" },
  { id: "ai", time: "16:05", icon: MessagesSquare, tone: "sky", who: "selfWithAi" },
];

type MomentsKey = Extract<keyof typeof en, `moments.${string}`>;

function buildCopy(t: (key: keyof typeof en) => string): Copy {
  // 行によって持たない項目（メモの題、写真の本文など）は、辞書に無ければ undefined にする
  const opt = (key: string) => (key in en ? t(key as MomentsKey) : undefined);
  return {
    moments: ROWS.map((r) => ({
      ...r,
      where: t(`moments.${r.id}.where` as MomentsKey),
      title: opt(`moments.${r.id}.title`),
      text: opt(`moments.${r.id}.text`),
      file: opt(`moments.${r.id}.file`),
    })),
    heading: t("moments.heading"),
    date: t("moments.date"),
    count: t("moments.count"),
    legend: [t("moments.legend.when"), t("moments.legend.where"), t("moments.legend.who"), t("moments.legend.what")],
    who: { self: t("moments.who.self"), selfWithAi: t("moments.who.selfWithAi") },
    query: t("moments.query"),
    placeholder: t("moments.placeholder"),
    hits: t("moments.hits"),
    foot: t("moments.foot"),
    note: t("moments.note"),
  };
}

// 探す言葉にあたる部分だけを <mark> で囲む
function Marked({ text, query }: { text: string; query: string }) {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + query.length)}</mark>
      {text.slice(at + query.length)}
    </>
  );
}

function matches(m: Moment, query: string) {
  const q = query.toLowerCase();
  return [m.title, m.text].some((s) => s?.toLowerCase().includes(q));
}

// 絵の進み具合。found が完成形で、動きを使わない環境では最初からこの形を見せる
type Stage = "idle" | "typing" | "found";

const TYPE_START_MS = 500;
const FOUND_AFTER_MS = 320;

// 画面に入ったら 1 度だけ、言葉を 1 文字ずつ打ってから結果を出す。
// 動きを減らす設定のとき・IntersectionObserver が無いときは、完成形のまま動かさない
function usePlayOnce(query: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage>("found");
  const [typed, setTyped] = useState(query.length);

  // 描画の前に最初の形へ戻す（完成形が一瞬見えてから消えるのを避ける）
  useLayoutEffect(() => {
    const canAnimate =
      typeof IntersectionObserver !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
    if (!canAnimate) {
      setStage("found");
      setTyped(query.length);
      return;
    }
    setStage("idle");
    setTyped(0);
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setStage((s) => (s === "idle" ? "typing" : s));
          observer.disconnect();
        }
      },
      // 探す側のカードが 4 割見えたら始める（縦に並ぶスマホ幅では、絵の全体は画面に収まらない）
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [query]);

  useEffect(() => {
    if (stage !== "typing") return;
    // 長い言葉でも打ち終わりまでの時間がほぼ同じになるようにする
    const perChar = Math.max(70, Math.min(170, 900 / query.length));
    const delay = typed === 0 ? TYPE_START_MS : typed < query.length ? perChar : FOUND_AFTER_MS;
    const timer = window.setTimeout(() => {
      if (typed < query.length) setTyped(typed + 1);
      else setStage("found");
    }, delay);
    return () => window.clearTimeout(timer);
  }, [stage, typed, query]);

  return { ref, stage, typed };
}

function WhoMark({ who }: { who: Who }) {
  return <span className="lp-mp-mark" data-who={who} aria-hidden="true" />;
}

export function MomentsPicture() {
  const { t, locale } = useI18n();
  const copy = useMemo(() => buildCopy(t), [t]);
  const { ref, stage, typed } = usePlayOnce(copy.query);
  const [when, where, who, what] = copy.legend;
  const hits = copy.moments.filter((m) => matches(m, copy.query));

  return (
    <figure className="lp-moments" lang={locale}>
      <div className="lp-mp" data-stage={stage}>
        <div className="lp-mp-log">
          <p className="lp-mp-log-head">
            <span className="lp-mp-heading">{copy.heading}</span>
            <span className="lp-mp-date">{copy.date}</span>
            <span className="lp-mp-count">{copy.count}</span>
          </p>
          <p className="lp-mp-legend" aria-hidden="true">
            <span>{when}</span>
            <span>
              {where} · {who} · {what}
            </span>
          </p>
          <ol>
            {copy.moments.map((m) => (
              <li key={m.id} data-hit={matches(m, copy.query)}>
                <time>{m.time}</time>
                <div className="lp-mp-entry">
                  <WhoMark who={m.who} />
                  <p className="lp-mp-meta">
                    <span className="lp-mp-where" data-tone={m.tone}>
                      <m.icon size={13} aria-hidden="true" />
                      {m.where}
                    </span>
                    <span className="lp-mp-who">{copy.who[m.who]}</span>
                  </p>
                  {m.title && (
                    <p className="lp-mp-title">
                      <Marked text={m.title} query={copy.query} />
                    </p>
                  )}
                  {m.text && (
                    <p className={m.title ? "lp-mp-text" : "lp-mp-title lp-mp-title-plain"}>
                      <Marked text={m.text} query={copy.query} />
                    </p>
                  )}
                  {m.file && (
                    <p className="lp-mp-file">
                      <span className="lp-mp-thumb" aria-hidden="true">
                        <ImageIcon size={14} />
                      </span>
                      {m.file}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="lp-mp-find" ref={ref}>
          <p className="lp-mp-field">
            <Search size={16} aria-hidden="true" />
            <span className="lp-mp-query">
              {typed === 0 && stage !== "found" ? (
                <span className="lp-mp-placeholder">{copy.placeholder}</span>
              ) : (
                copy.query.slice(0, typed)
              )}
            </span>
            <span className="lp-mp-hits">{copy.hits}</span>
          </p>
          <ul>
            {hits.map((m, i) => (
              <li key={m.id} style={{ ["--i" as string]: i }}>
                <span className="lp-mp-hit-icon" data-tone={m.tone} aria-hidden="true">
                  <m.icon size={14} />
                </span>
                <div>
                  {m.title && (
                    <p className="lp-mp-hit">
                      <Marked text={m.title} query={copy.query} />
                    </p>
                  )}
                  {m.text && (
                    <p className={m.title ? "lp-mp-hit-detail" : "lp-mp-hit"}>
                      <Marked text={m.text} query={copy.query} />
                    </p>
                  )}
                  <p className="lp-mp-hit-meta">
                    <span>{m.time}</span>
                    <span>{m.where}</span>
                    <span>{copy.who[m.who]}</span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <p className="lp-mp-foot">{copy.foot}</p>
        </div>
      </div>
      <figcaption className="lp-moments-note">{copy.note}</figcaption>
    </figure>
  );
}
