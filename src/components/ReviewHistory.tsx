import { useEffect, useState } from 'react';
import type { ReviewRecord } from '../types.ts';
import { ReviewSheet } from './ReviewSheet.tsx';

interface ReviewHistoryProps {
  reviews: ReviewRecord[];
  onJumpToKnowledge: (heading: string, subject: string) => void;
  onJumpToTendency: (tendencyName: string) => void;
}

export function ReviewHistory({
  reviews,
  onJumpToKnowledge,
  onJumpToTendency,
}: ReviewHistoryProps) {
  const [selectedId, setSelectedId] = useState<string | null>(reviews[0]?.review_id ?? null);

  useEffect(() => {
    if (!selectedId && reviews[0]) {
      setSelectedId(reviews[0].review_id);
    } else if (selectedId && !reviews.some((r) => r.review_id === selectedId)) {
      setSelectedId(reviews[0]?.review_id ?? null);
    }
  }, [reviews, selectedId]);

  if (reviews.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-1.5">
        <p className="text-sm font-medium text-slate-700">添削履歴はまだありません</p>
        <p className="text-xs text-slate-500">
          「添削する」タブから答案を提出すると、ここに添削レポートの履歴が保存されます。
        </p>
      </div>
    );
  }

  const activeReview = reviews.find((r) => r.review_id === selectedId) ?? reviews[0];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <aside className="lg:col-span-4 bg-white border border-slate-200 rounded-xl divide-y divide-slate-200 overflow-hidden">
        <div className="px-4 py-3 bg-slate-50 text-xs font-semibold text-slate-600 tabular-nums">
          保存された添削レポート（{reviews.length}件）
        </div>
        <div className="max-h-[640px] overflow-y-auto divide-y divide-slate-100">
          {reviews.map((rev) => {
            const active = rev.review_id === activeReview.review_id;
            const correctCount = rev.questions.filter((q) => q.result === 'correct').length;
            return (
              <button
                key={rev.review_id}
                type="button"
                onClick={() => setSelectedId(rev.review_id)}
                className={`w-full text-left px-4 py-3.5 transition-colors cursor-pointer space-y-1 ${
                  active ? 'bg-sky-50' : 'hover:bg-slate-50'
                }`}
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
            );
          })}
        </div>
      </aside>

      <section className="lg:col-span-8">
        <ReviewSheet
          review={activeReview}
          onJumpToKnowledge={onJumpToKnowledge}
          onJumpToTendency={onJumpToTendency}
        />
      </section>
    </div>
  );
}
