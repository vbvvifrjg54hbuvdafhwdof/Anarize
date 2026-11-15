import { Download, FileText, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { getTodayJST } from '../services/storeService.ts';
import type { AppState, KnowledgeItem, Tendency } from '../types.ts';
import { MathText } from './MathText.tsx';

interface ExportViewProps {
  state: AppState;
}

type ExportTab = 'pdf' | 'anki';
type PdfDisplayMode = 'detailed' | 'compact' | 'redsheet';
type PdfPaperSize = 'A4' | 'B5' | 'Letter';
type PdfFontSize = 'sm' | 'md' | 'lg';
type PdfMargin = 'normal' | 'narrow';

function sanitizeForTsvCell(text: string): string {
  return text
    .replace(/\t/g, ' ')
    .replace(/\r\n/g, '<br>')
    .replace(/\n/g, '<br>')
    .replace(/\r/g, '<br>')
    .trim();
}

function buildAnkiTag(folderPath: string): string {
  const parts = folderPath.split('/').filter(Boolean);
  if (parts.length === 0) return '添削ノート';
  if (parts.length === 1) return parts[0].replace(/\s+/g, '_');
  const cleanParts = parts.map((p) => p.replace(/\s+/g, '_'));
  return `${cleanParts[0]} ${cleanParts.join('::')}`;
}

export function ExportView({ state }: ExportViewProps) {
  const [activeTab, setActiveTab] = useState<ExportTab>('pdf');

  // Shared range selection
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>(() => [...state.subjects]);
  const [selectedFolder, setSelectedFolder] = useState<string>('ALL');
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  // PDF options
  const [pdfMode, setPdfMode] = useState<PdfDisplayMode>('detailed');
  const [paperSize, setPaperSize] = useState<PdfPaperSize>('A4');
  const [fontSize, setFontSize] = useState<PdfFontSize>('md');
  const [marginSize, setMarginSize] = useState<PdfMargin>('normal');
  const [includeTendencies, setIncludeTendencies] = useState(true);
  const [includeHiddenTendencies, setIncludeHiddenTendencies] = useState(false);

  const toggleSubject = (sub: string) => {
    setSelectedSubjects((prev) =>
      prev.includes(sub) ? prev.filter((s) => s !== sub) : [...prev, sub]
    );
  };

  const availableFolders = useMemo(() => {
    return state.folders
      .filter((f) => selectedSubjects.some((s) => f.startsWith(`${s}/`)))
      .sort((a, b) => a.localeCompare(b, 'ja'));
  }, [state.folders, selectedSubjects]);

  const filteredItems: KnowledgeItem[] = useMemo(() => {
    return state.items
      .filter((item) => {
        if (item.hidden) return false;
        if (verifiedOnly && !item.verified) return false;
        const subject = item.folder_path.split('/')[0];
        if (!selectedSubjects.includes(subject)) return false;
        if (
          selectedFolder !== 'ALL' &&
          item.folder_path !== selectedFolder &&
          !item.folder_path.startsWith(`${selectedFolder}/`)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const folderCmp = a.folder_path.localeCompare(b.folder_path, 'ja');
        if (folderCmp !== 0) return folderCmp;
        return b.mistake_count - a.mistake_count;
      });
  }, [state.items, selectedSubjects, selectedFolder, verifiedOnly]);

  const filteredTendencies: Tendency[] = useMemo(() => {
    if (!includeTendencies) return [];
    return state.tendencies.filter((t) => {
      if (!includeHiddenTendencies && t.hidden) return false;
      return t.subjects.some((s) => selectedSubjects.includes(s));
    });
  }, [state.tendencies, includeTendencies, includeHiddenTendencies, selectedSubjects]);

  const ankiRows = useMemo(() => {
    return filteredItems.map((item) => ({
      front: sanitizeForTsvCell(item.heading),
      back: sanitizeForTsvCell(item.explanation),
      tags: buildAnkiTag(item.folder_path),
      guid: item.id,
      rawHeading: item.heading,
      rawFolder: item.folder_path,
    }));
  }, [filteredItems]);

  const handleDownloadAnkiTsv = () => {
    const header = [
      '#separator:tab',
      '#html:true',
      '#tags column:3',
      '#guid column:4',
    ];
    const body = ankiRows.map((r) => `${r.front}\t${r.back}\t${r.tags}\t${r.guid}`);
    const content = [...header, ...body].join('\n');
    const blob = new Blob([content], { type: 'text/tab-separated-values;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `anki_tensaku_${getTodayJST()}.tsv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const fontSizeClass =
    fontSize === 'sm' ? 'text-xs' : fontSize === 'lg' ? 'text-base' : 'text-sm';

  const pageCss = `@page { size: ${paperSize}; margin: ${marginSize === 'narrow' ? '10mm' : '18mm'}; }`;

  // Group items by folder_path for detailed view
  const groupedByFolder = useMemo(() => {
    const map = new Map<string, KnowledgeItem[]>();
    for (const item of filteredItems) {
      const list = map.get(item.folder_path) ?? [];
      list.push(item);
      map.set(item.folder_path, list);
    }
    return Array.from(map.entries());
  }, [filteredItems]);

  return (
    <div className="space-y-6">
      <style>{pageCss}</style>

      {/* Top Mode Switcher (hidden on print) */}
      <div className="no-print bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setActiveTab('pdf')}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === 'pdf'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Printer className="w-3.5 h-3.5" />
            <span>PDF出力（印刷）</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('anki')}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === 'anki'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Anki用 TSV出力</span>
          </button>
        </div>

        {activeTab === 'pdf' ? (
          <button
            type="button"
            onClick={() => window.print()}
            disabled={filteredItems.length === 0 && filteredTendencies.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-700 text-white text-xs font-semibold hover:bg-sky-800 disabled:bg-slate-300 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>PDFとして保存 / 印刷</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleDownloadAnkiTsv}
            disabled={ankiRows.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-700 text-white text-xs font-semibold hover:bg-sky-800 disabled:bg-slate-300 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Anki用TSVをダウンロード（{ankiRows.length}件）</span>
          </button>
        )}
      </div>

      {/* Range & Format Options (hidden on print) */}
      <div className="no-print bg-white border border-slate-200 rounded-xl p-5 space-y-5">
        {/* Range Selection */}
        <div className="space-y-3">
          <div className="text-sm font-semibold text-slate-900">1. 出力範囲の選択</div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-600 mr-1">科目:</span>
            {state.subjects.map((sub) => {
              const active = selectedSubjects.includes(sub);
              return (
                <button
                  key={sub}
                  type="button"
                  onClick={() => toggleSubject(sub)}
                  className={`px-3 py-1 rounded-md border text-xs font-medium cursor-pointer transition-colors ${
                    active
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {sub}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs">
            <label className="flex items-center gap-2">
              <span className="text-slate-600 font-medium">単元フォルダ:</span>
              <select
                value={selectedFolder}
                onChange={(e) => setSelectedFolder(e.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-900 bg-white"
              >
                <option value="ALL">すべての単元</option>
                {availableFolders.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={verifiedOnly}
                onChange={(e) => setVerifiedOnly(e.target.checked)}
                className="rounded border-slate-300 text-sky-700"
              />
              <span className="text-slate-700">「確認済み」の知識項目のみ出力</span>
            </label>
          </div>
        </div>

        {/* PDF Specific Settings */}
        {activeTab === 'pdf' && (
          <div className="border-t border-slate-200 pt-4 space-y-4">
            <div className="text-sm font-semibold text-slate-900">2. PDFレイアウト・サイズ・傾向ログ</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="space-y-1.5">
                <span className="text-slate-600 font-medium block">表示モード</span>
                <select
                  value={pdfMode}
                  onChange={(e) => setPdfMode(e.target.value as PdfDisplayMode)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 bg-white"
                >
                  <option value="detailed">詳細復習シート（単元別・ミス回数付き）</option>
                  <option value="compact">コンパクト一覧（2列詰め暗記用）</option>
                  <option value="redsheet">赤シート対応（解説を薄朱色表示）</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <span className="text-slate-600 font-medium block">用紙サイズ・余白</span>
                <div className="flex gap-2">
                  <select
                    value={paperSize}
                    onChange={(e) => setPaperSize(e.target.value as PdfPaperSize)}
                    aria-label="用紙サイズ"
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 bg-white"
                  >
                    <option value="A4">A4</option>
                    <option value="B5">B5</option>
                    <option value="Letter">Letter</option>
                  </select>
                  <select
                    value={marginSize}
                    onChange={(e) => setMarginSize(e.target.value as PdfMargin)}
                    aria-label="余白"
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 bg-white"
                  >
                    <option value="normal">余白: 標準</option>
                    <option value="narrow">余白: 狭め</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-slate-600 font-medium block">文字サイズ</span>
                <select
                  value={fontSize}
                  onChange={(e) => setFontSize(e.target.value as PdfFontSize)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 bg-white"
                >
                  <option value="sm">小（情報量優先）</option>
                  <option value="md">標準</option>
                  <option value="lg">大（読みやすさ優先）</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-6 text-xs pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeTendencies}
                  onChange={(e) => setIncludeTendencies(e.target.checked)}
                  className="rounded border-slate-300 text-sky-700"
                />
                <span className="font-medium text-slate-800">不注意ミスの傾向ログを含める</span>
              </label>

              {includeTendencies && (
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeHiddenTendencies}
                    onChange={(e) => setIncludeHiddenTendencies(e.target.checked)}
                    className="rounded border-slate-300 text-sky-700"
                  />
                  <span className="text-slate-600">非表示中の傾向も含める</span>
                </label>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Preview Area */}
      {activeTab === 'pdf' ? (
        <div
          className={`print-only-container bg-white border border-slate-200 rounded-xl p-8 space-y-6 ${fontSizeClass}`}
        >
          <div className="border-b border-slate-300 pb-3 flex items-baseline justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">復習ノート・弱点まとめ</h2>
              <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
                出力日: {getTodayJST()} · 対象科目: {selectedSubjects.join(' / ') || 'なし'} · 知識項目{' '}
                {filteredItems.length}件
                {includeTendencies ? ` · 傾向ログ ${filteredTendencies.length}件` : ''}
              </div>
            </div>
            <div className="text-xs text-slate-400 tabular-nums">
              {paperSize} / {pdfMode === 'compact' ? 'コンパクト' : pdfMode === 'redsheet' ? '赤シート対応' : '詳細'}
            </div>
          </div>

          {filteredItems.length === 0 && filteredTendencies.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">
              選択された条件に該当する出力データがありません。
            </p>
          ) : (
            <>
              {filteredItems.length > 0 && (
                <section className="space-y-4">
                  <h3 className="text-sm font-bold text-slate-900 border-b border-slate-200 pb-1">
                    知識項目（単元別）
                  </h3>

                  {pdfMode === 'compact' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {filteredItems.map((item) => (
                        <div
                          key={item.id}
                          className="border border-slate-200 rounded-md p-2.5 space-y-1 break-inside-avoid"
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="font-semibold text-slate-900">{item.heading}</span>
                            <span className="text-[11px] text-slate-500 tabular-nums shrink-0">
                              {item.folder_path} ({item.mistake_count})
                            </span>
                          </div>
                          <div className="text-slate-700 leading-snug">
                            <MathText text={item.explanation} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-5">
                      {groupedByFolder.map(([folderPath, items]) => (
                        <div key={folderPath} className="space-y-2">
                          <h4 className="text-xs font-bold text-slate-700 bg-slate-100 px-2.5 py-1 rounded">
                            {folderPath}
                          </h4>
                          <div className="divide-y divide-slate-200 border border-slate-200 rounded-md">
                            {items.map((item) => (
                              <div
                                key={item.id}
                                className="p-3 space-y-1 break-inside-avoid"
                              >
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className="font-semibold text-slate-900">
                                    {item.heading}
                                  </span>
                                  <span className="text-xs text-slate-500 tabular-nums">
                                    ミス {item.mistake_count}回
                                  </span>
                                </div>
                                <div
                                  className={`leading-relaxed ${
                                    pdfMode === 'redsheet'
                                      ? 'text-orange-400'
                                      : 'text-slate-700'
                                  }`}
                                >
                                  <MathText text={item.explanation} />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {includeTendencies && filteredTendencies.length > 0 && (
                <section className="space-y-3 pt-2">
                  <h3 className="text-sm font-bold text-slate-900 border-b border-slate-200 pb-1">
                    不注意ミスの傾向ログ
                  </h3>
                  <div className="divide-y divide-slate-200 border border-slate-200 rounded-md">
                    {filteredTendencies.map((t) => (
                      <div key={t.tendency_id} className="p-3 space-y-1 break-inside-avoid">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="font-semibold text-slate-900">
                            {t.name}
                            {t.hidden ? '（非表示）' : ''}
                          </span>
                          <span className="text-xs text-slate-500 tabular-nums">
                            {t.category} · {t.subjects.join('/')} · 計{t.occurrences.length}回
                          </span>
                        </div>
                        {t.occurrences[0] && (
                          <div className="text-xs text-slate-600">
                            直近例 ({t.occurrences[0].date} {t.occurrences[0].subject}/
                            {t.occurrences[0].unit}): {t.occurrences[0].situation}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-slate-900">Anki用 TSV プレビュー</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              先頭に <code className="bg-slate-100 px-1 rounded">#separator:tab</code>、
              <code className="bg-slate-100 px-1 rounded">#html:true</code>、タグ列指定、GUID列指定を付与し、改行は{' '}
              <code className="bg-slate-100 px-1 rounded">&lt;br&gt;</code> に変換して出力します。Anki 側の「ファイルを読み込む」でそのままインポートできます。
            </p>
          </div>

          {ankiRows.length === 0 ? (
            <p className="text-sm text-slate-500 py-8 text-center">
              出力対象の知識項目がありません。
            </p>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2.5 px-3 font-semibold">表面（見出し）</th>
                    <th className="py-2.5 px-3 font-semibold">裏面（解説）</th>
                    <th className="py-2.5 px-3 font-semibold">タグ列</th>
                    <th className="py-2.5 px-3 font-semibold">GUID列</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ankiRows.slice(0, 50).map((row) => (
                    <tr key={row.guid} className="align-top">
                      <td className="py-2.5 px-3 font-medium text-slate-900 whitespace-nowrap">
                        {row.front}
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 max-w-md break-words font-mono text-[11px]">
                        {row.back}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 font-mono text-[11px] whitespace-nowrap">
                        {row.tags}
                      </td>
                      <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                        {row.guid}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
