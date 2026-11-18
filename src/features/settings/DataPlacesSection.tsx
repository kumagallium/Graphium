// 設定 → ストレージ の「データの置き場」一覧（デスクトップ版だけ）。
//
// 置き場 = 組織の同期フォルダなど、中のファイルを「写さず・中身も読まず」にリンクできるフォルダ。
// 行の並び・⋯ メニュー・詳細の開閉・文字の大きさは SharedFoldersSection に合わせる。
//
// 置き場の絶対パスは Rust 側が持つ。ここで扱うのは Rust が返す一覧（名前・場所・届いているか）だけ。
// 登録を外しても、リンクした素材も元のファイルも消えない（確認の文にそう書く）。
// 外す確認は window.confirm ではなくアプリ内の確認（デスクトップ版では window.confirm が素通りするため）。

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronDown, ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@ui/button";
import { Input } from "@ui/form-field";
import { IconButton } from "@ui/icon-button";
import { Dropdown, type DropdownPosition } from "@ui/dropdown";
import { MenuItem } from "@ui/menu-item";
import { useLocale } from "../../i18n";
import { confirmAction } from "../../ui/confirm-dialog";
import {
  listPlaces,
  persistPlaceName,
  registerPlace,
  removePlace,
  renamePlace,
  type PlaceInfo,
} from "../linked-files";
import { SETTINGS_CARD_CLASS, SETTINGS_INNER_CARD_CLASS } from "./SettingsGroup";

export type DataPlacesSectionProps = {
  /** 一覧が変わったとき */
  onChange?: (places: PlaceInfo[]) => void;
  /**
   * Storybook / テスト用の差し替え口（本番では未指定）。
   * 置き場の操作は Tauri に依存するので、ここで置き換える。
   */
  __test?: {
    listPlaces?: () => Promise<PlaceInfo[]>;
    registerPlace?: () => Promise<PlaceInfo | null>;
    renamePlace?: (id: string, name: string) => Promise<PlaceInfo>;
    persistPlaceName?: (placeId: string, placeName: string) => Promise<number>;
    removePlace?: (id: string) => Promise<void>;
  };
};

