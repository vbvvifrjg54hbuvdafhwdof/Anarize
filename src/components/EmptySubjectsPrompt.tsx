import { BookPlus, Plus } from 'lucide-react';
import { useState } from 'react';
import { addSubject } from '../services/storeService.ts';
import type { AppState } from '../types.ts';

interface EmptySubjectsPromptProps {
  onStateUpdated: (state: AppState) => void;
  compact?: boolean;
}

const PRESET_SUBJECTS = [
  '数学',
  '英語',
  '国語',
  '物理',
  '化学',
  '生物',
  '日本史',
  '世界史',
  '地理',
];

export function EmptySubjectsPrompt({
  onStateUpdated,
  compact = false,
}: EmptySubjectsPromptProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleAdd = async (subjectName: string) => {
    const clean = subjectName.trim();
    if (!clean || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await addSubject(clean);
      if (!res.ok || !res.state) {
        setError(res.error ?? '科目の追加に失敗しました。');
        return;
      }
      setName('');
      onStateUpdated(res.state);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`bg-white border border-slate-200 rounded-xl ${
        compact ? 'p-3.5 space-y-3' : 'p-4 sm:p-5 space-y-3.5'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <BookPlus className="w-5 h-5 text-blue-900 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-slate-900">
            最初に、科目を作ってください
          </h2>
          <p className="text-xs text-slate-600 leading-snug">
            学習する科目を1つ以上追加すると、答案の添削・知識ノート・傾向の記録・出力が使えるようになります。科目はあとから設定画面で追加・変更・削除できます。
          </p>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleAdd(name);
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="科目名を入力（例: 数学、英語）"
          disabled={busy}
          className="flex-1 min-h-[max(44px,2.75rem)] rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder:text-slate-400"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="min-h-[max(44px,2.75rem)] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-900 text-white text-xs font-semibold hover:bg-blue-950 disabled:bg-slate-300 cursor-pointer whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>追加</span>
        </button>
      </form>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-800">
          {error}
        </div>
      )}

      <div className="space-y-1.5 pt-1 border-t border-slate-100">
        <div className="text-xs font-medium text-slate-500">
          候補から追加（タップした科目だけ作成されます）
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_SUBJECTS.map((sub) => (
            <button
              key={sub}
              type="button"
              disabled={busy}
              onClick={() => void handleAdd(sub)}
              className="min-h-[max(44px,2.75rem)] inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-300 bg-slate-50 hover:bg-blue-50 hover:border-blue-800 text-xs font-medium text-slate-800 cursor-pointer transition-colors"
            >
              <Plus className="w-3 h-3 text-blue-900" />
              <span>{sub}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
