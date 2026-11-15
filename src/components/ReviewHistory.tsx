import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { APP_NAME } from '../config.ts';
import {
  deleteAllReviewsCascade,
  deleteReviewCascade,
  exportAllDataBundle,
  getTodayJST,
  previewDeleteAllReviews,
  previewDeleteReview,
} from '../services/storeService.ts';
import type { AppState, ReviewRecord } from '../types.ts';
import { ConfirmDeleteFlow } from './ConfirmDeleteFlow.tsx';
import { ReviewSheet } from './ReviewSheet.tsx';

interface ReviewHistoryProps {
  state: AppState;
  onStateUpdated: (state: AppState) => void;
  onJumpToKnowledge: (heading: string, subject: string) => void;
  onJumpToTendency: (tendencyName: string) => void;
}

export function ReviewHistory({
  state,
  onStateUpdated,
  onJumpToKnowledge,
  onJumpToTendency,
}: ReviewHistoryProps) {
  const reviews = state.reviews;
  const [selectedId, setSelectedId] = useState<string | null>(reviews[0]?.review_id ?? null);
  const [deleteSingleTarget, setDeleteSingleTarget] = useState<ReviewRecord | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);

  useEffect(() => {
    if (!selectedId && reviews[0]) {
      setSelectedId(reviews[0].review_id);
    } else if (selectedId && !reviews.some((r) => r.review_id === selectedId)) {
      setSelectedId(reviews[0]?.review_id ?? null);
    }
  }, [reviews, selectedId]);

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

  if (reviews.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 text-center space-y-1">
        <p className="text-sm font-medium text-slate-700">添削履歴はまだありません</p>
        <p className="text-xs text-slate-500">
          「添削する」タブから答案を提出すると、ここに添削レポートの履歴が保存されます。
        </p>
      </div>
    );
  }

  const activeReview = reviews.find((r) => r.review_id === selectedId) ?? reviews[0];

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <aside className="lg:col-span-4 bg-white border border-slate-200 rounded-xl divide-y divide-slate-200 overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-600 tabular-nums">
              保存された添削レポート（{reviews.length}件）
            </span>
            <button
              type="button"
              onClick={() => setDeleteAllOpen(true)}
              className="min-h-[max(44px,2.75rem)] inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-red-200 bg-white text-xs font-medium text-red-700 hover:bg-red-50 cursor-pointer shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>履歴を一括削除</span>
            </button>
          </div>
          <div className="max-h-[34rem] overflow-y-auto divide-y divide-slate-100">
            {reviews.map((rev) => {
              const active = rev.review_id === activeReview.review_id;
              const correctCount = rev.questions.filter((q) => q.result === 'correct').length;
              return (
                <div
                  key={rev.review_id}
                  className={`flex items-stretch gap-1 transition-colors ${
                    active ? 'bg-sky-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(rev.review_id)}
                    className="flex-1 min-w-0 min-h-[max(44px,2.75rem)] text-left px-3 py-2 cursor-pointer space-y-0.5"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500 tabular-nums">
                      <span className="font-semibold text-slate-900">{rev.subject}</span>
                      <span>{rev.date}</span>
                    </div>
                    <div className="text-xs text-slate-600 tabular-nums">
                      全{rev.questions.length}問（正解 {correctCount}問） ·{' '}
                      {rev.basis === 'model_answer' ? '模範解答照合' : 'AI自力採点'}
                    </div>
                    <div className="text-xs text-slate-500 truncate">{rev.registration_line}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteSingleTarget(rev)}
                    aria-label={`${rev.subject} (${rev.date}) の履歴を削除`}
                    title="この添削履歴を削除"
                    className="min-w-[max(44px,2.75rem)] min-h-[max(44px,2.75rem)] flex items-center justify-center text-slate-400 hover:text-red-700 hover:bg-red-50 cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </aside>

        <section className="lg:col-span-8 space-y-3">
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => setDeleteSingleTarget(activeReview)}
              className="min-h-[max(44px,2.75rem)] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 bg-white text-xs font-medium text-red-700 hover:bg-red-50 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>この添削履歴を削除</span>
            </button>
          </div>
          <ReviewSheet
            review={activeReview}
            onJumpToKnowledge={onJumpToKnowledge}
            onJumpToTendency={onJumpToTendency}
          />
        </section>
      </div>

      <ConfirmDeleteFlow
        open={Boolean(deleteSingleTarget)}
        targetLabel={
          deleteSingleTarget
            ? `${deleteSingleTarget.subject} (${deleteSingleTarget.date}) の添削履歴`
            : ''
        }
        impactDetails={
          deleteSingleTarget
            ? previewDeleteReview(state, deleteSingleTarget.review_id).details
            : []
        }
        steps={2}
        onBackupClick={handleBackupDownload}
        onConfirm={async () => {
          if (!deleteSingleTarget) return;
          const res = await deleteReviewCascade(deleteSingleTarget.review_id);
          if (!res.ok || !res.state) {
            throw new Error(res.error ?? '添削履歴の削除に失敗しました。');
          }
          onStateUpdated(res.state);
        }}
        onClose={() => setDeleteSingleTarget(null)}
      />

      <ConfirmDeleteFlow
        open={deleteAllOpen}
        targetLabel="すべての添削履歴"
        impactDetails={deleteAllOpen ? previewDeleteAllReviews(state).details : []}
        steps={2}
        requireKeyword="削除"
        onBackupClick={handleBackupDownload}
        onConfirm={async () => {
          const nextState = await deleteAllReviewsCascade();
          onStateUpdated(nextState);
        }}
        onClose={() => setDeleteAllOpen(false)}
      />
    </>
  );
}
