// 手順フロービューのノードカード。
//
// カードが持つのはタイトル・操作（リネーム / 本文へ / 削除）と、
// パラメータの件数だけ。中身の閲覧・編集も追加も flow-attribute-table
// （ステップの全テーブルを積んだパネル）に集約する。
// 色は design.md のラベル配色（activity 青 / 材料 緑 / 道具 アンバー /
// output テラコッタ）に従う。書き込みは data のコールバック経由。

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ParamLinkButton, resolveParamLinkTarget } from "./param-link";
import { splitAttrLabel } from "./activity-graph-adapter";
import { Handle, Position, useReactFlow, type Node, type NodeProps } from "@xyflow/react";
import { ExternalLink, FileText, Pencil, SlidersHorizontal, Trash2 } from "lucide-react";
import { useImeEnterGuard } from "../../hooks/use-ime-enter-guard";
import { t } from "../../i18n";
import type { ActivityNode, ActivityParam, FlowNoteRef, FlowStep } from "./activity-graph-adapter";
import { KIND_PALETTE, selectionRing } from "./flow-palette";

/** 段階（stage）を持つパラメータ列を、段階ごとの連続した塊にまとめる。
 *  params は「own params → 段階 1 → 段階 2 …」の順で連結済み（adapter 側）なので、
 *  隣接する stage が同じ間だけまとめれば元の並びを崩さない。 */
export function groupParamsByStage(params: ActivityParam[]): { stage?: number; items: ActivityParam[] }[] {
  const groups: { stage?: number; items: ActivityParam[] }[] = [];
  for (const p of params) {
    const last = groups[groups.length - 1];
    if (last && last.stage === p.stage) last.items.push(p);
    else groups.push({ stage: p.stage, items: [p] });
  }
  return groups;
}

export type StepNodeData = {
  /** F 案では FlowStep（id/name/params）を渡す。旧 ActivityNode も型互換
   *  （inputs/outputs はもう表示しない — Entity は独立ノードになった） */
  activity: Pick<FlowStep, "id" | "name" | "params" | "stageCount" | "externalOrigin" | "noteRef"> &
    Partial<Pick<ActivityNode, "inputs" | "outputs">>;
  onRename?: (blockId: string, title: string) => void;
  onDelete?: (blockId: string) => void;
  onJump?: (blockId: string) => void;
  onOpenExternalNote?: (noteId: string) => void;
  /** 工程ノート（noteRef）の「ノートを開く / 作る」。noteId の有無で呼び出し側が判断する */
  onOpenNoteRef?: (ref: FlowNoteRef, step: FlowStep) => void;
  /** 削除確認に出す「中身のブロック数」。押した瞬間に評価する（stale 回避） */
  getContentCount?: (blockId: string) => number;
  /**
   * 同名の兄弟ステップと値が食い違うパラメータ（computeStepDistinguishers）。
   * 見出しは操作名だけなので、条件違いの並列ノートはこれが唯一の見分け。
   * 兄弟がいない、または全員同じ値のときは空 = 何も出さない。
   */
  distinguishers?: string[];
  /** ツールバーの「パラメータを表示」。オンならカードに全件を並べる */
  showParams?: boolean;
  /**
   * 工程ノード（noteRef）同士の接続を許す（計画ノートの工程フローで予定の線を
   * 引く）。true のとき noteRef のハンドルも通常どおり掴める見た目・
   * isConnectable にする
   */
  connectNoteRefs?: boolean;
};

export type StepFlowNode = Node<StepNodeData, "step">;


const PARAM_COLOR = "var(--color-text-tertiary)";
const ACTIVITY_BLUE = KIND_PALETTE.activity.main;
const ACTIVITY_TEXT = KIND_PALETTE.activity.text;

const iconBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 20,
  height: 20,
  padding: 0,
  border: "none",
  borderRadius: 5,
  background: "transparent",
  color: "var(--color-text-tertiary)",
  cursor: "pointer",
};

const miniBtnStyle: CSSProperties = {
  ...iconBtnStyle,
  width: 18,
  height: 18,
};

/** 工程ノード（noteRef）のハンドル: 線の端点にはなるが掴めない点 */
const INERT_HANDLE_STYLE: React.CSSProperties = {
  width: 7,
  height: 7,
  background: "var(--color-border)",
  border: "none",
  cursor: "default",
  pointerEvents: "none",
};

