// 拡大縮小の現在値を購読するフック。デスクトップ以外は level が null のまま。

import { useEffect, useState } from "react";
import { getUiZoom, onUiZoomChanged } from "../../lib/ui-zoom";

export type UiZoomState = {
  level: number | null;
  levels: number[];
};

export function useUiZoom(): UiZoomState {
  const [state, setState] = useState<UiZoomState>({ level: null, levels: [] });

  useEffect(() => {
    let alive = true;
    void getUiZoom().then((info) => {
      if (alive && info) setState({ level: info.level, levels: info.levels });
    });
    // キー・メニュー・ホイールで変えた値にも追従する
    const off = onUiZoomChanged(({ level }) => {
      setState((prev) => ({ ...prev, level }));
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  return state;
}
