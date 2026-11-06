// 設定 → 共有 の「共有フォルダ」一覧（§26）。
//
// 1 行 1 フォルダ。行には 状態の印・名前（範囲）・既定の共有先の印・場所（薄く）・中身の件数・⋯ を並べ、
// 行を押すとその場で下に詳しい設定（場所・画像や PDF の置き場・接続の確認）が開く（利用者の選択「A」2026-11-06）。
// 以前の 1 件 = 1 枚の縦長カードは、2 件でモーダルが埋まり、名前が長いパスに埋もれ、
// 操作（変更・接続テスト・外す・既定にする）が散らばっていた。
//
// 誰が読めるかは NAS / OS のフォルダ権限が決めるので、ここでは権限を扱わない。
// 状態の印は「フォルダが見えているか」だけを開いたときに調べる（書き込む接続テストは詳しい設定から）。
// 保存は setSharedFolders で即時（他の共有設定と同じく「保存」ボタンを待たない）。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle, ChevronDown, ChevronRight, Loader2, MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@ui/button";
import { Input } from "@ui/form-field";
import { IconButton } from "@ui/icon-button";
import { Dropdown, type DropdownPosition } from "@ui/dropdown";
import { MenuItem } from "@ui/menu-item";
import { useLocale } from "../../i18n";
import {
  createSharedFolder,
  diagnoseSharedRoot,
  getBlobRoot,
  getSharedFolders,
  isSharedRootReachable,
  pickBlobRoot,
  pickSharedRoot,
  rememberSharedRootRemote,
  setSharedFolders,
  sharedFolderLabel,
  testBlobConnection,
  testSharedConnection,
  type ConnectionTestResult,
  type SharedEntry,
  type SharedFolder,
  type SharedRootDiagnosis,
} from "../../lib/storage/shared";
import { loadAuthorIdentity } from "../identity";
import { notifySharedLibraryChanged, useSharedLibrary } from "../sharing/shared-library-store";
import { SharedRootUnreachable } from "../sharing/SharedRootUnreachable";
import { SETTINGS_CARD_CLASS, SETTINGS_INNER_CARD_CLASS } from "./SettingsGroup";

export type SharedFoldersSectionProps = {
  /** 一覧が変わったとき（親が「共有フォルダがあるか」で他の項目を出し分けるため） */
  onChange?: (folders: SharedFolder[]) => void;
  /**
   * Storybook / テスト用の差し替え口（本番では未指定）。
   * ダイアログ・接続テスト・見えているかの確認は Tauri に依存するので、ここで置き換える。
   */
  __test?: {
    pickFolder?: (current?: string) => Promise<string | null>;
    testShared?: (root: string) => Promise<ConnectionTestResult>;
    testBlob?: (root: string) => Promise<ConnectionTestResult>;
    checkReachable?: (root: string) => Promise<boolean | null>;
    /** 件数の元（省くと共有ストアのスナップショット） */
    entries?: { entries: SharedEntry[]; entryRoots: Record<string, string> };
  };
};

/** 状態の印: 調べ中・見えている・届かない・分からない（ブラウザ版など） */
type Reach = "checking" | "ok" | "unreachable" | "unknown";

/** 件数に出す種類（コメント・提案・報告は数えない — 共有フォルダの画面の主なタブと同じ） */
const COUNT_KINDS: { key: string; labelKey: string; types: SharedEntry["type"][] }[] = [
  { key: "note", labelKey: "library.tab.note", types: ["note"] },
  { key: "knowledge", labelKey: "library.tab.knowledge", types: ["knowledge"] },
  { key: "template", labelKey: "library.tab.template", types: ["template"] },
  { key: "asset", labelKey: "library.tab.asset", types: ["reference", "data-manifest"] },
];