export function StepNodeCard({ id, data, selected }: NodeProps<StepFlowNode>) {
  const {
    activity,
    onRename: onRenameProp,
    onDelete: onDeleteProp,
    onJump: onJumpProp,
    onOpenExternalNote,
    onOpenNoteRef,
    getContentCount,
  } = data;
  const external = activity.externalOrigin;
  const noteRef = activity.noteRef;
  // 工程ノート同士の接続を許す画面（計画ノートの工程フロー、予定の線）では、
  // noteRef のハンドルも通常の step と同じに掴める見た目・isConnectable にする
  const noteRefConnectable = !!noteRef && !!data.connectNoteRefs;
  // 工程ノート由来のノードは rename / delete / 本文へ を出さない（表側で名前を変える運用）
  const onRename = noteRef ? undefined : onRenameProp;
  const onDelete = noteRef ? undefined : onDeleteProp;
  const onJump = noteRef ? undefined : onJumpProp;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(activity.name);
  const [confirmCount, setConfirmCount] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  // 「ノートを開く / 作る」ボタンを押し始めた位置。カード幅いっぱいのボタンに
  // nodrag を付けるとカードの 3 割が掴めない場所になるので、ドラッグは通し、
  // 押した点からほとんど動いていないときだけクリックとして扱う
  const openPressRef = useRef<{ x: number; y: number } | null>(null);
  const { compositionHandlers, isImeKey } = useImeEnterGuard();
  const { getViewport, setViewport } = useReactFlow();

  // 選択が外れたら編集・削除確認・追加フローをリセットする
  useEffect(() => {
    if (!selected) {
      setEditing(false);
      setConfirmCount(null);
    }
  }, [selected]);

  // 開いた中身がキャンバスの外にはみ出したら、その分だけ寄せる。
  // 種類の選択肢は下へ伸びるので、端の手順だと切れて見えなくなる
  useEffect(() => {
    if (!selected) return;
    const id = requestAnimationFrame(() => {
      const el = cardRef.current;
      const pane = el?.closest(".react-flow");
      if (!el || !pane) return;
      const overflow = el.getBoundingClientRect().bottom - (pane.getBoundingClientRect().bottom - 8);
      if (overflow <= 0) return;
      const vp = getViewport();
      setViewport({ ...vp, y: vp.y - overflow }, { duration: 150 });
    });
    return () => cancelAnimationFrame(id);
  }, [selected, confirmCount, getViewport, setViewport]);

  const startEditing = () => {
    if (!onRename) return;
    setDraft(activity.name);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commitRename = () => {
    const v = draft.trim();
    // 開いて閉じただけでタイトル（連番プレフィックス等）を壊さない
    if (v && v !== activity.name) onRename?.(id, v);
    setEditing(false);
  };

  const hasBody = activity.params.length > 0;
  // 展開中は全件が並ぶので、見分け用の抜粋は重複になる
  const showParams = !!data.showParams;
  const distinguishers = showParams ? [] : (data.distinguishers ?? []);
  const stageCount = activity.stageCount ?? 0;
  const hasStages = stageCount >= 2;

  // 値が @参照ならその場から飛べるようにする（表パネルと同じ ↗）
  const renderParamLine = (p: ActivityParam, key: number) => {
    const target = data.onOpenExternalNote
      ? resolveParamLinkTarget(splitAttrLabel(p.label).value)
      : null;
    return (
      <span key={key} style={{ display: "block" }}>
        {p.label}
        {target && <ParamLinkButton targetId={target} onOpen={data.onOpenExternalNote!} />}
      </span>
    );
  };

  return (
    <div
      ref={cardRef}
      data-test={external ? "external-process-node" : undefined}
      style={{
        minWidth: 180,
        maxWidth: 240,
        borderRadius: 8,
        background: "var(--color-card)",
        border: `1.5px ${external ? "dashed" : "solid"} ${ACTIVITY_BLUE}`,
        // 選択は枠を太くせずリングで示す。太さを変えるとノードの実寸が変わり、
        // React Flow が測り直してレイアウトが動く
        boxShadow: selected ? selectionRing(ACTIVITY_BLUE) : "var(--shadow-1)",
        overflow: "hidden",
        fontFamily: "inherit",
      }}
    >
      {/* タイトル帯（Entity ノードと同じ作り: 種類の色 + 点 + 名前） */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 8px 5px 10px",
          background: KIND_PALETTE.activity.bg,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            flexShrink: 0,
            borderRadius: "50%",
            background: ACTIVITY_BLUE,
          }}
        />
        {external && (
          <ExternalLink
            size={11}
            aria-label={t("activityGraph.externalProcess")}
            style={{ flexShrink: 0, color: ACTIVITY_TEXT }}
          />
        )}
        {noteRef && (
          <FileText
            size={11}
            aria-label={t("planFlow.openNote")}
            style={{ flexShrink: 0, color: ACTIVITY_TEXT }}
          />
        )}
        {editing ? (
          <input
            ref={inputRef}
            className="nodrag"
            value={draft}
            autoFocus
            aria-label={t("activityGraph.stepName")}
            onChange={(e) => setDraft(e.target.value)}
            {...compositionHandlers}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isImeKey(e)) {
                commitRename();
              } else if (e.key === "Escape") {
                e.stopPropagation();
                setEditing(false);
              }
            }}
            onBlur={() => setEditing(false)}
            style={{
              flex: 1,
              minWidth: 0,
              padding: "1px 5px",
              fontSize: 12,
              fontWeight: 700,
              color: "var(--color-foreground)",
              border: `1px solid ${ACTIVITY_BLUE}`,
              borderRadius: 5,
              outline: "none",
            }}
          />
        ) : (
          <span
            onDoubleClick={startEditing}
            title={activity.name}
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12,
              fontWeight: 700,
              color: ACTIVITY_TEXT,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {activity.name}
          </span>
        )}

        {/* 操作: 選択時のみ出す（非選択時はカードをすっきり保つ） */}
        {selected && !editing && (
          <span className="nodrag" style={{ display: "inline-flex", gap: 1, flexShrink: 0 }}>
            {onRename && (
              <button
                onClick={startEditing}
                title={t("activityGraph.stepName")}
                style={{ ...iconBtnStyle, color: ACTIVITY_TEXT }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.7)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <Pencil size={12} />
              </button>
            )}
            {onJump && (
              <button
                onClick={() => onJump(id)}
                title={t("activityGraph.jumpToText")}
                style={{ ...iconBtnStyle, color: ACTIVITY_TEXT }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.7)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <FileText size={12} />
              </button>
            )}
            {onDelete && confirmCount === null && (
              <button
                onClick={() => {
                  const n = getContentCount?.(id) ?? 0;
                  if (n > 0) setConfirmCount(n);
                  else onDelete(id);
                }}
                title={t("activityGraph.deleteNode")}
                style={{ ...iconBtnStyle, color: "var(--color-destructive)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-error-bg)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <Trash2 size={12} />
              </button>
            )}
          </span>
        )}
      </div>

      {external && (
        <button
          type="button"
          className="nodrag"
          onClick={(event) => {
            event.stopPropagation();
            onOpenExternalNote?.(external.noteId);
          }}
          aria-label={t("activityGraph.openExternalProcess", {
            note: external.noteTitle,
          })}
          title={t("activityGraph.openExternalProcess", {
            note: external.noteTitle,
          })}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            width: "100%",
            padding: "4px 10px 6px",
            border: "none",
            background: "transparent",
            color: external.broken
              ? "var(--color-error)"
              : "var(--color-text-secondary)",
            cursor: "pointer",
            fontSize: 10,
            textAlign: "left",
          }}
        >
          <ExternalLink size={11} style={{ flexShrink: 0 }} />
          <span
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {external.noteTitle}
            {external.broken ? ` — ${t("step.brokenLink")}` : ""}
          </span>
        </button>
      )}

      {/* 工程ノート由来のノード: 状態バッジ（未作成 / 同名衝突 / ゴミ箱 / アーカイブ）と
          「ノートを開く / 作る」ボタン。同名衝突は解決できないためボタンを出さない */}
      {noteRef && (
        // nodrag はボタンだけに付ける。囲いに付けると、状態バッジや余白も含めた
        // カードの帯ぜんぶが「掴めない場所」になり、ノードを引っ張れなくなる
        <div style={{ padding: "0 10px 6px" }}>
          {noteRef.state === "unlinked" && (
            <div
              title={t("planFlow.unlinkedRowHint")}
              style={{ fontSize: 10, fontWeight: 600, color: "var(--color-text-tertiary)", marginBottom: 3 }}
            >
              {t("planFlow.unlinkedRow")}
            </div>
          )}
          {noteRef.state === "duplicateName" && (
            <div style={{ fontSize: 10, color: "var(--color-destructive)" }}>
              {t("planFlow.duplicateNameHint")}
            </div>
          )}
          {noteRef.state === "trashed" && (
            <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginBottom: 3 }}>
              {t("planFlow.trashedNote")}
            </div>
          )}
          {noteRef.state === "archived" && (
            <div style={{ fontSize: 10, color: "var(--color-text-tertiary)", marginBottom: 3 }}>
              {t("planFlow.archivedNote")}
            </div>
          )}
          {noteRef.state !== "duplicateName" && (
            <button
              type="button"
              onPointerDown={(event) => {
                openPressRef.current = { x: event.clientX, y: event.clientY };
              }}
              onClick={(event) => {
                event.stopPropagation();
                const press = openPressRef.current;
                openPressRef.current = null;
                // 掴んで動かしたのならノードの移動。ノートは開かない
                if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4) {
                  return;
                }
                onOpenNoteRef?.(noteRef, activity as FlowStep);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                width: "100%",
                padding: "4px 10px",
                border: `1px solid ${ACTIVITY_BLUE}`,
                borderRadius: 6,
                background: "transparent",
                color: ACTIVITY_TEXT,
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              <FileText size={11} style={{ flexShrink: 0 }} />
              {noteRef.noteId ? t("planFlow.openNote") : t("planFlow.createNote")}
            </button>
          )}
        </div>
      )}

      {/* 削除確認（中身がある step は 1 クリックで消さない） */}
      {selected && confirmCount !== null && (
        <div style={{ padding: "0 8px 6px 10px" }}>
          <button
            className="nodrag"
            onClick={() => onDelete?.(id)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              width: "100%",
              padding: "4px 8px",
              fontSize: 11,
              fontWeight: 600,
              color: "var(--color-destructive)",
              background: "var(--color-error-bg)",
              border: "1px solid var(--color-destructive)",
              borderRadius: 6,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            <Trash2 size={11} /> {t("activityGraph.deleteNodeConfirm", { n: String(confirmCount) })}
          </button>
        </div>
      )}

      {/* 同名ノードの見分け。値が割れているパラメータだけを薄く添える
          （全員同じ rpm: 300 は区別に効かないので出さない） */}
      {distinguishers.length > 0 && (
        <div
          style={{
            padding: "3px 10px 0",
            fontSize: 10,
            lineHeight: 1.35,
            color: PARAM_COLOR,
            overflowWrap: "anywhere",
          }}
        >
          {distinguishers.join(" · ")}
        </div>
      )}

      {/* 既定は「ある」ことだけ示し、編集はパネル側。展開中は中身を並べる
          （条件を読みながらグラフの形を追えるようにするための表示専用） */}
      {hasBody && (
        <div
          style={{
            display: "flex",
            alignItems: showParams ? "flex-start" : "center",
            gap: 4,
            padding: "4px 10px 6px",
            fontSize: 10,
            lineHeight: 1.4,
            color: PARAM_COLOR,
          }}
        >
          <SlidersHorizontal size={10} style={{ flexShrink: 0, marginTop: showParams ? 2 : 0 }} />
          {showParams ? (
            <span style={{ overflowWrap: "anywhere" }}>
              {hasStages
                ? groupParamsByStage(activity.params).map((group, gi) => (
                    <span key={gi} style={{ display: "block" }}>
                      {group.stage !== undefined && (
                        <span
                          style={{
                            display: "block",
                            fontWeight: 700,
                            marginTop: gi > 0 ? 4 : 0,
                          }}
                        >
                          {t("prov.stageHeading", { n: String(group.stage) })}
                        </span>
                      )}
                      {group.items.map((p, i) => renderParamLine(p, i))}
                    </span>
                  ))
                : activity.params.map((p, i) => renderParamLine(p, i))}
            </span>
          ) : hasStages ? (
            t("prov.stageCount", { n: String(stageCount) })
          ) : (
            activity.params.length
          )}
        </div>
      )}

      {/* 上=入力（受け側・白抜き）、下=出力（掴んで接続・青塗り）。
          工程ノード（noteRef）は線の端点としてハンドルを残すが、線はこの画面では
          引けない（線の実体は工程ノート側の手順が前の工程の出力を入力に選ぶ参照）。
          掴めそうに見えないよう、小さな灰色の点にしてポインタも受けない
          （外部 step は受け側にならないので上ハンドルを出さない） */}
      {!external && (
        <Handle
          type="target"
          position={Position.Top}
          isConnectable={!noteRef || noteRefConnectable}
          style={
            noteRef && !noteRefConnectable
              ? INERT_HANDLE_STYLE
              : {
                  width: 9,
                  height: 9,
                  background: "var(--color-card)",
                  border: `2px solid ${ACTIVITY_BLUE}`,
                }
          }
        />
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        isConnectable={!external && (!noteRef || noteRefConnectable)}
        style={
          noteRef && !noteRefConnectable
            ? INERT_HANDLE_STYLE
            : {
                width: 11,
                height: 11,
                background: ACTIVITY_BLUE,
                border: `2px solid ${ACTIVITY_BLUE}`,
              }
        }
      />
    </div>
  );
}
