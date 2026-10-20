// 会議録音の再生: 左右別に録ったチャンネル（左 = 相手、右 = 自分）を、再生のときだけ両耳に混ぜる。
// ファイルは左右別のまま。Web Audio の ChannelSplitter → GainNode(0.5) → ChannelMerger で
// L と R をそれぞれ両方の出力チャンネルへ送る。失敗しても普通の再生に戻る（例外は握る）。

import { useEffect, useRef, type RefObject } from "react";

/** 混ぜるときの各チャンネルの音量（足して 1 を超えないように半分ずつ） */
export const MIXDOWN_GAIN = 0.5;

/** buildMixdownGraph が触る AudioContext の最小面（テストで差し替えやすくする） */
export type MixdownContextLike = {
  destination: unknown;
  createChannelSplitter(channels: number): any;
  createChannelMerger(channels: number): any;
  createGain(): any;
};

/**
 * source → splitter(2) → [gainL, gainR](0.5) → merger(2) の両入力へ → destination をつなぐ。
 * 作ったノードを返す（切断用）。
 */
export function buildMixdownGraph(ctx: MixdownContextLike, source: { connect(n: any): unknown }) {
  const splitter = ctx.createChannelSplitter(2);
  const merger = ctx.createChannelMerger(2);
  const gainL = ctx.createGain();
  const gainR = ctx.createGain();
  gainL.gain.value = MIXDOWN_GAIN;
  gainR.gain.value = MIXDOWN_GAIN;
  source.connect(splitter);
  splitter.connect(gainL, 0);
  splitter.connect(gainR, 1);
  // 各チャンネルを merger の左右どちらの入力にも送る（= 両耳に同じ音）
  gainL.connect(merger, 0, 0);
  gainL.connect(merger, 0, 1);
  gainR.connect(merger, 0, 0);
  gainR.connect(merger, 0, 1);
  merger.connect(ctx.destination as any);
  return { source, splitter, gainL, gainR, merger };
}

type Graph = { ctx: AudioContext; nodes: ReturnType<typeof buildMixdownGraph> };

/**
 * audio 要素の再生を両耳ミックスにする。AudioContext は最初の再生（ユーザー操作）で作って resume し、
 * アンマウントで切断する。createMediaElementSource は 1 要素に 1 回しか呼べないので、要素ごとに覚える。
 * key は audio 要素が作り直されうるときに変える値（src など）。
 */
export function useMixedDownPlayback(
  audioRef: RefObject<HTMLAudioElement | null>,
  enabled: boolean,
  key: unknown,
): void {
  const graphRef = useRef<{ el: HTMLAudioElement; graph: Graph } | null>(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!enabled || !el) return;
    const onPlay = () => {
      try {
        if (graphRef.current?.el === el) {
          void graphRef.current.graph.ctx.resume().catch(() => {});
          return;
        }
        const Ctor: typeof AudioContext | undefined =
          typeof window !== "undefined"
            ? (window.AudioContext ?? (window as any).webkitAudioContext)
            : undefined;
        if (!Ctor) return;
        const ctx = new Ctor();
        const nodes = buildMixdownGraph(ctx, ctx.createMediaElementSource(el));
        graphRef.current = { el, graph: { ctx, nodes } };
        void ctx.resume().catch(() => {});
      } catch (e) {
        // 混ぜられなくても再生そのものは止めない
        console.warn("両耳ミックス再生を使えませんでした:", e);
      }
    };
    el.addEventListener("play", onPlay);
    return () => el.removeEventListener("play", onPlay);
  }, [audioRef, enabled, key]);

  // アンマウントで切断して閉じる
  useEffect(
    () => () => {
      const g = graphRef.current;
      graphRef.current = null;
      if (!g) return;
      try {
        const n = g.graph.nodes;
        (n.source as any).disconnect?.();
        n.splitter.disconnect();
        n.gainL.disconnect();
        n.gainR.disconnect();
        n.merger.disconnect();
        void g.graph.ctx.close().catch(() => {});
      } catch {
        // 切断の失敗は無視
      }
    },
    [],
  );
}