export function SharedFoldersSection({ onChange, __test }: SharedFoldersSectionProps) {
  const { t } = useLocale();
  const [folders, setFoldersState] = useState<SharedFolder[]>(() => getSharedFolders());
  const [openId, setOpenId] = useState<string | null>(null);
  /** 追加した直後で、名前を入れてもらっている行 */
  const [namingId, setNamingId] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [reach, setReach] = useState<Record<string, Reach>>({});

  const shared = useSharedLibrary();
  const source = __test?.entries ?? shared;

  // フォルダごとの件数（共有ストアが読み終えた分。まだなら 0 件のまま出さない）
  const countsByRoot = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    for (const e of source.entries) {
      const root = source.entryRoots[e.id];
      if (!root) continue;
      const kind = COUNT_KINDS.find((k) => k.types.includes(e.type));
      if (!kind) continue;
      out[root] ??= {};
      out[root][kind.key] = (out[root][kind.key] ?? 0) + 1;
    }
    return out;
  }, [source.entries, source.entryRoots]);

  const checkReachable = __test?.checkReachable ?? isSharedRootReachable;

  // 開いたとき・一覧が変わったときに、各フォルダが見えているかを調べる（書き込みはしない）
  const rootsKey = folders.map((f) => f.root).join("\n");
  useEffect(() => {
    let cancelled = false;
    setReach(Object.fromEntries(folders.map((f) => [f.root, "checking" as Reach])));
    for (const f of folders) {
      void checkReachable(f.root).then((ok) => {
        if (cancelled) return;
        setReach((prev) => ({ ...prev, [f.root]: ok === null ? "unknown" : ok ? "ok" : "unreachable" }));
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootsKey]);

  const commit = useCallback(
    (next: SharedFolder[]) => {
      setSharedFolders(next);
      // 保存で正規化された値（重複の除去など）を表示にも使う
      const saved = getSharedFolders();
      setFoldersState(saved);
      onChange?.(saved);
      // 共有フォルダが変われば共有ストアを読み直す（語彙索引も追従して入れ替わる）
      notifySharedLibraryChanged();
    },
    [onChange],
  );

  // 土台は保存済みの最新値（接続先は rememberSharedRootRemote が非同期で書くので、
  // 画面の state を土台にすると古い値で上書きしてしまう）
  const update = useCallback(
    (id: string, patch: Partial<Omit<SharedFolder, "id">>) => {
      commit(getSharedFolders().map((f) => (f.id === id ? { ...f, ...patch } : f)));
    },
    [commit],
  );

  const makeDefault = useCallback(
    (id: string) => {
      const latest = getSharedFolders();
      const target = latest.find((f) => f.id === id);
      if (!target) return;
      commit([target, ...latest.filter((f) => f.id !== id)]);
    },
    [commit],
  );

  const remove = useCallback(
    (id: string) => {
      commit(getSharedFolders().filter((f) => f.id !== id));
      setOpenId((cur) => (cur === id ? null : cur));
    },
    [commit],
  );

  const pickFolder = __test?.pickFolder ?? pickSharedRoot;

  const handleAdd = useCallback(async () => {
    setAddError(null);
    try {
      const picked = await pickFolder();
      if (!picked) return;
      const latest = getSharedFolders();
      if (latest.some((f) => f.root === picked)) {
        setAddError(t("settings.sharedFolders.alreadyAdded"));
        return;
      }
      // 名前の初期値はフォルダ名。そのまま確定してもよいし、範囲の名前（部署 A など）に直してもよい
      const base = createSharedFolder(picked, sharedFolderLabel({ name: "", root: picked }));
      // 1 件目なら、以前に控えてあった置き場を引き継ぐ（共有フォルダを外して選び直した場合）
      const added = latest.length === 0 ? { ...base, blobRoot: getBlobRoot() } : base;
      commit([...latest, added]);
      setNamingId(added.id);
      // 選べた＝今は届いているので、接続先（smb:// 等）を控えておく
      void rememberSharedRootRemote(picked);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : String(e));
    }
  }, [commit, pickFolder, t]);

  return (
    <div className="space-y-1.5">
      {folders.length === 0 ? (
        <div className={`${SETTINGS_CARD_CLASS} px-3 py-3 text-xs text-muted-foreground`}>
          {t("settings.sharedFolders.empty")}
        </div>
      ) : (
        folders.map((folder, i) => (
          <SharedFolderRow
            key={folder.id}
            folder={folder}
            isDefault={i === 0}
            showDefault={folders.length > 1}
            reach={reach[folder.root] ?? "checking"}
            counts={countsByRoot[folder.root]}
            open={openId === folder.id}
            naming={namingId === folder.id}
            onToggle={() => setOpenId((cur) => (cur === folder.id ? null : folder.id))}
            onRename={(name) => {
              setNamingId(null);
              if (name !== folder.name) update(folder.id, { name });
            }}
            onStartRename={() => setNamingId(folder.id)}
            onChangeRoot={(root) => update(folder.id, { root, remote: null })}
            onChangeBlobRoot={(blobRoot) => update(folder.id, { blobRoot })}
            onMakeDefault={() => makeDefault(folder.id)}
            onRemove={() => remove(folder.id)}
            onReachChecked={(ok) =>
              setReach((prev) => ({ ...prev, [folder.root]: ok ? "ok" : "unreachable" }))
            }
            __test={__test}
          />
        ))
      )}
      <div className="flex items-center gap-2 flex-wrap pt-1">
        <Button size="sm" variant="ghost" onClick={() => void handleAdd()}>
          <Plus size={12} />
          {folders.length === 0 ? t("settings.shared.pick") : t("settings.sharedFolders.add")}
        </Button>
        {addError && (
          <span className="text-xs text-red-500 flex items-center gap-1">
            <AlertCircle size={12} /> {addError}
          </span>
        )}
      </div>
      {folders.length > 0 && (
        <p className="text-[11px] text-muted-foreground">{t("settings.sharedFolders.permissionNote")}</p>
      )}
    </div>
  );
}

type RowProps = {
  folder: SharedFolder;
  isDefault: boolean;
  /** 2 件以上のときだけ「既定の共有先」の印と切り替えを出す（1 件なら選ぶものが無い） */
  showDefault: boolean;
  reach: Reach;
  counts?: Record<string, number>;
  open: boolean;
  /** 名前を入れている最中（追加直後・メニューの「名前を変える」） */
  naming: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onStartRename: () => void;
  onChangeRoot: (root: string) => void;
  onChangeBlobRoot: (blobRoot: string | null) => void;
  onMakeDefault: () => void;
  onRemove: () => void;
  onReachChecked: (ok: boolean) => void;
  __test?: SharedFoldersSectionProps["__test"];
};

function SharedFolderRow({
  folder,
  isDefault,
  showDefault,
  reach,
  counts,
  open,
  naming,
  onToggle,
  onRename,
  onStartRename,
  onChangeRoot,
  onChangeBlobRoot,
  onMakeDefault,
  onRemove,
  onReachChecked,
  __test,
}: RowProps) {
  const { t } = useLocale();
  const label = sharedFolderLabel(folder);
  const [menuPos, setMenuPos] = useState<DropdownPosition | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [diagnosis, setDiagnosis] = useState<SharedRootDiagnosis | null>(null);
  const [blobTestRunning, setBlobTestRunning] = useState(false);
  const [blobTestResult, setBlobTestResult] = useState<ConnectionTestResult | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  const pickFolder = __test?.pickFolder ?? pickSharedRoot;
  const pickBlob = __test?.pickFolder ?? pickBlobRoot;

  const countText = COUNT_KINDS.filter((k) => (counts?.[k.key] ?? 0) > 0)
    .map((k) => `${t(k.labelKey)} ${counts![k.key]}`)
    .join("・");

  const runTest = useCallback(async () => {
    setTestRunning(true);
    setTestResult(null);
    try {
      let result: ConnectionTestResult;
      if (__test?.testShared) {
        result = await __test.testShared(folder.root);
      } else {
        const identity = loadAuthorIdentity();
        if (!identity) {
          setTestResult({ ok: false, error: t("settings.shared.identityRequired") });
          return;
        }
        result = await testSharedConnection(folder.root, identity);
      }
      setTestResult(result);
      onReachChecked(result.ok);
      if (result.ok) {
        setDiagnosis(null);
        void rememberSharedRootRemote(folder.root);
      } else {
        // 失敗の原因が「フォルダに届いていない」なら、再接続と別名候補の案内に切り替える
        const d = await diagnoseSharedRoot(folder.root);
        setDiagnosis(d.reachable ? null : d);
      }
    } finally {
      setTestRunning(false);
    }
  }, [__test, folder.root, onReachChecked, t]);

  const changeRoot = useCallback(async () => {
    try {
      const picked = await pickFolder(folder.root);
      if (!picked || picked === folder.root) return;
      onChangeRoot(picked);
      setTestResult(null);
      setDiagnosis(null);
      void rememberSharedRootRemote(picked);
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }, [folder.root, onChangeRoot, pickFolder]);

  const pickBlobFolder = useCallback(async () => {
    try {
      const picked = await pickBlob(folder.blobRoot ?? undefined);
      if (!picked) return;
      onChangeBlobRoot(picked);
      setBlobTestResult(null);
    } catch (e) {
      setBlobTestResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }, [folder.blobRoot, onChangeBlobRoot, pickBlob]);

  const testBlob = useCallback(async () => {
    if (!folder.blobRoot) return;
    setBlobTestRunning(true);
    setBlobTestResult(null);
    try {
      const run = __test?.testBlob ?? testBlobConnection;
      setBlobTestResult(await run(folder.blobRoot));
    } finally {
      setBlobTestRunning(false);
    }
  }, [__test, folder.blobRoot]);

  const openMenu = () => {
    const rect = menuBtnRef.current?.getBoundingClientRect();
    if (!rect) return;
    setConfirmRemove(false);
    setMenuPos({ top: rect.bottom + 4, left: rect.right - 220, anchorRect: rect });
  };

  return (
    <div
      className={`${SETTINGS_CARD_CLASS} px-2 py-1.5`}
      data-testid="shared-folder-card"
      aria-label={label}
    >
      {/* 行: 開閉・状態・名前・既定・場所・件数・⋯ */}
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? t("settings.sharedFolders.collapse") : t("settings.sharedFolders.expand")}
          className="flex items-center gap-2 min-w-0 flex-1 text-left rounded px-1 py-1 hover:bg-muted"
        >
          {open ? (
            <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight size={12} className="shrink-0 text-muted-foreground" />
          )}
          <ReachDot reach={reach} />
          {naming ? null : <span className="text-sm font-medium text-foreground shrink-0 max-w-[40%] truncate">{label}</span>}
          {showDefault && isDefault && !naming && (
            <span className="text-[10px] text-primary bg-primary/10 rounded px-1.5 py-0.5 whitespace-nowrap shrink-0">
              {t("settings.sharedFolders.defaultBadge")}
            </span>
          )}
          {!naming && (
            <span className="text-[11px] font-mono text-muted-foreground truncate min-w-0" title={folder.root}>
              {folder.root}
            </span>
          )}
          {!naming && countText && (
            <span className="ml-auto text-[11px] text-muted-foreground whitespace-nowrap shrink-0">{countText}</span>
          )}
        </button>
        {naming && (
          <NameInput
            initial={folder.name || label}
            onDone={onRename}
            placeholder={t("settings.sharedFolders.namePlaceholder")}
            ariaLabel={t("settings.sharedFolders.nameLabel")}
          />
        )}
        <IconButton
          ref={menuBtnRef}
          size="sm"
          aria-label={t("settings.sharedFolders.menu", { name: label })}
          onClick={openMenu}
        >
          <MoreHorizontal />
        </IconButton>
      </div>

      {/* ⋯ メニュー: 名前を変える・既定の共有先にする・接続を確かめる・外す（外すはメニュー内で確認） */}
      {menuPos && (
        <Dropdown position={menuPos} onClose={() => setMenuPos(null)} minWidth={220}>
          {confirmRemove ? (
            <div className="px-3 py-2 space-y-2 max-w-[240px]">
              <p className="text-xs text-muted-foreground">{t("settings.sharedFolders.removeConfirm")}</p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setConfirmRemove(false)}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="text-xs text-red-600 hover:underline"
                  onClick={() => {
                    setMenuPos(null);
                    onRemove();
                  }}
                >
                  {t("settings.sharedFolders.remove")}
                </button>
              </div>
            </div>
          ) : (
            <>
              <MenuItem
                onClick={() => {
                  setMenuPos(null);
                  onStartRename();
                }}
              >
                {t("settings.sharedFolders.rename")}
              </MenuItem>
              {showDefault && !isDefault && (
                <MenuItem
                  onClick={() => {
                    setMenuPos(null);
                    onMakeDefault();
                  }}
                >
                  {t("settings.sharedFolders.makeDefault")}
                </MenuItem>
              )}
              <MenuItem
                onClick={() => {
                  setMenuPos(null);
                  if (!open) onToggle();
                  void runTest();
                }}
              >
                {t("settings.sharedFolders.checkConnection")}
              </MenuItem>
              <MenuItem className="text-red-600" onClick={() => setConfirmRemove(true)}>
                {t("settings.sharedFolders.remove")}
              </MenuItem>
            </>
          )}
        </Dropdown>
      )}

      {/* 開いたときだけ: 場所・画像や PDF の置き場・接続の確認 */}
      {open && (
        <div className={`${SETTINGS_INNER_CARD_CLASS} mt-1.5 ml-5 px-3 py-2 space-y-2.5`}>
          {reach === "unreachable" && !testResult && (
            <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1">
              <AlertCircle size={12} className="mt-0.5 shrink-0" />
              <span>{t("settings.sharedFolders.unreachableHint")}</span>
            </p>
          )}
          <DetailLine label={t("settings.shared.rootLabel")} value={folder.root}>
            <Button size="sm" variant="ghost" onClick={() => void changeRoot()}>
              {t("settings.shared.change")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void runTest()} disabled={testRunning}>
              {testRunning ? <Loader2 size={12} className="animate-spin" /> : t("settings.sharedFolders.checkConnection")}
            </Button>
          </DetailLine>
          {testResult && !testResult.ok && diagnosis && (
            <SharedRootUnreachable
              root={folder.root}
              diagnosis={diagnosis}
              onReload={() => void runTest()}
              onUseAlternative={(path) => {
                onChangeRoot(path);
                setTestResult(null);
                setDiagnosis(null);
              }}
            />
          )}
          {testResult && !(testResult.ok === false && diagnosis) && <TestResultLine result={testResult} />}

          <DetailLine
            label={t("settings.shared.blobRootLabel")}
            value={folder.blobRoot}
            emptyText={t("settings.sharedFolders.blobNotSet")}
          >
            <Button size="sm" variant="ghost" onClick={() => void pickBlobFolder()}>
              {folder.blobRoot ? t("settings.shared.change") : t("settings.shared.pick")}
            </Button>
            {folder.blobRoot && (
              <>
                <Button size="sm" variant="ghost" onClick={() => void testBlob()} disabled={blobTestRunning}>
                  {blobTestRunning ? <Loader2 size={12} className="animate-spin" /> : t("settings.sharedFolders.checkConnection")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    onChangeBlobRoot(null);
                    setBlobTestResult(null);
                  }}
                >
                  {t("settings.shared.clear")}
                </Button>
              </>
            )}
          </DetailLine>
          {blobTestResult && <TestResultLine result={blobTestResult} />}
        </div>
      )}
    </div>
  );
}

