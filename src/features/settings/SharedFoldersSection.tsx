// 設定 → 共有 の「共有フォルダ」一覧（§26）。
//
// 共有フォルダは複数登録できる（例: 組織全体・部署 A）。1 件目が既定の共有先で、
// 新しく共有するものはここへ置く。誰が読めるかは NAS / OS のフォルダ権限が決めるので、
// 画面では名前（範囲）と実パスを並べて見せるだけで、権限の設定は持たない。
//
// 1 件ごとのカードが自分の接続テスト・届かないときの案内を持つ。保存は
// setSharedFolders で即時に行い（他の共有設定と同じく「保存」ボタンを待たない）、
// 共有ストアに読み直しを頼む。

import { useCallback, useState } from "react";
import { AlertCircle, CheckCircle, Loader2, Plus, RotateCcw, Star, Trash2 } from "lucide-react";
import { Button } from "@ui/button";
import { Input } from "@ui/form-field";
import { useLocale } from "../../i18n";
import {
  createSharedFolder,
  diagnoseSharedRoot,
  getBlobRoot,
  getSharedFolders,
  pickBlobRoot,
  pickSharedRoot,
  rememberSharedRootRemote,
  setSharedFolders,
  testBlobConnection,
  testSharedConnection,
  type ConnectionTestResult,
  type SharedFolder,
  type SharedRootDiagnosis,
} from "../../lib/storage/shared";
import { loadAuthorIdentity } from "../identity";
import { notifySharedLibraryChanged } from "../sharing/shared-library-store";
import { SharedRootUnreachable } from "../sharing/SharedRootUnreachable";
import { SETTINGS_CARD_CLASS } from "./SettingsGroup";

export type SharedFoldersSectionProps = {
  /** 一覧が変わったとき（親が「共有フォルダがあるか」で他の項目を出し分けるため） */
  onChange?: (folders: SharedFolder[]) => void;
  /**
   * Storybook / テスト用の差し替え口（本番では未指定）。
   * ダイアログ・接続テストは Tauri に依存するので、ここで置き換える。
   */
  __test?: {
    pickFolder?: (current?: string) => Promise<string | null>;
    testShared?: (root: string) => Promise<ConnectionTestResult>;
    testBlob?: (root: string) => Promise<ConnectionTestResult>;
  };
};

