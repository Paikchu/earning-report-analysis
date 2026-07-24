"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { HoldingPlanRecord } from "@/lib/holding-plan-store";
import type { PositionGroupView } from "@/lib/portfolio-view-model";
import { PositionDetailContent, type PositionPlanStatus } from "./positions/[ticker]/PositionDetailContent";

export type PositionDetailTarget = {
  symbol: string;
  name: string;
  position?: PositionGroupView;
};

export function PositionDetailDialog({
  target,
  snapshotTime,
  onClose,
}: {
  target: PositionDetailTarget;
  snapshotTime: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [plan, setPlan] = useState<HoldingPlanRecord | null>(null);
  const [planStatus, setPlanStatus] = useState<PositionPlanStatus>("loading");
  const [dirty, setDirty] = useState(false);

  const close = useCallback(() => {
    if (dirty && !window.confirm("放弃未保存的更改？")) return;
    dialogRef.current?.close();
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      document.documentElement.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => returnFocusRef.current?.focus());
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/plans/${encodeURIComponent(target.symbol)}`, { signal: controller.signal });
        if (!response.ok) throw new Error();
        const body = await response.json() as { plan: HoldingPlanRecord | null };
        setPlan(body.plan);
        setPlanStatus("ready");
      } catch (error) {
        if ((error as Error).name !== "AbortError") setPlanStatus("unavailable");
      }
    })();
    return () => controller.abort();
  }, [target.symbol]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [close]);

  return (
    <dialog
      aria-labelledby="position-detail-title"
      className="position-detail-dialog"
      onCancel={(event) => event.preventDefault()}
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}
      ref={dialogRef}
    >
      <div className="position-detail-dialog-scroll">
        <div className="position-detail-dialog-toolbar">
          <span>持仓详情</span>
          <button aria-label="关闭持仓详情" onClick={close} type="button">关闭</button>
        </div>
        <div className="position-detail-dialog-body">
          <PositionDetailContent
            companyName={target.name}
            onPlanDirtyChange={setDirty}
            plan={plan}
            planStatus={planStatus}
            position={target.position}
            snapshotTime={snapshotTime}
            ticker={target.symbol}
          />
        </div>
      </div>
    </dialog>
  );
}
