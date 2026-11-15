import { AlertTriangle, Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface ConfirmDeleteFlowProps {
  open: boolean;
  targetLabel: string;
  impactDetails: string[];
  steps?: 1 | 2;
  requireKeyword?: string;
  onBackupClick?: () => Promise<void> | void;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

export function ConfirmDeleteFlow({
  open,
  targetLabel,
  impactDetails,
  steps = 2,
  requireKeyword,
  onBackupClick,
  onConfirm,
  onClose,
}: ConfirmDeleteFlowProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [keywordInput, setKeywordInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupDone, setBackupDone] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) {
      setStep(1);
      setKeywordInput('');
      setBusy(false);
      setBackupBusy(false);
      setBackupDone(false);
      setErrorMsg(null);
    }
  }, [open, targetLabel]);

  // Focus Cancel button on Step 2 (and on 1-step confirm) for safe default focus
  useEffect(() => {
    if (!open) return;
    if (steps === 1 || step === 2) {
      const id = requestAnimationFrame(() => {
        cancelBtnRef.current?.focus();
      });
      return () => cancelAnimationFrame(id);
    }
  }, [open, step, steps]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onClose]);

  if (!open) return null;

  const isConfirmStep = steps === 1 || step === 2;
  const keywordOk = !requireKeyword || keywordInput.trim() === requireKeyword;

  const handleConfirm = async () => {
    if (!keywordOk || busy) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '削除処理に失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  const handleBackup = async () => {
    if (!onBackupClick || backupBusy) return;
    setBackupBusy(true);
    try {
      await onBackupClick();
      setBackupDone(true);
    } finally {
      setBackupBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-slate-900/50 flex items-center justify-center p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-delete-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) {
          onClose();
        }
      }}
    >
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-4 sm:p-5 space-y-3.5 shadow-lg">
        <div className="flex items-start gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5 text-red-700" />
          </div>
          <div className="space-y-1 min-w-0">
            {steps === 2 && (
              <div className="text-xs font-medium text-slate-500">
                削除の確認（ステップ {step} / 2）
              </div>
            )}
            <h3
              id="confirm-delete-title"
              className="text-base font-bold text-slate-900 leading-snug break-words"
            >
              {!isConfirmStep
                ? `「${targetLabel}」を削除しますか？`
                : steps === 1
                  ? `「${targetLabel}」を削除しますか？`
                  : '本当に削除しますか？ この操作は元に戻せません。'}
            </h3>
          </div>
        </div>

        {!isConfirmStep ? (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1.5">
            <div className="text-xs font-semibold text-slate-700">削除される内容・影響範囲</div>
            <ul className="space-y-1 text-xs text-slate-700 list-disc pl-4 leading-relaxed">
              {impactDetails.map((line, i) => (
                <li key={i} className="break-words">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="space-y-3">
            {steps === 2 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2 text-xs text-red-950 leading-relaxed">
                <p className="font-medium">
                  対象: 「{targetLabel}」
                </p>
                <p>
                  削除されたデータは復元できません。必要な場合は、削除前に JSON バックアップを保存しておくことをおすすめします。
                </p>
                {onBackupClick && (
                  <button
                    type="button"
                    disabled={backupBusy || busy}
                    onClick={() => void handleBackup()}
                    className="min-h-[max(44px,2.75rem)] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>
                      {backupDone
                        ? 'JSONバックアップを保存しました'
                        : backupBusy
                          ? '保存中...'
                          : 'JSONバックアップを保存する'}
                    </span>
                  </button>
                )}
              </div>
            )}

            {steps === 1 && impactDetails.length > 0 && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1 text-xs text-slate-700">
                {impactDetails.map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            )}

            {requireKeyword && (
              <label className="block space-y-1.5">
                <span className="block text-xs font-semibold text-slate-800">
                  実行するには「<span className="text-red-700">{requireKeyword}</span>
                  」と入力してください
                </span>
                <input
                  type="text"
                  value={keywordInput}
                  onChange={(e) => setKeywordInput(e.target.value)}
                  placeholder={requireKeyword}
                  disabled={busy}
                  autoComplete="off"
                  className="w-full min-h-[max(44px,2.75rem)] rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </label>
            )}
          </div>
        )}

        {errorMsg && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-xs text-red-800">
            {errorMsg}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 pt-1 border-t border-slate-100">
          <button
            ref={cancelBtnRef}
            type="button"
            disabled={busy}
            onClick={onClose}
            className="min-h-[max(44px,2.75rem)] px-4 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
          >
            キャンセル
          </button>

          {!isConfirmStep ? (
            <button
              type="button"
              onClick={() => setStep(2)}
              className="min-h-[max(44px,2.75rem)] px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 cursor-pointer"
            >
              次へ
            </button>
          ) : (
            <button
              type="button"
              disabled={!keywordOk || busy}
              onClick={() => void handleConfirm()}
              className="min-h-[max(44px,2.75rem)] px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:bg-red-300 disabled:cursor-not-allowed cursor-pointer"
            >
              {busy ? '削除中...' : '削除する'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