export function SharedFoldersSection({ onChange, __test }: SharedFoldersSectionProps) {
  const { t } = useLocale();
  const [folders, setFoldersState] = useState<SharedFolder[]>(() => getSharedFolders());
  const [addError, setAddError] = useState<string | null>(null);

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

  const pickFolder = __test?.pickFolder ?? pickSharedRoot;

  const handleAdd = useCallback(async () => {
    setAddError(null);
    try {
      const picked = await pickFolder();
      if (!picked) return;
      if (folders.some((f) => f.root === picked)) {
        setAddError(t("settings.sharedFolders.alreadyAdded"));
        return;
      }
      const latest = getSharedFolders();
      // 1 件目なら、以前に控えてあった置き場を引き継ぐ（共有フォルダを外して選び直した場合）
      const added =
        latest.length === 0 ? { ...createSharedFolder(picked), blobRoot: getBlobRoot() } : createSharedFolder(picked);
      commit([...latest, added]);
      // 選べた＝今は届いているので、接続先（smb:// 等）を控えておく
      void rememberSharedRootRemote(picked);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : String(e));
    }
  }, [commit, folders, pickFolder, t]);

  const update = useCallback(
    (id: string, patch: Partial<Omit<SharedFolder, "id">>) => {
      // 土台は保存済みの最新値（接続先は rememberSharedRootRemote が非同期で書くので、
      // 画面の state を土台にすると古い値で上書きしてしまう）
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
    },
    [commit],
  );

  return (
    <div className="space-y-2">
      {folders.length === 0 && (
        <div className={`${SETTINGS_CARD_CLASS} px-3 py-2 text-xs text-muted-foreground italic`}>
          {t("settings.shared.notSet")}
        </div>
      )}
      {folders.map((folder, i) => (
        <SharedFolderCard
          key={folder.id}
          folder={folder}
          isDefault={i === 0}
          showDefaultControls={folders.length > 1}
          onRename={(name) => update(folder.id, { name })}
          onChangeRoot={(root) => update(folder.id, { root, remote: null })}
          onChangeBlobRoot={(blobRoot) => update(folder.id, { blobRoot })}
          onMakeDefault={() => makeDefault(folder.id)}
          onRemove={() => remove(folder.id)}
          __test={__test}
        />
      ))}
      <div className="flex items-center gap-2 flex-wrap">
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

type CardProps = {
  folder: SharedFolder;
  isDefault: boolean;
  /** 2 件以上のときだけ「既定の共有先」の印と切り替えを出す（1 件なら選ぶものが無い） */
  showDefaultControls: boolean;
  onRename: (name: string) => void;
  onChangeRoot: (root: string) => void;
  onChangeBlobRoot: (blobRoot: string | null) => void;
  onMakeDefault: () => void;
  onRemove: () => void;
  __test?: SharedFoldersSectionProps["__test"];
};

function SharedFolderCard({
  folder,
  isDefault,
  showDefaultControls,
  onRename,
  onChangeRoot,
  onChangeBlobRoot,
  onMakeDefault,
  onRemove,
  __test,
}: CardProps) {
  const { t } = useLocale();
  const [name, setName] = useState(folder.name);
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [diagnosis, setDiagnosis] = useState<SharedRootDiagnosis | null>(null);
  const [blobTestRunning, setBlobTestRunning] = useState(false);
  const [blobTestResult, setBlobTestResult] = useState<ConnectionTestResult | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const pickFolder = __test?.pickFolder ?? pickSharedRoot;
  const pickBlob = __test?.pickFolder ?? pickBlobRoot;

  const handleChangeRoot = useCallback(async () => {
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

  const handleTest = useCallback(async () => {
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
  }, [__test, folder.root, t]);

  const handlePickBlob = useCallback(async () => {
    try {
      const picked = await pickBlob(folder.blobRoot ?? undefined);
      if (!picked) return;
      onChangeBlobRoot(picked);
      setBlobTestResult(null);
    } catch (e) {
      setBlobTestResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }, [folder.blobRoot, onChangeBlobRoot, pickBlob]);

  const handleTestBlob = useCallback(async () => {
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

  const commitName = () => {
    const next = name.trim();
    if (next !== folder.name) onRename(next);
  };

  return (
    <div
      className={`${SETTINGS_CARD_CLASS} px-3 py-2 space-y-2`}
      data-testid="shared-folder-card"
      aria-label={folder.name || t("settings.sharedFolders.unnamed")}
    >
      {/* 名前（範囲）と既定の共有先 */}
      <div className="flex items-center gap-2">
        <Input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder={t("settings.sharedFolders.namePlaceholder")}
          aria-label={t("settings.sharedFolders.nameLabel")}
          className="flex-1 min-w-0"
        />
        {showDefaultControls &&
          (isDefault ? (
            <span className="text-[11px] text-primary bg-primary/10 rounded px-1.5 py-0.5 whitespace-nowrap inline-flex items-center gap-1">
              <Star size={11} />
              {t("settings.sharedFolders.defaultBadge")}
            </span>
          ) : (
            <button
              type="button"
              onClick={onMakeDefault}
              className="text-[11px] text-muted-foreground hover:text-foreground whitespace-nowrap"
            >
              {t("settings.sharedFolders.makeDefault")}
            </button>
          ))}
      </div>

      {/* 場所 */}
      <div>
        <div className="text-xs text-muted-foreground">{t("settings.shared.rootLabel")}</div>
        <div className="text-xs font-mono text-foreground break-all">{folder.root}</div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="ghost" onClick={() => void handleChangeRoot()}>
          {t("settings.shared.change")}
        </Button>
        <Button size="sm" onClick={() => void handleTest()} disabled={testRunning}>
          {testRunning ? <Loader2 size={12} className="animate-spin" /> : t("settings.shared.test")}
        </Button>
        {confirmRemove ? (
          <span className="text-xs flex items-center gap-2">
            <span className="text-muted-foreground">{t("settings.sharedFolders.removeConfirm")}</span>
            <button type="button" onClick={onRemove} className="text-red-600 hover:underline">
              {t("settings.sharedFolders.remove")}
            </button>
            <button
              type="button"
              onClick={() => setConfirmRemove(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              {t("common.cancel")}
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmRemove(true)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <Trash2 size={12} />
            {t("settings.sharedFolders.remove")}
          </button>
        )}
      </div>
      {testResult && !testResult.ok && diagnosis && (
        <SharedRootUnreachable
          root={folder.root}
          diagnosis={diagnosis}
          onReload={() => void handleTest()}
          onUseAlternative={(path) => {
            onChangeRoot(path);
            setTestResult(null);
            setDiagnosis(null);
          }}
        />
      )}
      {testResult && !(testResult.ok === false && diagnosis) && <TestResultLine result={testResult} />}

      {/* 大きなファイルの置き場（この共有フォルダの分） */}
      <div className="pt-1">
        <div className="text-xs text-muted-foreground">{t("settings.shared.blobRootLabel")}</div>
        {folder.blobRoot ? (
          <div className="text-xs font-mono text-foreground break-all">{folder.blobRoot}</div>
        ) : (
          <div className="text-xs text-muted-foreground italic">{t("settings.shared.notSet")}</div>
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="ghost" onClick={() => void handlePickBlob()}>
          {folder.blobRoot ? t("settings.shared.change") : t("settings.shared.pick")}
        </Button>
        {folder.blobRoot && (
          <>
            <Button size="sm" onClick={() => void handleTestBlob()} disabled={blobTestRunning}>
              {blobTestRunning ? <Loader2 size={12} className="animate-spin" /> : t("settings.shared.test")}
            </Button>
            <button
              type="button"
              onClick={() => {
                onChangeBlobRoot(null);
                setBlobTestResult(null);
              }}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <RotateCcw size={12} />
              {t("settings.shared.clear")}
            </button>
          </>
        )}
      </div>
      {blobTestResult && <TestResultLine result={blobTestResult} />}
    </div>
  );
}

function TestResultLine({ result }: { result: ConnectionTestResult }) {
  const { t } = useLocale();
  return (
    <div className="text-xs">
      {result.ok ? (
        <p className="flex items-center gap-1 text-green-600">
          <CheckCircle size={12} />
          {t("settings.shared.testOk")}
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
