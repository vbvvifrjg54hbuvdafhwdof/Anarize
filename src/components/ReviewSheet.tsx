import { AlertTriangle, CheckCircle2, MinusCircle, XCircle } from 'lucide-react';
import type { MistakeCause, QuestionResult, ReviewRecord } from '../types.ts';
import { MathText } from './MathText.tsx';

interface ReviewSheetProps {
  review: ReviewRecord;
  onJumpToKnowledge?: (heading: string, subject: string) => void;
  onJumpToTendency?: (tendencyName: string) => void;
}

function getResultMeta(result: QuestionResult) {
  switch (result) {
    case 'correct':
      return {
        label: '正解',
        textClass: 'text-emerald-700',
        bgClass: 'bg-emerald-50 border-emerald-200',
        Icon: CheckCircle2,
      };
    case 'partial':
      return {
        label: '部分点',
        textClass: 'text-amber-700',
        bgClass: 'bg-amber-50 border-amber-200',
        Icon: MinusCircle,
      };
    case 'incorrect':
      return {
        label: '不正解',
        textClass: 'text-red-700',
        bgClass: 'bg-red-50 border-red-200',
        Icon: XCircle,
      };
  }
}

function getCauseLabel(cause: MistakeCause): string {
  switch (cause) {
    case 'knowledge':
      return '知識不足';
    case 'carelessness':
      return '不注意';
    case 'both':
      return '知識不足・不注意の両方';
    case 'none':
      return '誤りなし';
  }
}

export function ReviewSheet({
  review,
  onJumpToKnowledge,
  onJumpToTendency,
}: ReviewSheetProps) {
  const basisLabel = review.basis === 'model_answer' ? '模範解答照合' : 'AI自力採点';

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3.5 sm:p-4 space-y-4">
      {/* Header Metadata (Zero-pill clean text separators) */}
      <div className="border-b border-slate-200 pb-2.5 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-semibold text-slate-900">添削結果レポート</h2>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 tabular-nums">
            <span className="font-medium text-slate-700">{review.subject}</span>
            <span aria-hidden="true">·</span>
            <span>{review.date}</span>
            <span aria-hidden="true">·</span>
            <span>{basisLabel}</span>
            <span aria-hidden="true">·</span>
            <span>全{review.questions.length}問</span>
          </div>
        </div>
      </div>

      {/* Low Confidence Notice */}
      {review.confidence_low && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2.5 text-xs sm:text-sm text-amber-900">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">判定に不確実な箇所が含まれています</p>
            <p className="text-xs text-amber-800 mt-0.5">
              採点に十分な確信が持てなかった問題については、誤登録を防ぐためノート・傾向への自動登録を見送っています。
            </p>
          </div>
        </div>
      )}

      {/* Question-by-Question Breakdown */}
      <div className="space-y-2.5">
        <h3 className="text-xs sm:text-sm font-semibold text-slate-800">問題ごとの添削</h3>
        <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg">
          {review.questions.map((q, index) => {
            const meta = getResultMeta(q.result);
            const StatusIcon = meta.Icon;

            return (
              <div key={`${q.label}-${index}`} className="p-2.5 sm:p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="text-sm font-semibold text-slate-900">{q.label}</span>
                    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${meta.textClass}`}>
                      <StatusIcon className="w-3.5 h-3.5" />
                      <span>{meta.label}</span>
                    </span>
                  </div>
                  <div className="text-xs text-slate-500">
                    原因: <span className="font-medium text-slate-700">{getCauseLabel(q.cause)}</span>
                  </div>
                </div>

                {q.error_location && (
                  <div className="bg-slate-50 border border-slate-200 rounded-md p-2.5 text-sm text-slate-700 leading-snug">
                    <div className="text-xs font-medium text-slate-500 mb-0.5">誤りの箇所・指摘</div>
                    <MathText text={q.error_location} />
                  </div>
                )}

                {((q.knowledge_headings && q.knowledge_headings.length > 0) ||
                  (q.tendency_names && q.tendency_names.length > 0)) && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                    {q.knowledge_headings && q.knowledge_headings.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 text-slate-600">
                        <span>知識ノート:</span>
                        {q.knowledge_headings.map((heading, hIdx) => (
                          <button
                            key={heading}
                            type="button"
                            onClick={() => onJumpToKnowledge?.(heading, review.subject)}
                            className="text-sky-700 hover:text-sky-900 underline underline-offset-2 font-medium cursor-pointer"
                          >
                            {heading}
                            {hIdx < (q.knowledge_headings?.length ?? 0) - 1 ? '、' : ''}
                          </button>
                        ))}
                      </div>
                    )}

                    {q.tendency_names && q.tendency_names.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 text-slate-600">
                        <span>不注意傾向:</span>
                        {q.tendency_names.map((tName, tIdx) => (
                          <button
                            key={tName}
                            type="button"
                            onClick={() => onJumpToTendency?.(tName)}
                            className="text-amber-700 hover:text-amber-900 underline underline-offset-2 font-medium cursor-pointer"
                          >
                            {tName}
                            {tIdx < (q.tendency_names?.length ?? 0) - 1 ? '、' : ''}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Past Relation */}
      {review.past_relation && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-0.5">
          <div className="text-xs font-semibold text-slate-700">過去との関連</div>
          <p className="text-sm text-slate-800 leading-snug">
            <MathText text={review.past_relation} />
          </p>
        </div>
      )}

      {/* Tutor Note */}
      {review.note && (
        <div className="space-y-1">
          <div className="text-xs font-semibold text-slate-700">チューターからのひとこと</div>
          <div className="text-sm text-slate-800 leading-snug">
            <MathText text={review.note} />
          </div>
        </div>
      )}

      {/* Registration Summary Line */}
      <div className="pt-2.5 border-t border-slate-200 space-y-1">
        <p className="text-xs font-medium text-slate-600 tabular-nums">{review.registration_line}</p>
        {review.discrepancy_note && (
          <p className="text-xs text-amber-700">
            整合性メモ: {review.discrepancy_note}
          </p>
        )}
      </div>
    </div>
  );
}
