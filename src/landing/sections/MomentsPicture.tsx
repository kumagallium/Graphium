// LP のコンセプトの絵（ヒーローの中、ボタンの下）。
// 眠っている記録（開かないと中身が分からない形）→ Graphium に入れると文字になって 1 か所に並ぶ
// → 人が言葉で探せ、AI も同じ記録を読んで出どころつきで答える、を 1 枚で伝える。
//
// 絵に出すのは、公開済みのアプリで実際に起きることだけにする。描く前にコードで確かめたこと（v0.140.0）:
// - 写真の文字は端末の中で読む（Tesseract.js。手書きを読める根拠は無いので、印刷された紙にする）
// - 録音の文字起こしは端末の中の whisper（デスクトップ版）。文字起こしは全文の索引に入る
// - PDF は文字の層を読む（スキャンしただけの PDF は読めない）。Web クリップは抜粋が残る
// - 記録の画面は、素材の中の文字でも当たり、当たった箇所を名前の下に出す
// - AI の答えには出どころの一覧が付き、押すと開ける
// 札の言葉はアプリの文言（src/i18n の records.origin.*）と同じにする。実装が変わったら、ここも合わせる。
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AudioLines,
  ChevronRight,
  FileDown,
  FileText,
  Globe,
  Image as ImageIcon,
  Search,
  Smartphone,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { type en, useI18n } from "../i18n";

type Key = Extract<keyof typeof en, `moments.${string}`>;
// 札の色。アプリの記録の画面（record-dashboard.css の data-tone）と同じ割り当て
type Tone = "amber" | "forest" | "plain";
type RowId = "photo" | "audio" | "web" | "pdf";

type Row = {
  id: RowId;
  time: string;
  // 眠っているときの形を表す印
  beforeIcon: LucideIcon;
  // 出どころの札の印と色
  icon: LucideIcon;
  tone: Tone;
};

const ROWS: Row[] = [
  { id: "photo", time: "09:05", beforeIcon: ImageIcon, icon: Smartphone, tone: "forest" },
  { id: "audio", time: "10:12", beforeIcon: AudioLines, icon: FileDown, tone: "plain" },
  { id: "web", time: "13:40", beforeIcon: Globe, icon: Globe, tone: "amber" },
  { id: "pdf", time: "16:05", beforeIcon: FileText, icon: FileDown, tone: "plain" },
];

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

// 段と段のあいだの矢印
function Flow() {
  return (
    <span className="lp-mp3-flow" aria-hidden="true">
      <ChevronRight size={18} />
    </span>
  );
}

export function MomentsPicture() {
  const { t, locale } = useI18n();
  const k = (key: Key) => t(key);
  const query = k("moments.query");
  const { ref, stage, typed } = usePlayOnce(query);

  return (
    <figure className="lp-moments" lang={locale}>
      <div className="lp-mp3" data-stage={stage}>
        {/* 1 段目: 眠っている記録。形がばらばらで、開かないと中身が分からない */}
        <section className="lp-mp3-col lp-mp3-before">
          <h3 className="lp-mp3-h">{k("moments.before.heading")}</h3>
          <ul>
            {ROWS.map((r) => (
              <li key={r.id} data-kind={r.id}>
                <span className="lp-mp3-thumb" aria-hidden="true">
                  <r.beforeIcon size={16} />
                </span>
                <span className="lp-mp3-before-name">{k(`moments.${r.id}.before` as Key)}</span>
                <span className="lp-mp3-blur" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              </li>
            ))}
          </ul>
          <p className="lp-mp3-foot">{k("moments.before.foot")}</p>
        </section>

        <Flow />

        {/* 2 段目: Graphium に入れると、文字になって 1 か所に並ぶ（記録の画面） */}
        <section className="lp-mp3-col lp-mp3-in">
          <h3 className="lp-mp3-h">{k("moments.in.heading")}</h3>
          <div className="lp-mp3-card">
            <p className="lp-mp3-card-head">
              <span>{k("moments.heading")}</span>
              <span className="lp-mp3-count">{k("moments.count")}</span>
            </p>
            <ol>
              {ROWS.map((r) => (
                <li key={r.id}>
                  <time>{r.time}</time>
                  <div className="lp-mp3-entry">
                    <span className="lp-mp3-mark" aria-hidden="true" />
                    <p className="lp-mp3-meta">
                      <span className="lp-mp3-where" data-tone={r.tone}>
                        <r.icon size={12} aria-hidden="true" />
                        {k(`moments.${r.id}.where` as Key)}
                      </span>
                      <span className="lp-mp3-who">{k("moments.who.self")}</span>
                    </p>
                    <p className="lp-mp3-name">{k(`moments.${r.id}.name` as Key)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <p className="lp-mp3-foot">{k("moments.in.foot")}</p>
        </section>

        <Flow />

        {/* 3 段目: 人が言葉で探せる。AI を使い始めたら、同じ記録を AI も読む */}
        <section className="lp-mp3-col lp-mp3-out">
          <h3 className="lp-mp3-h">{k("moments.out.heading")}</h3>
          <div className="lp-mp3-card lp-mp3-person" ref={ref}>
            <p className="lp-mp3-reader">{k("moments.person.label")}</p>
            <p className="lp-mp3-field">
              <Search size={15} aria-hidden="true" />
              <span className="lp-mp3-query">
                {typed === 0 && stage !== "found" ? (
                  <span className="lp-mp3-placeholder">{k("moments.placeholder")}</span>
                ) : (
                  query.slice(0, typed)
                )}
              </span>
              <span className="lp-mp3-hits">{k("moments.hits")}</span>
            </p>
            <ul>
              {ROWS.map((r, i) => (
                <li key={r.id} style={{ ["--i" as string]: i }}>
                  <span className="lp-mp3-hit-icon" data-tone={r.tone} aria-hidden="true">
                    <r.icon size={12} />
                  </span>
                  <p className="lp-mp3-hit">
                    <Marked text={k(`moments.${r.id}.hit` as Key)} query={query} />
                  </p>
                </li>
              ))}
            </ul>
          </div>
          <div className="lp-mp3-card lp-mp3-ai">
            <p className="lp-mp3-reader">
              <Sparkles size={13} aria-hidden="true" />
              {k("moments.ai.label")}
            </p>
            <p className="lp-mp3-q">{k("moments.ai.q")}</p>
            <p className="lp-mp3-a">{k("moments.ai.a")}</p>
            <p className="lp-mp3-sources">
              <span>{k("moments.ai.sources")}</span>
              <span className="lp-mp3-source">{k("moments.audio.name")}</span>
              <span className="lp-mp3-source">{k("moments.pdf.name")}</span>
            </p>
          </div>
        </section>
      </div>
      <figcaption className="lp-moments-note">{k("moments.note")}</figcaption>
    </figure>
  );
}
