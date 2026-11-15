import { AlertTriangle, Check, X } from 'lucide-react';
import { useState } from 'react';
import { resolveProposal } from '../services/toolExecutor.ts';
import type { AppState, OrganizationProposal } from '../types.ts';

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

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            確認待ちの整理提案（{pending.length}件）
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            整理モードが「確認」のとき、AIによるフォルダ作成・移動・名前変更・統合の提案がここに保留されます。
          </p>
        </div>

        {errorMsg && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2 text-xs text-amber-900">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {pending.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
            現在、承認待ちの整理提案はありません。
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map((p) => (
              <div
                key={p.proposal_id}
                className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs text-slate-500 tabular-nums">
                    <span className="font-semibold text-slate-800">{getToolLabel(p.tool)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{p.created_at.slice(0, 10)}</span>
                  </div>
                  <div className="text-sm font-semibold text-slate-900">{p.summary}</div>
                  <div className="text-xs text-slate-600">理由: {p.reason}</div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busyId === p.proposal_id}
                    onClick={() => void handleAction(p.proposal_id, 'reject')}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>却下</span>
                  </button>
                  <button
                    type="button"
                    disabled={busyId === p.proposal_id}
                    onClick={() => void handleAction(p.proposal_id, 'approve')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-700 text-white text-xs font-semibold hover:bg-sky-800 cursor-pointer disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>承認して実行</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {history.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">処理済みの提案</h3>
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            {history.slice(0, 20).map((p) => (
              <div key={p.proposal_id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="space-y-0.5">
                  <div className="font-medium text-slate-800">{p.summary}</div>
                  <div className="text-slate-500">
                    {getToolLabel(p.tool)} · 理由: {p.reason}
                    {p.invalid_reason ? ` · ${p.invalid_reason}` : ''}
                  </div>
                </div>
                <span className="font-medium text-slate-600 shrink-0">
                  {getStatusLabel(p.status)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
