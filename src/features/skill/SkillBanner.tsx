// Skill バナー（エディタヘッダーに表示）
// Wiki の WikiBanner と同等の役割

import { Wrench, Zap } from "lucide-react";

type Props = {
  availableForIngest: boolean;
};

export function SkillBanner({ availableForIngest }: Props) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 text-xs">
      <Wrench size={12} className="text-amber-600 dark:text-amber-400" />
      <span className="text-amber-700 dark:text-amber-300 font-medium">Skill</span>
      {availableForIngest && (
        <span className="flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
          <Zap size={10} />
          <span>Ingest 自動適用</span>
        </span>
      )}
    </div>
  );
}
