// LP のコンセプトの絵（検討中の案）。
// 「知見やアイデアが飛び出る場面のそばで残し、眠らせない」を 1 枚で伝える。
// まだ LandingPage には組み込んでいない。Storybook で案を見比べるための部品で、
// 文言は i18n.ts に入れず、ここに仮置きしている（案が決まったら i18n.ts へ移す）。
import { Globe, MessagesSquare, Mic, Search, Smartphone, type LucideIcon } from "lucide-react";

export type MomentsVariant = "found" | "scenes" | "day" | "contrast";
export type MomentsLocale = "ja" | "en";

type Moment = {
  icon: LucideIcon;
  // 場面（その人がいる場所）
  scene: string;
  // そこで飛び出たひとこと
  spark: string;
  // 残り方（Graphium に入るときの形）
  kept: string;
  // そのままだとどうなるか
  lost: string;
  time: string;
  // どこで残したか（記録の出どころ）
  where: string;
  // 誰が残したか
  who: string;
};

type Copy = {
  moments: Moment[];
  scenesShelf: string;
  scenesShelfNote: string;
  dayHeading: string;
  dayFoot: string;
  contrastBefore: string;
  contrastAfter: string;
  contrastQuery: string;
  foundLegend: [string, string, string, string];
  foundCount: string;
  foundFoot: string;
  note: string;
};

const COPY: Record<MomentsLocale, Copy> = {
  ja: {
    moments: [
      {
        icon: Mic,
        scene: "会議中",
        spark: "次は先に温度を下げてみよう",
        kept: "録音が文字になる",
        lost: "会議のあと、誰も覚えていない",
        time: "10:12",
        where: "会議の録音",
        who: "自分",
      },
      {
        icon: Globe,
        scene: "ブラウザで読んでいるとき",
        spark: "温度を下げると割れにくい、という報告",
        kept: "読んだページを残す",
        lost: "タブを閉じて、どのページか分からない",
        time: "13:40",
        where: "Web のページ",
        who: "自分",
      },
      {
        icon: MessagesSquare,
        scene: "AI と話しているとき",
        spark: "温度はそのままで、冷ます時間を倍にする手があります",
        kept: "話したことを残す",
        lost: "会話が流れて、探し出せない",
        time: "16:05",
        where: "AI との対話",
        who: "自分と Claude",
      },
      {
        icon: Smartphone,
        scene: "出先で思いついたとき",
        spark: "型を変えれば温度はそのままでいいかも",
        kept: "スマホの写真や声を送る",
        lost: "カメラロールに埋もれる",
        time: "21:30",
        where: "スマホのメモ",
        who: "自分",
      },
    ],
    scenesShelf: "同じ場所に残る",
    scenesShelfNote: "文字になっているので、あとで言葉で探せます",
    dayHeading: "今日の記録",
    dayFoot: "場面は違っても、入る場所は 1 つです",
    contrastBefore: "そのままだと",
    contrastAfter: "Graphium に入れると",
    contrastQuery: "温度",
    foundLegend: ["いつ", "どこで", "誰が", "何を"],
    foundCount: "4 件",
    foundFoot: "残した場面が違っても、同じ言葉で見つかります",
    note: "Web のクリップ、録音の文字起こし、スマホからの受け取りは、デスクトップ版で動きます。",
  },
  en: {
    moments: [
      {
        icon: Mic,
        scene: "In a meeting",
        spark: "Next time, let's lower the temperature first",
        kept: "The recording becomes text",
        lost: "After the meeting, nobody remembers",
        time: "10:12",
        where: "Meeting recording",
        who: "Me",
      },
      {
        icon: Globe,
        scene: "Reading in the browser",
        spark: "A report that a lower temperature prevents cracks",
        kept: "The page is kept",
        lost: "The tab is closed, the page is gone",
        time: "13:40",
        where: "Web page",
        who: "Me",
      },
      {
        icon: MessagesSquare,
        scene: "Talking with an AI",
        spark: "Keep the temperature and double the cooling time",
        kept: "The conversation is kept",
        lost: "The chat scrolls away",
        time: "16:05",
        where: "AI conversation",
        who: "Me and Claude",
      },
      {
        icon: Smartphone,
        scene: "An idea on the go",
        spark: "A different mold might work at the same temperature",
        kept: "Send a photo or a voice memo",
        lost: "Buried in the camera roll",
        time: "21:30",
        where: "Memo from phone",
        who: "Me",
      },
    ],
    scenesShelf: "Kept in one place",
    scenesShelfNote: "It is all text, so you can find it later by words",
    dayHeading: "Today's records",
    dayFoot: "Different moments, one place",
    contrastBefore: "Left as it is",
    contrastAfter: "In Graphium",
    contrastQuery: "temperature",
    foundLegend: ["When", "Where", "Who", "What"],
    foundCount: "4 results",
    foundFoot: "Different moments, found by the same word",
    note: "Web clips, transcription, and receiving from your phone run in the desktop app.",
  },
};

// 検索語にあたる部分だけを目立たせる（案 3 で使う）
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