/** 状態の印。色だけに頼らないよう、ツールチップと読み上げ用の文言を付ける */
function ReachDot({ reach }: { reach: Reach }) {
  const { t } = useLocale();
  const text =
    reach === "ok"
      ? t("settings.sharedFolders.status.ok")
      : reach === "unreachable"
        ? t("settings.sharedFolders.status.unreachable")
        : reach === "checking"
          ? t("settings.sharedFolders.status.checking")
          : t("settings.sharedFolders.status.unknown");
  const color =
    reach === "ok"
      ? "bg-green-600"
      : reach === "unreachable"
        ? "bg-amber-500"
        : "bg-muted-foreground/40";
  return (
    <span className="relative inline-flex shrink-0" data-tooltip={text}>
      <span className={`w-2 h-2 rounded-full ${color} ${reach === "checking" ? "animate-pulse" : ""}`} />
      <span className="sr-only">{text}</span>
    </span>
  );
}

function DetailLine({
  label,
  value,
  emptyText,
  children,
}: {
  label: string;
  value: string | null;
  emptyText?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2 flex-wrap">
        {value ? (
          <span className="text-xs font-mono text-foreground break-all flex-1 min-w-[12rem]">{value}</span>
        ) : (
          <span className="text-xs text-muted-foreground italic flex-1 min-w-[12rem]">{emptyText}</span>
        )}
        <span className="flex items-center gap-1 shrink-0">{children}</span>
      </div>
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

function TestResultLine({ result }: { result: ConnectionTestResult }) {
  const { t } = useLocale();
  return (
    <div className="text-xs">
      {result.ok ? (
        <p className="flex items-center gap-1 text-green-600">
          <CheckCircle size={12} />
          {t("settings.sharedFolders.connectionOk")}
        </p>
      ) : (
        <p className="flex items-start gap-1 text-red-500">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          <span className="break-all">{result.error}</span>
        </p>
      )}
    </div>
  );
}
