// LP のコンセプトの絵。
// 「場面が違っても同じ場所に残り、あとから同じ言葉で見つかる」を 1 枚で伝える。
// 左はアプリの「記録」の画面を小さく写したもの（札の色・残した人の印はアプリと同じ決まり）、
// 右は同じ記録が言葉で見つかる様子。画面に入ると、言葉が打たれて結果が順に現れる。
// まだ LandingPage には組み込んでいない。文言はここに仮置きしている（決まったら i18n.ts へ移す）。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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

export type MomentsLocale = "ja" | "en";

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
  // 何を（本文や抜粋）。写真は持たない
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

const COPY: Record<MomentsLocale, Copy> = {
  ja: {
    moments: [
      {
        id: "meeting",
        time: "10:12",
        icon: Mic,
        tone: "rose",
        where: "会議の録音",
        who: "self",
        title: "パン教室の打ち合わせ",
        text: "次は、発酵の温度を先に下げてみよう",
      },
      {
        id: "photo",
        time: "11:30",
        icon: Smartphone,
        tone: "forest",
        where: "スマホから",
        who: "self",
        file: "焼き上がりの写真.jpg",
      },
      {
        id: "web",
        time: "13:40",
        icon: Globe,
        tone: "amber",
        where: "Web クリップ",
        who: "self",
        title: "低温で長く発酵させると、風味が変わる理由",
        text: "温度を下げると、発酵はゆっくり進みます",
      },
      {
        id: "ai",
        time: "16:05",
        icon: MessagesSquare,
        tone: "sky",
        where: "AI との対話",
        who: "selfWithAi",
        title: "発酵時間の見直し案",
        text: "温度はそのままで、時間を倍にする手があります",
      },
      {
        id: "memo",
        time: "21:30",
        icon: StickyNote,
        tone: "plain",
        where: "メモ",
        who: "self",
        text: "型を変えれば、焼く温度はそのままでいいかも",
      },
    ],
    heading: "今日の記録",
    date: "11月17日 火曜日",
    count: "5 件",
    legend: ["いつ", "どこで", "誰が", "何を"],
    who: { self: "自分", selfWithAi: "自分と AI" },
    query: "温度",
    placeholder: "言葉で探す",
    hits: "4 件",
    foot: "残した場面が違っても、同じ言葉で見つかります",
    note: "Web のクリップ、録音の文字起こし、スマホからの受け取りは、デスクトップ版で動きます。",
  },
  en: {
    moments: [
      {
        id: "meeting",
        time: "10:12",
        icon: Mic,
        tone: "rose",
        where: "Meeting recording",
        who: "self",
        title: "Bread class planning",
        text: "Next time, let's lower the proofing temperature first",
      },
      {
        id: "photo",
        time: "11:30",
        icon: Smartphone,
        tone: "forest",
        where: "From phone",
        who: "self",
        file: "fresh-from-the-oven.jpg",
      },
      {
        id: "web",
        time: "13:40",
        icon: Globe,
        tone: "amber",
        where: "Web clip",
        who: "self",
        title: "Why a long, cool proof changes the flavor",
        text: "At a lower temperature, the dough rises slowly",
      },
      {
        id: "ai",
        time: "16:05",
        icon: MessagesSquare,
        tone: "sky",
        where: "AI conversation",
        who: "selfWithAi",
        title: "A new proofing schedule",
        text: "Keep the temperature and double the time",
      },
      {
        id: "memo",
        time: "21:30",
        icon: StickyNote,
        tone: "plain",
        where: "Memo",
        who: "self",
        text: "A different tin might work at the same temperature",
      },
    ],
    heading: "Today's records",
    date: "Tuesday, November 17",
    count: "5 records",
    legend: ["When", "Where", "Who", "What"],
    who: { self: "Me", selfWithAi: "Me and AI" },
    query: "temperature",
    placeholder: "Find by words",
    hits: "4 found",
    foot: "Different moments, found by the same word",
    note: "Web clips, transcription, and receiving from your phone run in the desktop app.",
  },
};

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

export function MomentsPicture({ locale = "ja" }: { locale?: MomentsLocale }) {
  const copy = COPY[locale];
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
                  {m.title && <p className="lp-mp-title">{m.title}</p>}
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
                  <p className="lp-mp-hit">
                    <Marked text={m.text ?? ""} query={copy.query} />
                  </p>
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