// 組み合わせ案: 左に今日の記録（いつ・どこで・誰が・何を）、右に同じ記録が言葉で見つかる様子。
// 右のカードを左に少し重ねて、「残したものが、そのまま探せる」を 1 つの流れに見せる
function Found({ copy }: { copy: Copy }) {
  const [when, where, who, what] = copy.foundLegend;
  return (
    <div className="lp-mp">
      <div className="lp-mp-log">
        <p className="lp-mp-log-head">
          <span>{copy.dayHeading}</span>
          <span className="lp-mp-count">{copy.foundCount}</span>
        </p>
        <p className="lp-mp-legend" aria-hidden="true">
          <span>{when}</span>
          <span>
            {where} · {who} · {what}
          </span>
        </p>
        <ol>
          {copy.moments.map((m) => (
            <li key={m.scene}>
              <time>{m.time}</time>
              <div className="lp-mp-entry">
                <p className="lp-mp-meta">
                  <span className="lp-mp-where">
                    <m.icon size={13} aria-hidden="true" />
                    {m.where}
                  </span>
                  <span className="lp-mp-who">{m.who}</span>
                </p>
                <p className="lp-mp-what">
                  <Marked text={m.spark} query={copy.contrastQuery} />
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <div className="lp-mp-find">
        <p className="lp-mp-field">
          <Search size={16} aria-hidden="true" />
          <span className="lp-mp-query">{copy.contrastQuery}</span>
          <span className="lp-mp-count">{copy.foundCount}</span>
        </p>
        <ul>
          {copy.moments.map((m) => (
            <li key={m.scene}>
              <p className="lp-mp-hit">
                <Marked text={m.spark} query={copy.contrastQuery} />
              </p>
              <p className="lp-mp-hit-meta">
                <m.icon size={12} aria-hidden="true" />
                {m.time} · {m.where}
              </p>
            </li>
          ))}
        </ul>
        <p className="lp-mp-foot">{copy.foundFoot}</p>
      </div>
    </div>
  );
}

// 案 1: 場面のカードが並び、下の 1 つの棚に同じひとことが残る
function Scenes({ copy }: { copy: Copy }) {
  const moments = copy.moments.slice(0, 3);
  return (
    <>
      <div className="lp-moments-scenes">
        {moments.map((m) => (
          <div key={m.scene} className="lp-moments-scene">
            <p className="lp-moments-scene-label">
              <m.icon size={16} aria-hidden="true" />
              {m.scene}
            </p>
            <span className="lp-moments-line" style={{ width: "72%" }} />
            <span className="lp-moments-line" style={{ width: "88%" }} />
            <p className="lp-moments-spark">{m.spark}</p>
            <span className="lp-moments-line" style={{ width: "60%" }} />
          </div>
        ))}
      </div>
      <div className="lp-moments-flow" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="lp-moments-shelf">
        <p className="lp-moments-shelf-title">
          <span className="lp-moments-brand">Graphium</span>
          {copy.scenesShelf}
        </p>
        <ul>
          {moments.map((m) => (
            <li key={m.scene}>
              <m.icon size={14} aria-hidden="true" />
              <span>{m.spark}</span>
            </li>
          ))}
        </ul>
        <p className="lp-moments-shelf-note">
          <Search size={14} aria-hidden="true" />
          {copy.scenesShelfNote}
        </p>
      </div>
    </>
  );
}

// 案 2: 1 日の記録が、時刻順に 1 本に並ぶ
function Day({ copy }: { copy: Copy }) {
  return (
    <div className="lp-moments-day">
      <p className="lp-moments-shelf-title">
        <span className="lp-moments-brand">Graphium</span>
        {copy.dayHeading}
      </p>
      <ol>
        {copy.moments.map((m) => (
          <li key={m.scene}>
            <span className="lp-moments-time">{m.time}</span>
            <span className="lp-moments-dot" aria-hidden="true">
              <m.icon size={14} />
            </span>
            <div>
              <p className="lp-moments-day-scene">
                {m.scene}
                <span>{m.kept}</span>
              </p>
              <p className="lp-moments-spark">{m.spark}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="lp-moments-shelf-note">{copy.dayFoot}</p>
    </div>
  );
}

// 案 3: そのままだと散らばって薄れる／入れると 1 か所で探せる
function Contrast({ copy }: { copy: Copy }) {
  return (
    <div className="lp-moments-contrast">
      <div className="lp-moments-before">
        <p className="lp-moments-side-title">{copy.contrastBefore}</p>
        <ul>
          {copy.moments.map((m) => (
            <li key={m.scene}>
              <m.icon size={14} aria-hidden="true" />
              <span>{m.lost}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="lp-moments-after">
        <p className="lp-moments-side-title">{copy.contrastAfter}</p>
        <p className="lp-moments-search">
          <Search size={14} aria-hidden="true" />
          {copy.contrastQuery}
        </p>
        <ul>
          {copy.moments.map((m) => (
            <li key={m.scene}>
              <m.icon size={14} aria-hidden="true" />
              <span>
                <Marked text={m.spark} query={copy.contrastQuery} />
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function MomentsPicture({
  variant,
  locale = "ja",
}: {
  variant: MomentsVariant;
  locale?: MomentsLocale;
}) {
  const copy = COPY[locale];
  return (
    <figure className="lp-moments" lang={locale}>
      {variant === "found" && <Found copy={copy} />}
      {variant === "scenes" && <Scenes copy={copy} />}
      {variant === "day" && <Day copy={copy} />}
      {variant === "contrast" && <Contrast copy={copy} />}
      <figcaption className="lp-moments-note">{copy.note}</figcaption>
    </figure>
  );
}
