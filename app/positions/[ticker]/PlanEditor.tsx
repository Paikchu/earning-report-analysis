"use client";

import { useEffect, useRef, useState } from "react";
import type { HoldingPlanRecord } from "@/lib/holding-plan-store";
import type { PlanAction } from "@/lib/holding-plan";

type EditableLevel = {
  id: string;
  action: PlanAction;
  price: string;
  sizeNote: string;
  triggerNote: string;
};

const ACTION_LABELS: Record<PlanAction, string> = {
  add: "加仓",
  reduce: "减仓",
  stop: "止损",
  target: "目标",
};

function canAutoSave(draft: { holdingReason: string; levels: EditableLevel[] }): boolean {
  return Boolean(draft.holdingReason.trim()) && draft.levels.every((level) => {
    const price = Number(level.price);
    return Number.isFinite(price) && price > 0;
  });
}

export function PlanEditor({
  ticker,
  initialPlan,
  unavailable = false,
  onDirtyChange,
}: {
  ticker: string;
  initialPlan: HoldingPlanRecord | null;
  unavailable?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [holdingReason, setHoldingReason] = useState(initialPlan?.holdingReason ?? "");
  const [levels, setLevels] = useState<EditableLevel[]>(() => initialPlan?.levels.map((level) => ({
    id: level.id,
    action: level.action,
    price: (level.priceCents / 100).toFixed(2),
    sizeNote: level.sizeNote,
    triggerNote: level.triggerNote,
  })) ?? []);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState(unavailable ? "计划数据暂时无法读取，请稍后再试。" : "");
  const [dirty, setDirty] = useState(false);
  const draftRef = useRef({ holdingReason, levels });
  const editVersionRef = useRef(0);
  const savingRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef<(automatic: boolean) => Promise<void>>();

  const markDirty = () => {
    editVersionRef.current += 1;
    setDirty(true);
    setStatus("idle");
    setMessage("");
    onDirtyChange?.(true);
  };

  const addLevel = () => {
    if (levels.length >= 20) return;
    setLevels((current) => [...current, { id: crypto.randomUUID(), action: "add", price: "", sizeNote: "", triggerNote: "" }]);
    markDirty();
  };

  const updateLevel = (id: string, patch: Partial<EditableLevel>) => {
    setLevels((current) => current.map((level) => level.id === id ? { ...level, ...patch } : level));
    markDirty();
  };

  const moveLevel = (index: number, offset: number) => {
    const destination = index + offset;
    if (destination < 0 || destination >= levels.length) return;
    setLevels((current) => {
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
    markDirty();
  };

  const removeLevel = (id: string) => {
    setLevels((current) => current.filter((item) => item.id !== id));
    markDirty();
  };

  useEffect(() => {
    draftRef.current = { holdingReason, levels };
    saveRef.current = async (automatic) => {
      if (unavailable || savingRef.current) return;
      const version = editVersionRef.current;
      const draft = draftRef.current;
      if (automatic && !canAutoSave(draft)) return;
      savingRef.current = true;
      setStatus("saving");
      setMessage(automatic ? "自动保存中…" : "");
      const payload = {
        holdingReason: draft.holdingReason,
        levels: draft.levels.map((level, sortOrder) => ({
          id: level.id,
          action: level.action,
          priceCents: Math.round(Number(level.price) * 100),
          sizeNote: level.sizeNote,
          triggerNote: level.triggerNote,
          sortOrder,
        })),
      };
      try {
        const response = await fetch(`/api/plans/${encodeURIComponent(ticker)}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const result = await response.json() as { error?: string };
        if (!response.ok) throw new Error(result.error ?? "计划保存失败。");
        if (version === editVersionRef.current) {
          setStatus("saved");
          setMessage(automatic ? "已自动保存" : "计划已保存");
          setDirty(false);
          onDirtyChange?.(false);
        } else {
          setStatus("idle");
          setMessage("有新的更改待保存");
        }
      } catch (error) {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "计划保存失败。");
      } finally {
        savingRef.current = false;
        if (version !== editVersionRef.current && !unavailable) {
          saveTimerRef.current = setTimeout(() => {
            saveTimerRef.current = null;
            void saveRef.current?.(true);
          }, 700);
        }
      }
    };
  }, [holdingReason, levels, onDirtyChange, ticker, unavailable]);

  useEffect(() => {
    if (!dirty || unavailable || !canAutoSave({ holdingReason, levels })) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void saveRef.current?.(true);
    }, 700);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    };
  }, [dirty, holdingReason, levels, unavailable]);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  return (
    <section className="plan-editor" id="plan-editor" aria-labelledby="plan-title">
      <div className="detail-section-heading">
        <h2 id="plan-title">持仓计划</h2>
        {message && <p className={`save-status ${status}`} role="status">{message}</p>}
      </div>

      <label className="field-block">
        <span>持仓原因</span>
        <textarea
          value={holdingReason}
          onChange={(event) => { setHoldingReason(event.target.value); markDirty(); }}
          placeholder="为什么持有它？什么事实支持这个判断？"
          maxLength={5_000}
          rows={6}
          disabled={unavailable}
        />
      </label>

      <div className="levels-heading">
        <div><h3>规划点位</h3><p>把价格、动作和触发条件写在决策发生之前。</p></div>
        <button className="secondary-button" type="button" onClick={addLevel} disabled={unavailable || levels.length >= 20}>添加点位</button>
      </div>

      <div className="plan-levels">
        {levels.map((level, index) => (
          <article className="plan-level" key={level.id}>
            <div className="level-index">{String(index + 1).padStart(2, "0")}</div>
            <label><span>动作</span><select value={level.action} onChange={(event) => updateLevel(level.id, { action: event.target.value as PlanAction })} disabled={unavailable}>{Object.entries(ACTION_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label><span>目标价格</span><div className="price-input"><i>$</i><input value={level.price} onChange={(event) => updateLevel(level.id, { price: event.target.value })} inputMode="decimal" placeholder="0.00" disabled={unavailable} /></div></label>
            <label><span>执行规模</span><input value={level.sizeNote} onChange={(event) => updateLevel(level.id, { sizeNote: event.target.value })} placeholder="20 股 / 目标 8%" maxLength={200} disabled={unavailable} /></label>
            <label className="trigger-field"><span>触发条件</span><input value={level.triggerNote} onChange={(event) => updateLevel(level.id, { triggerNote: event.target.value })} placeholder="估值回落且基本面未变" maxLength={500} disabled={unavailable} /></label>
            <div className="level-actions">
              <button type="button" onClick={() => moveLevel(index, -1)} disabled={unavailable || index === 0} aria-label={`上移第 ${index + 1} 条点位`}>↑</button>
              <button type="button" onClick={() => moveLevel(index, 1)} disabled={unavailable || index === levels.length - 1} aria-label={`下移第 ${index + 1} 条点位`}>↓</button>
              <button type="button" onClick={() => removeLevel(level.id)} disabled={unavailable} aria-label={`删除第 ${index + 1} 条点位`}>删除</button>
            </div>
          </article>
        ))}
        {levels.length === 0 && <p className="plan-empty">尚未设置点位。可以先保存持仓原因，再逐步补充。</p>}
      </div>

      <div className="plan-save-row">
        <span>{holdingReason.length.toLocaleString("zh-CN")} / 5,000</span>
        <button className="primary-button" type="button" onClick={() => void saveRef.current?.(false)} disabled={unavailable || status === "saving"}>{status === "saving" ? "保存中…" : "立即保存"}</button>
      </div>
    </section>
  );
}
