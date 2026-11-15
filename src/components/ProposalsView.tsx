import { AlertTriangle, Check, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { APP_NAME } from '../config.ts';
import {
  deleteProposal,
  deleteResolvedProposals,
  exportAllDataBundle,
  getTodayJST,
} from '../services/storeService.ts';
import { resolveProposal } from '../services/toolExecutor.ts';
import type { AppState, OrganizationProposal } from '../types.ts';
import { ConfirmDeleteFlow } from './ConfirmDeleteFlow.tsx';

interface ProposalsViewProps {
  state: AppState;
  onStateUpdated: (state: AppState) => void;
}

function getToolLabel(tool: OrganizationProposal['tool']): string {
  switch (tool) {
    case 'create_folder':
      return 'フォルダ作成';
    case 'move_item':
      return '移動';
    case 'rename_item':
      return '名前変更';
    case 'merge_items':
      return '重複統合';
  }
}

function getStatusLabel(status: OrganizationProposal['status']): string {
  switch (status) {
    case 'pending':
      return '承認待ち';
    case 'approved':
      return '承認・実行済み';
    case 'rejected':
      return '却下';
    case 'invalidated':
      return '無効（対象変更済み）';
  }
}

export function ProposalsView({ state, onStateUpdated }: ProposalsViewProps) {
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteSingleTarget, setDeleteSingleTarget] = useState<OrganizationProposal | null>(null);
  const [deleteResolvedOpen, setDeleteResolvedOpen] = useState(false);

  const pending = state.proposals.filter((p) => p.status === 'pending');
  const history = state.proposals.filter((p) => p.status !== 'pending');

  const handleAction = async (proposalId: string, action: 'approve' | 'reject') => {
    setBusyId(proposalId);
    setErrorMsg(null);
    try {
      const result = await resolveProposal(proposalId, action);
      onStateUpdated(result.state);
      if (!result.ok) {
        setErrorMsg(result.error ?? '提案の処理に失敗しました。');
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleBackupDownload = async () => {
    const bundle = await exportAllDataBundle();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${APP_NAME}_backup_${getTodayJST()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <section className="space-y-2.5">
        <div>
          <h2 className="text-[0.9375rem] sm:text-base font-semibold text-slate-900">
            確認待ちの整理提案（{pending.length}件）
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            整理モードが「確認」のとき、AIによるフォルダ作成・移動・名前変更・統合の提案がここに保留されます。
          </p>
        </div>

        {errorMsg && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 flex items-start gap-2 text-xs text-amber-900">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {pending.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-6 text-center text-sm text-slate-500">
            現在、承認待ちの整理提案はありません。
          </div>
        ) : (
          <div className="space-y-2">
            {pending.map((p) => (
              <div
                key={p.proposal_id}
                className="bg-white border border-slate-200 rounded-xl p-3 sm:p-3.5 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2 text-xs text-slate-500 tabular-nums">
                    <span className="font-semibold text-slate-800">{getToolLabel(p.tool)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{p.created_at.slice(0, 10)}</span>
                  </div>
                  <div className="text-sm font-semibold text-slate-900">{p.summary}</div>
                  <div className="text-xs text-slate-600">理由: {p.reason}</div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={busyId === p.proposal_id}
                    onClick={() => void handleAction(p.proposal_id, 'reject')}
                    className="min-h-[max(44px,2.75rem)] inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>却下</span>
                  </button>
                  <button
                    type="button"
                    disabled={busyId === p.proposal_id}
                    onClick={() => void handleAction(p.proposal_id, 'approve')}
                    className="min-h-[max(44px,2.75rem)] inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-sky-700 text-white text-xs font-semibold hover:bg-sky-800 cursor-pointer disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>承認して実行</span>
                  </button>
                  <button
                    type="button"
                    disabled={busyId === p.proposal_id}
                    onClick={() => setDeleteSingleTarget(p)}
                    className="min-h-[max(44px,2.75rem)] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 text-xs font-medium text-red-700 hover:bg-red-50 cursor-pointer disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>削除</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {history.length > 0 && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-700">
              処理済みの提案（{history.length}件）
            </h3>
            <button
              type="button"
              onClick={() => setDeleteResolvedOpen(true)}
              className="min-h-[max(44px,2.75rem)] inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 bg-white text-xs font-medium text-red-700 hover:bg-red-50 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>処理済みを削除</span>
            </button>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            {history.map((p) => (
              <div
                key={p.proposal_id}
                className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="font-medium text-slate-800">{p.summary}</div>
                  <div className="text-slate-500">
                    {getToolLabel(p.tool)} · 理由: {p.reason}
                    {p.invalid_reason ? ` · ${p.invalid_reason}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-medium text-slate-600">{getStatusLabel(p.status)}</span>
                  <button
                    type="button"
                    onClick={() => setDeleteSingleTarget(p)}
                    aria-label={`提案「${p.summary}」を削除`}
                    className="min-h-[max(44px,2.75rem)] inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-red-200 text-xs font-medium text-red-700 hover:bg-red-50 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>削除</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <ConfirmDeleteFlow
        open={Boolean(deleteSingleTarget)}
        targetLabel={deleteSingleTarget?.summary ?? ''}
        impactDetails={
          deleteSingleTarget
            ? [
                `種別: ${getToolLabel(deleteSingleTarget.tool)}（${getStatusLabel(deleteSingleTarget.status)}）`,
                `理由: ${deleteSingleTarget.reason}`,
              ]
            : []
        }
        steps={2}
        onBackupClick={handleBackupDownload}
        onConfirm={async () => {
          if (!deleteSingleTarget) return;
          const res = await deleteProposal(deleteSingleTarget.proposal_id);
          if (!res.ok || !res.state) {
            throw new Error(res.error ?? '整理提案の削除に失敗しました。');
          }
          onStateUpdated(res.state);
        }}
        onClose={() => setDeleteSingleTarget(null)}
      />

      <ConfirmDeleteFlow
        open={deleteResolvedOpen}
        targetLabel={`処理済みの整理提案（${history.length}件）`}
        impactDetails={[
          `処理済み（承認・却下・無効）の提案 ${history.length}件を削除します。`,
          '※ 既に実行されたフォルダ移動や統合の結果自体は元に戻りません。承認待ちの提案は残ります。',
        ]}
        steps={2}
        onBackupClick={handleBackupDownload}
        onConfirm={async () => {
          const nextState = await deleteResolvedProposals();
          onStateUpdated(nextState);
        }}
        onClose={() => setDeleteResolvedOpen(false)}
      />
    </div>
  );
}
