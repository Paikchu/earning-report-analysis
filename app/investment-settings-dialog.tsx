"use client";

import { useEffect, useRef, type FormEvent } from "react";

export function InvestmentSettingsDialog({
  open,
  value,
  onClose,
  onSave,
}: {
  open: boolean;
  value: number;
  onClose: () => void;
  onSave: (value: number) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (inputRef.current) inputRef.current.value = value.toFixed(2);
      if (!dialog.open) dialog.showModal();
      return;
    }
    if (dialog.open) dialog.close();
  }, [open, value]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextValue = inputRef.current?.valueAsNumber ?? Number.NaN;
    if (!Number.isFinite(nextValue) || nextValue < 0) {
      inputRef.current?.setCustomValidity("请输入大于或等于 0 的有效金额。");
      inputRef.current?.reportValidity();
      return;
    }
    onSave(Math.round(nextValue * 100) / 100);
    onClose();
  }

  return (
    <dialog
      className="settings-dialog"
      ref={dialogRef}
      onCancel={onClose}
      onClose={onClose}
      onClick={(event) => { if (event.target === dialogRef.current) onClose(); }}
    >
      <form className="settings-card" onSubmit={submit}>
        <div className="settings-heading">
          <div><span>投资口径</span><h2>设置</h2></div>
          <button type="button" onClick={onClose} aria-label="关闭设置">×</button>
        </div>
        <p className="settings-copy">净入金用于计算累计盈亏和收益率。该设置仅保存在当前设备，不会修改 IBKR 持仓。</p>
        <label className="settings-field">
          <span>当前净入金</span>
          <span className="settings-amount-input"><i aria-hidden="true">$</i><input autoFocus defaultValue={value.toFixed(2)} inputMode="decimal" min="0" ref={inputRef} required step="0.01" type="number" onInput={() => inputRef.current?.setCustomValidity("")} /></span>
        </label>
        <div className="settings-actions">
          <button className="settings-cancel" type="button" onClick={onClose}>取消</button>
          <button className="settings-save" type="submit">保存设置</button>
        </div>
      </form>
    </dialog>
  );
}
