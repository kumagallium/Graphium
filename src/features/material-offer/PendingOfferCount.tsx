// サイドバーの「取り込み」に添える、受け取り待ちの件数。
// モバイル受信箱の件数と同じ数字だけの表記（バッジの丸は使わない）に、主の色を付けて
// 「待っているものがある」ことを示す。0 件なら何も出さない。

import { useT } from "@/i18n";

export function PendingOfferCount({ count }: { count: number }) {
  const t = useT();
  if (count <= 0) return null;
  return (
    <span
      className="text-xs tabular-nums text-primary font-medium"
      aria-label={t("materialOffer.pendingCount", { count: String(count) })}
      data-testid="material-offer-pending-count"
    >
      {count}
    </span>
  );
}
