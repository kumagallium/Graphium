// ブラウザ版では AI との会話を取り込めないことを伝える 1 行。
// 会話の記録は PC 上のファイルにあり、ブラウザからは読めないため。

import { useT } from "@/i18n";

type ConversationUnavailableNoteProps = {
  /** 理由も続けて出す（理由つきの文は、使える場所の文と 1 つの文言にしてある。言語ごとに句読点が違うため） */
  withReason?: boolean;
};

export function ConversationUnavailableNote({ withReason = false }: ConversationUnavailableNoteProps) {
  const t = useT();
  // 既存でこの用途のアイコンは使っていないので、アイコン無しの文だけにする
  return (
    <p className="text-sm text-muted-foreground">
      {t(withReason ? "intake.conversation.unavailableReason" : "intake.conversation.unavailable")}
    </p>
  );
}