export function DataPlacesSection({ onChange, __test }: DataPlacesSectionProps) {
  const { t } = useLocale();
  const [places, setPlaces] = useState<PlaceInfo[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  /** 名前を入れている最中の行 */
  const [namingId, setNamingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const list = __test?.listPlaces ?? listPlaces;
  const register = __test?.registerPlace ?? registerPlace;
  const rename = __test?.renamePlace ?? renamePlace;
  const syncName = __test?.persistPlaceName ?? persistPlaceName;
  const remove = __test?.removePlace ?? removePlace;

  const reload = useCallback(async () => {
    try {
      const next = await list();
      setPlaces(next);
      onChange?.(next);
    } catch (e) {
      setMessage(t("places.registerFailed", { message: e instanceof Error ? e.message : String(e) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, onChange]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleAdd = useCallback(async () => {
    setMessage(null);
    try {
      const added = await register();
      // キャンセルなら何もしない
      if (!added) return;
      await reload();
      setNamingId(added.id);
    } catch (e) {
      setMessage(t("places.registerFailed", { message: e instanceof Error ? e.message : String(e) }));
    }
  }, [register, reload, t]);

  const handleRename = useCallback(
    async (place: PlaceInfo, name: string) => {
      setNamingId(null);
      if (!name || name === place.name) return;
      try {
        await rename(place.id, name);
        // 一覧に出る置き場の名前（素材の urlMeta.domain）も新しい名前に合わせる。失敗しても改名は成功のまま
        try {
          await syncName(place.id, name);
        } catch {
          // 素材側の名前が古いままでも、リンクは置き場の id で引くので動作には影響しない
        }
        await reload();
      } catch (e) {
        setMessage(t("linkedFile.actionFailed", { message: e instanceof Error ? e.message : String(e) }));
      }
    },
    [rename, syncName, reload, t],
  );

  const handleRemove = useCallback(
    async (place: PlaceInfo) => {
      const ok = await confirmAction(t("places.removeConfirm", { name: place.name }), {
        destructive: true,
        confirmLabel: t("places.removeAction"),
      });
      if (!ok) return;
      try {
        await remove(place.id);
        setOpenId((cur) => (cur === place.id ? null : cur));
        await reload();
      } catch (e) {
        setMessage(t("linkedFile.actionFailed", { message: e instanceof Error ? e.message : String(e) }));
      }
    },
    [remove, reload, t],
  );

  return (
    <div className="space-y-1.5">
      {places.length === 0 ? (
        <div className={`${SETTINGS_CARD_CLASS} px-3 py-3 text-xs text-muted-foreground`}>{t("places.empty")}</div>
      ) : (
        places.map((place) => (
          <PlaceRow
            key={place.id}
            place={place}
            open={openId === place.id}
            naming={namingId === place.id}
            onToggle={() => setOpenId((cur) => (cur === place.id ? null : place.id))}
            onStartRename={() => setNamingId(place.id)}
            onRename={(name) => void handleRename(place, name)}
            onRemove={() => void handleRemove(place)}
          />
        ))
      )}
      <div className="flex items-center gap-2 flex-wrap pt-1">
        <Button size="sm" variant="ghost" onClick={() => void handleAdd()}>
          <Plus size={12} />
          {t("places.add")}
        </Button>
        {message && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <AlertCircle size={12} /> {message}
          </span>
        )}
      </div>
    </div>
  );
}

type RowProps = {
  place: PlaceInfo;
  open: boolean;
  naming: boolean;
  onToggle: () => void;
  onStartRename: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
};

function PlaceRow({ place, open, naming, onToggle, onStartRename, onRename, onRemove }: RowProps) {
  const { t } = useLocale();
  const [menuPos, setMenuPos] = useState<DropdownPosition | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  const openMenu = () => {
    const rect = menuBtnRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenuPos({ top: rect.bottom + 4, left: rect.right - 200, anchorRect: rect });
  };

  const reachText = place.reachable ? t("places.status.ok") : t("places.status.unreachable");

  return (
    <div className={`${SETTINGS_CARD_CLASS} px-2 py-1.5`} data-testid="data-place-card" aria-label={place.name}>
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? t("places.collapse") : t("places.expand")}
          className="flex items-center gap-2 min-w-0 flex-1 text-left rounded px-1 py-1 hover:bg-muted"
        >
          {open ? (
            <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight size={12} className="shrink-0 text-muted-foreground" />
          )}
          {/* 状態の印。色だけに頼らないよう、ツールチップと読み上げ用の文言を付ける */}
          <span className="relative inline-flex shrink-0" data-tooltip={reachText}>
            <span className={`w-2 h-2 rounded-full ${place.reachable ? "bg-green-600" : "bg-amber-500"}`} />
            <span className="sr-only">{reachText}</span>
          </span>
          {naming ? null : (
            <span className="text-sm font-medium text-foreground shrink-0 max-w-[40%] truncate">{place.name}</span>
          )}
          {!naming && (
            <span className="text-[11px] font-mono text-muted-foreground truncate min-w-0" title={place.root}>
              {place.root}
            </span>
          )}
        </button>
        {naming && (
          <NameInput
            initial={place.name}
            onDone={onRename}
            placeholder={t("places.namePlaceholder")}
            ariaLabel={t("places.nameLabel")}
          />
        )}
        <IconButton
          ref={menuBtnRef}
          size="sm"
          aria-label={t("places.menu", { name: place.name })}
          onClick={openMenu}
        >
          <MoreHorizontal />
        </IconButton>
      </div>

      {/* この端末だけの置き場（目印のファイルを置けなかった）。行の下に常に出す */}
      {!place.shared && (
        <p className="text-[11px] text-muted-foreground ml-5 mt-0.5 px-1">{t("places.localOnly")}</p>
      )}

      {menuPos && (
        <Dropdown position={menuPos} onClose={() => setMenuPos(null)} minWidth={200}>
          <MenuItem
            onClick={() => {
              setMenuPos(null);
              onStartRename();
            }}
          >
            {t("places.rename")}
          </MenuItem>
          <MenuItem
            className="text-red-600"
            onClick={() => {
              setMenuPos(null);
              onRemove();
            }}
          >
            {t("places.remove")}
          </MenuItem>
        </Dropdown>
      )}

      {open && (
        <div className={`${SETTINGS_INNER_CARD_CLASS} mt-1.5 ml-5 px-3 py-2 space-y-2.5`}>
          {!place.reachable && (
            <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1">
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              <span>{t("places.unreachableHint")}</span>
            </p>
          )}
          <div className="space-y-0.5">
            <div className="text-[11px] text-muted-foreground">{t("places.rootLabel")}</div>
            <span className="text-xs font-mono text-foreground break-all">{place.root}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** 名前の入力（追加直後・名前を変えるとき）。Enter と外側で確定、Esc で元の名前のまま閉じる */
function NameInput({
  initial,
  onDone,
  placeholder,
  ariaLabel,
}: {
  initial: string;
  onDone: (name: string) => void;
  placeholder: string;
  ariaLabel: string;
}) {
  const [value, setValue] = useState(initial);
  const doneRef = useRef(false);
  const finish = (name: string) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone(name.trim());
  };
  return (
    <Input
      type="text"
      autoFocus
      value={value}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(value);
        if (e.key === "Escape") finish(initial);
      }}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className="flex-1 min-w-0 h-7 text-sm"
    />
  );
}
