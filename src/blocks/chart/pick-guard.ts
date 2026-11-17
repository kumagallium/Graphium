// 素材ピッカー確定の「待った後」の確認
//
// 確定後の表の変換は非同期（大きな素材は小分けで変換する）なので、待つ間に
// ブロックが消えることがある。確定は順番に処理して捨てない（別の確定が入っても
// 先の確定は書く）ので、書く直前に確かめるのは「ブロックがまだあるか」だけ。

/** 待った後も、この確定の結果を設定へ書いてよいか */
export function shouldApplyAssetPick(args: {
  /** このチャートのブロックがまだ文書にあるか */
  blockExists: boolean;
}): boolean {
  return args.blockExists;
}

/**
 * 確定を順番に処理する列。前の確定が終わる（失敗でもよい）まで次を始めない。
 * 失敗は onError に渡して握りつぶす（1 件の失敗で列を止めない・未処理の reject にしない）。
 * onError 自体が throw しても同じ
 */
export function createPickQueue(onError: (err: unknown) => void = () => {}) {
  let tail: Promise<void> = Promise.resolve();
  return {
    enqueue(job: () => Promise<void>): Promise<void> {
      const run = tail.then(job).catch((err) => {
        // onError が throw しても列を止めない（後続の確定は走る）
        try {
          onError(err);
        } catch {
          /* 通知側の失敗は握りつぶす */
        }
      });
      tail = run;
      return run;
    },
  };
}
