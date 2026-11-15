import { db, type MetaRecord } from '../db/database.ts';
import type {
  AppLimits,
  AppState,
  ExportDataBundle,
  ImportPreviewCounts,
  KnowledgeItem,
  OperationLogEntry,
  OrganizationMode,
  PdfExportSettings,
} from '../types.ts';

const API_KEY_STORAGE_KEY = 'anarize_gemini_api_key';

export const DEFAULT_LIMITS: AppLimits = {
  maxHeadingLength: 40,
  maxTendencyNameLength: 30,
  maxExplanationLength: 200,
  maxSituationLength: 60,
  maxReasonLength: 60,
  maxSavePerReview: 5,
  maxTendencyPerReview: 5,
  maxNoteLength: 300,
  maxToolRounds: 6,
  maxPdfPages: 5,
  autoHideTendencyReviews: 5,
};

export const DEFAULT_PDF_SETTINGS: PdfExportSettings = {
  displayMode: 'normal',
  includeTendencies: true,
  includeToc: true,
  pageBreakPerUnit: false,
  sortBy: 'folder',
  showMistakeCount: true,
  paperSize: 'A4',
  orientation: 'portrait',
  fontSize: 'md',
  columns: 1,
  itemsPerPage: 'auto',
  margin: 'normal',
};

function createInitialMeta(): MetaRecord {
  return {
    key: 'workspace',
    subjects: ['数学', '英語', '国語', '物理', '日本史'],
    folders: [
      '数学/三角関数',
      '数学/二次関数',
      '数学/微分積分',
      '英語/仮定法',
      '英語/関係詞',
      '国語/古文単語',
      '物理/力学',
      '日本史/近代史',
    ],
    mode: '確認',
    limits: { ...DEFAULT_LIMITS },
    pdfSettings: { ...DEFAULT_PDF_SETTINGS },
    consentAccepted: false,
    installGuideDismissed: false,
  };
}

export function getApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setApiKey(key: string): void {
  const clean = key.trim();
  if (!clean) {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
    return;
  }
  localStorage.setItem(API_KEY_STORAGE_KEY, clean);
}

export function clearApiKey(): void {
  localStorage.removeItem(API_KEY_STORAGE_KEY);
}

export async function requestStoragePersistence(): Promise<boolean> {
  try {
    if (navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    // ignore
  }
  return false;
}

export async function checkStoragePersisted(): Promise<boolean> {
  try {
    if (navigator.storage && navigator.storage.persisted) {
      return await navigator.storage.persisted();
    }
  } catch {
    // ignore
  }
  return false;
}

export function normalizePath(rawPath: string): string {
  return rawPath
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/');
}

export function splitPath(rawPath: string): string[] {
  const norm = normalizePath(rawPath);
  if (!norm) return [];
  return norm.split('/');
}

export function generateId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const ts = Date.now().toString(36).slice(-4);
  return `${prefix}_${ts}${rand}`;
}

export function getTodayJST(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

export function ensureFolderExistsInState(state: AppState, folderPath: string): void {
  const parts = splitPath(folderPath);
  if (parts.length <= 1) return;
  for (let i = 2; i <= parts.length; i++) {
    const subPath = parts.slice(0, i).join('/');
    if (!state.folders.includes(subPath)) {
      state.folders.push(subPath);
    }
  }
}

export function appendLog(state: AppState, action: string, detail: string): void {
  const entry: OperationLogEntry = {
    id: generateId('log'),
    timestamp: new Date().toISOString(),
    action,
    detail,
  };
  state.logs.unshift(entry);
  if (state.logs.length > 300) {
    state.logs = state.logs.slice(0, 300);
  }
}

/**
 * Per-subject consecutive-review tendency auto-hide:
 * If `autoHideTendencyReviews > 0`, and subject `S` has at least N consecutive reviews
 * after a tendency's latest occurrence in `S` (or `unhidden_at`) with none containing it,
 * remove `S` from `visible_in`, and mark `hidden = true` when `visible_in` becomes empty.
 */
export function applyAutoHideTendenciesForSubject(state: AppState, subject: string): boolean {
  const n = state.limits.autoHideTendencyReviews;
  if (!n || n <= 0) return false;

  const subjectReviews = state.reviews
    .filter((r) => r.subject === subject)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  if (subjectReviews.length < n) return false;

  const reviewCreatedMap = new Map(subjectReviews.map((r) => [r.review_id, r.created_at]));
  let changed = false;

  for (const t of state.tendencies) {
    if (t.hidden) continue;
    const activeInSubject =
      t.visible_in.includes(subject) || (t.visible_in.length === 0 && t.subjects.includes(subject));
    if (!activeInSubject) continue;

    const occReviewIds = new Set(
      t.occurrences
        .filter((occ) => occ.subject === subject && occ.review_id)
        .map((occ) => occ.review_id as string)
    );

    let baseline = t.created_at;
    for (const occ of t.occurrences) {
      if (occ.subject !== subject) continue;
      const revTime = occ.review_id ? reviewCreatedMap.get(occ.review_id) : undefined;
      const candidate = revTime ?? `${occ.date}T00:00:00.000Z`;
      if (candidate > baseline) baseline = candidate;
    }
    if (t.unhidden_at && t.unhidden_at > baseline) {
      baseline = t.unhidden_at;
    }

    let consecutiveWithout = 0;
    for (const r of subjectReviews) {
      if (occReviewIds.has(r.review_id)) break;
      if (r.created_at > baseline) {
        consecutiveWithout += 1;
      } else {
        break;
      }
    }

    if (consecutiveWithout >= n) {
      t.visible_in = t.visible_in.filter((s) => s !== subject);
      if (t.visible_in.length === 0) {
        t.hidden = true;
        appendLog(
          state,
          '傾向自動非表示',
          `「${t.name}」は${subject}の添削で連続${n}回発生しなかったため非表示にしました`
        );
      }
      changed = true;
    }
  }

  return changed;
}

export async function loadState(): Promise<AppState> {
  let meta = await db.meta.get('workspace');
  if (!meta) {
    meta = createInitialMeta();
    await db.meta.put(meta);
  }

  const [items, tendencies, reviews, proposals, logs] = await Promise.all([
    db.items.toArray(),
    db.tendencies.toArray(),
    db.reviews.toArray(),
    db.proposals.toArray(),
    db.logs.toArray(),
  ]);

  reviews.sort((a, b) => b.created_at.localeCompare(a.created_at));
  proposals.sort((a, b) => b.created_at.localeCompare(a.created_at));
  logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const state: AppState = {
    subjects: meta.subjects.length > 0 ? meta.subjects : createInitialMeta().subjects,
    folders: meta.folders ?? [],
    items,
    tendencies,
    reviews,
    proposals,
    logs,
    mode: meta.mode === '一任' || meta.mode === '確認' ? meta.mode : '確認',
    limits: { ...DEFAULT_LIMITS, ...(meta.limits ?? {}) },
    pdfSettings: { ...DEFAULT_PDF_SETTINGS, ...(meta.pdfSettings ?? {}) },
    consentAccepted: Boolean(meta.consentAccepted),
    consentAcceptedAt: meta.consentAcceptedAt,
    installGuideDismissed: Boolean(meta.installGuideDismissed),
  };

  return state;
}

export async function saveState(state: AppState): Promise<void> {
  const meta: MetaRecord = {
    key: 'workspace',
    subjects: state.subjects,
    folders: state.folders,
    mode: state.mode,
    limits: state.limits,
    pdfSettings: state.pdfSettings,
    consentAccepted: state.consentAccepted,
    consentAcceptedAt: state.consentAcceptedAt,
    installGuideDismissed: state.installGuideDismissed,
  };

  await db.transaction(
    'rw',
    [db.meta, db.items, db.tendencies, db.reviews, db.proposals, db.logs],
    async () => {
      await db.meta.put(meta);
      await db.items.clear();
      if (state.items.length > 0) await db.items.bulkPut(state.items);
      await db.tendencies.clear();
      if (state.tendencies.length > 0) await db.tendencies.bulkPut(state.tendencies);
      await db.reviews.clear();
      if (state.reviews.length > 0) await db.reviews.bulkPut(state.reviews);
      await db.proposals.clear();
      if (state.proposals.length > 0) await db.proposals.bulkPut(state.proposals);
      await db.logs.clear();
      if (state.logs.length > 0) await db.logs.bulkPut(state.logs);
    }
  );
}

export async function acceptConsent(): Promise<AppState> {
  const state = await loadState();
  state.consentAccepted = true;
  state.consentAcceptedAt = new Date().toISOString();
  appendLog(state, '利用同意', 'Googleへの答案送信に関する同意を保存しました');
  await saveState(state);
  return state;
}

export async function dismissInstallGuide(): Promise<AppState> {
  const state = await loadState();
  state.installGuideDismissed = true;
  await saveState(state);
  return state;
}

export async function setMode(mode: OrganizationMode): Promise<AppState> {
  const state = await loadState();
  state.mode = mode;
  appendLog(state, 'モード変更', `整理モードを「${mode}」に変更`);
  await saveState(state);
  return state;
}

export async function updateLimits(limits: Partial<AppLimits>): Promise<AppState> {
  const state = await loadState();
  state.limits = { ...state.limits, ...limits };
  appendLog(state, '設定更新', '登録・呼び出し上限を更新しました');
  await saveState(state);
  return state;
}

export async function updatePdfSettings(pdfSettings: PdfExportSettings): Promise<AppState> {
  const state = await loadState();
  state.pdfSettings = { ...pdfSettings };
  await saveState(state);
  return state;
}

export async function addSubject(name: string): Promise<{ ok: boolean; error?: string; state?: AppState }> {
  const clean = name.trim();
  if (!clean) return { ok: false, error: '科目名を入力してください。' };
  if (clean.includes('/')) return { ok: false, error: '科目名に「/」は使えません。' };
  if (clean.length > 20) return { ok: false, error: '科目名は20文字以内にしてください。' };
  const state = await loadState();
  if (state.subjects.includes(clean)) {
    return { ok: false, error: '同じ科目名が既に存在します。' };
  }
  state.subjects.push(clean);
  appendLog(state, '科目追加', `科目「${clean}」を追加`);
  await saveState(state);
  return { ok: true, state };
}

export async function renameSubject(
  oldName: string,
  newName: string
): Promise<{ ok: boolean; error?: string; state?: AppState }> {
  const cleanNew = newName.trim();
  if (!cleanNew) return { ok: false, error: '新しい科目名を入力してください。' };
  if (cleanNew.includes('/')) return { ok: false, error: '科目名に「/」は使えません。' };
  if (cleanNew.length > 20) return { ok: false, error: '科目名は20文字以内にしてください。' };

  const state = await loadState();
  const idx = state.subjects.indexOf(oldName);
  if (idx === -1) return { ok: false, error: '対象の科目が見つかりません。' };
  if (oldName !== cleanNew && state.subjects.includes(cleanNew)) {
    return { ok: false, error: '同じ科目名が既に存在します。' };
  }

  state.subjects[idx] = cleanNew;
  state.folders = state.folders.map((f) => {
    if (f === oldName) return cleanNew;
    if (f.startsWith(`${oldName}/`)) return `${cleanNew}${f.slice(oldName.length)}`;
    return f;
  });
  state.items = state.items.map((item) => {
    if (item.folder_path === oldName) return { ...item, folder_path: cleanNew };
    if (item.folder_path.startsWith(`${oldName}/`)) {
      return { ...item, folder_path: `${cleanNew}${item.folder_path.slice(oldName.length)}` };
    }
    return item;
  });
  state.tendencies = state.tendencies.map((t) => ({
    ...t,
    subjects: t.subjects.map((s) => (s === oldName ? cleanNew : s)),
    visible_in: t.visible_in.map((s) => (s === oldName ? cleanNew : s)),
    occurrences: t.occurrences.map((o) => (o.subject === oldName ? { ...o, subject: cleanNew } : o)),
  }));
  state.reviews = state.reviews.map((r) => (r.subject === oldName ? { ...r, subject: cleanNew } : r));

  appendLog(state, '科目名変更', `「${oldName}」→「${cleanNew}」`);
  await saveState(state);
  return { ok: true, state };
}

export async function deleteSubject(name: string): Promise<{ ok: boolean; error?: string; state?: AppState }> {
  const state = await loadState();
  if (!state.subjects.includes(name)) return { ok: false, error: '対象の科目が見つかりません。' };
  const hasItems = state.items.some(
    (i) => !i.hidden && (i.folder_path === name || i.folder_path.startsWith(`${name}/`))
  );
  if (hasItems) {
    return { ok: false, error: '知識項目が残っている科目は削除できません。項目を移動してから削除してください。' };
  }
  state.subjects = state.subjects.filter((s) => s !== name);
  state.folders = state.folders.filter((f) => f !== name && !f.startsWith(`${name}/`));
  appendLog(state, '科目削除', `科目「${name}」を削除`);
  await saveState(state);
  return { ok: true, state };
}

export async function createUserFolder(folderPath: string): Promise<{ ok: boolean; error?: string; state?: AppState }> {
  const norm = normalizePath(folderPath);
  const parts = splitPath(norm);
  if (parts.length < 2) return { ok: false, error: '科目の下の単元フォルダ名を指定してください。' };
  if (parts.length > 3) return { ok: false, error: 'フォルダ階層は科目の下に最大2段までです。' };
  if (parts[parts.length - 1].length > 40) return { ok: false, error: 'フォルダ名は40文字以内にしてください。' };

  const state = await loadState();
  if (!state.subjects.includes(parts[0])) return { ok: false, error: '指定された科目が存在しません。' };
  if (state.folders.includes(norm)) return { ok: false, error: '同じフォルダが既に存在します。' };

  ensureFolderExistsInState(state, norm);
  appendLog(state, 'フォルダ作成', norm);
  await saveState(state);
  return { ok: true, state };
}

export async function updateKnowledgeItem(
  itemId: string,
  updates: Partial<Pick<KnowledgeItem, 'heading' | 'explanation' | 'folder_path' | 'verified' | 'hidden'>>
): Promise<{ ok: boolean; error?: string; state?: AppState }> {
  const state = await loadState();
  const idx = state.items.findIndex((i) => i.id === itemId);
  if (idx === -1) return { ok: false, error: '対象の知識項目が見つかりません。' };
  const item = state.items[idx];

  const nextHeading = updates.heading !== undefined ? updates.heading.trim() : item.heading;
  const nextExplanation = updates.explanation !== undefined ? updates.explanation.trim() : item.explanation;
  const nextFolder = updates.folder_path !== undefined ? normalizePath(updates.folder_path) : item.folder_path;

  if (!nextHeading || nextHeading.length > state.limits.maxHeadingLength) {
    return { ok: false, error: `見出しは1〜${state.limits.maxHeadingLength}文字にしてください。` };
  }
  if (!nextExplanation || nextExplanation.length > state.limits.maxExplanationLength) {
    return { ok: false, error: `解説は1〜${state.limits.maxExplanationLength}文字にしてください。` };
  }

  const parts = splitPath(nextFolder);
  if (parts.length < 2 || parts.length > 3 || !state.subjects.includes(parts[0])) {
    return { ok: false, error: '移動先のフォルダパスが不正です（科目の下1〜2段）。' };
  }

  const duplicate = state.items.find(
    (other) =>
      other.id !== itemId &&
      !other.hidden &&
      other.folder_path === nextFolder &&
      other.heading === nextHeading
  );
  if (duplicate) {
    return { ok: false, error: '同じフォルダに同じ見出しの項目が既に存在します。' };
  }

  ensureFolderExistsInState(state, nextFolder);
  state.items[idx] = {
    ...item,
    heading: nextHeading,
    explanation: nextExplanation,
    folder_path: nextFolder,
    verified: updates.verified !== undefined ? updates.verified : item.verified,
    hidden: updates.hidden !== undefined ? updates.hidden : item.hidden,
    merged_into_id: updates.hidden === false ? undefined : item.merged_into_id,
    updated_at: new Date().toISOString(),
  };

  if (updates.hidden === false && item.hidden) {
    appendLog(state, '項目復元', `${nextFolder}/${nextHeading}`);
  } else if (updates.heading !== undefined || updates.explanation !== undefined) {
    appendLog(state, '項目編集', `${nextFolder}/${nextHeading}`);
  } else if (updates.verified !== undefined) {
    appendLog(state, '正確性確認', `${nextFolder}/${nextHeading}: ${updates.verified ? '確認済み' : '未確認'}`);
  }

  await saveState(state);
  return { ok: true, state };
}

export async function toggleTendencyHidden(
  tendencyId: string,
  hidden: boolean
): Promise<{ ok: boolean; error?: string; state?: AppState }> {
  const state = await loadState();
  const idx = state.tendencies.findIndex((t) => t.tendency_id === tendencyId);
  if (idx === -1) return { ok: false, error: '対象の傾向が見つかりません。' };
  const target = state.tendencies[idx];
  const now = new Date().toISOString();
  state.tendencies[idx] = {
    ...target,
    hidden,
    visible_in: !hidden ? Array.from(new Set([...target.visible_in, ...target.subjects])) : target.visible_in,
    unhidden_at: !hidden ? now : target.unhidden_at,
    updated_at: now,
  };
  appendLog(state, hidden ? '傾向非表示' : '傾向再表示', target.name);
  await saveState(state);
  return { ok: true, state };
}

export async function exportAllDataBundle(): Promise<ExportDataBundle> {
  const state = await loadState();
  appendLog(state, 'バックアップ出力', `項目${state.items.length}件・傾向${state.tendencies.length}件を出力`);
  await saveState(state);
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    subjects: state.subjects,
    folders: state.folders,
    items: state.items,
    tendencies: state.tendencies,
    reviews: state.reviews,
    proposals: state.proposals,
    logs: state.logs,
    mode: state.mode,
    limits: state.limits,
    pdfSettings: state.pdfSettings,
  };
}

export function parseAndPreviewImportBundle(rawJson: string): {
  ok: boolean;
  error?: string;
  bundle?: ExportDataBundle;
  counts?: ImportPreviewCounts;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { ok: false, error: 'JSON ファイルの形式が正しくありません。' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'バックアップデータの形式が不正です。' };
  }

  const b = parsed as Partial<ExportDataBundle>;
  if (!Array.isArray(b.subjects) || b.subjects.length === 0) {
    return { ok: false, error: '科目データ（subjects）が含まれていません。' };
  }
  if (
    !Array.isArray(b.folders) ||
    !Array.isArray(b.items) ||
    !Array.isArray(b.tendencies) ||
    !Array.isArray(b.reviews)
  ) {
    return { ok: false, error: 'バックアップファイルの必須項目が不足しています。' };
  }

  const bundle: ExportDataBundle = {
    version: typeof b.version === 'number' ? b.version : 1,
    exportedAt: String(b.exportedAt ?? ''),
    subjects: b.subjects.map((s) => String(s)),
    folders: b.folders.map((f) => String(f)),
    items: b.items,
    tendencies: b.tendencies,
    reviews: b.reviews,
    proposals: Array.isArray(b.proposals) ? b.proposals : [],
    logs: Array.isArray(b.logs) ? b.logs : [],
    mode: b.mode === '一任' || b.mode === '確認' ? b.mode : '確認',
    limits: { ...DEFAULT_LIMITS, ...(b.limits ?? {}) },
    pdfSettings: b.pdfSettings ? { ...DEFAULT_PDF_SETTINGS, ...b.pdfSettings } : undefined,
  };

  return {
    ok: true,
    bundle,
    counts: {
      subjects: bundle.subjects.length,
      folders: bundle.folders.length,
      items: bundle.items.length,
      tendencies: bundle.tendencies.length,
      reviews: bundle.reviews.length,
      proposals: bundle.proposals.length,
      logs: bundle.logs.length,
    },
  };
}

export async function executeImportBundle(
  bundle: ExportDataBundle,
  strategy: 'overwrite' | 'merge'
): Promise<AppState> {
  const current = await loadState();

  if (strategy === 'overwrite') {
    const nextState: AppState = {
      subjects: bundle.subjects,
      folders: bundle.folders,
      items: bundle.items,
      tendencies: bundle.tendencies,
      reviews: bundle.reviews,
      proposals: bundle.proposals,
      logs: bundle.logs,
      mode: bundle.mode,
      limits: bundle.limits,
      pdfSettings: bundle.pdfSettings ?? current.pdfSettings,
      consentAccepted: current.consentAccepted,
      consentAcceptedAt: current.consentAcceptedAt,
      installGuideDismissed: current.installGuideDismissed,
    };
    appendLog(nextState, 'バックアップ復元（上書き）', `項目${bundle.items.length}件を読み込みました`);
    await saveState(nextState);
    return nextState;
  }

  // Merge strategy: union by ID / unique path+heading
  const mergedSubjects = Array.from(new Set([...current.subjects, ...bundle.subjects]));
  const mergedFolders = Array.from(new Set([...current.folders, ...bundle.folders]));

  const itemMap = new Map(current.items.map((i) => [i.id, i]));
  for (const incoming of bundle.items) {
    const byId = itemMap.get(incoming.id);
    if (byId) {
      if (incoming.updated_at > byId.updated_at) itemMap.set(incoming.id, incoming);
    } else {
      const sameKey = Array.from(itemMap.values()).find(
        (ex) => !ex.hidden && !incoming.hidden && ex.folder_path === incoming.folder_path && ex.heading === incoming.heading
      );
      if (sameKey) {
        sameKey.mistake_count = Math.max(sameKey.mistake_count, incoming.mistake_count);
      } else {
        itemMap.set(incoming.id, incoming);
      }
    }
  }

  const tendMap = new Map(current.tendencies.map((t) => [t.tendency_id, t]));
  for (const incoming of bundle.tendencies) {
    const existing = tendMap.get(incoming.tendency_id);
    if (!existing) {
      tendMap.set(incoming.tendency_id, incoming);
    } else {
      const occIds = new Set(existing.occurrences.map((o) => o.id));
      for (const occ of incoming.occurrences) {
        if (!occIds.has(occ.id)) existing.occurrences.push(occ);
      }
      existing.occurrences.sort((a, b) => b.date.localeCompare(a.date));
      existing.subjects = Array.from(new Set([...existing.subjects, ...incoming.subjects]));
      existing.visible_in = Array.from(new Set([...existing.visible_in, ...incoming.visible_in]));
    }
  }

  const revMap = new Map(current.reviews.map((r) => [r.review_id, r]));
  for (const r of bundle.reviews) {
    if (!revMap.has(r.review_id)) revMap.set(r.review_id, r);
  }

  const propMap = new Map(current.proposals.map((p) => [p.proposal_id, p]));
  for (const p of bundle.proposals) {
    if (!propMap.has(p.proposal_id)) propMap.set(p.proposal_id, p);
  }

  const logMap = new Map(current.logs.map((l) => [l.id, l]));
  for (const l of bundle.logs) {
    if (!logMap.has(l.id)) logMap.set(l.id, l);
  }

  const nextState: AppState = {
    subjects: mergedSubjects,
    folders: mergedFolders,
    items: Array.from(itemMap.values()),
    tendencies: Array.from(tendMap.values()),
    reviews: Array.from(revMap.values()).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    proposals: Array.from(propMap.values()).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    logs: Array.from(logMap.values()).sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    mode: current.mode,
    limits: current.limits,
    pdfSettings: current.pdfSettings,
    consentAccepted: current.consentAccepted,
    consentAcceptedAt: current.consentAcceptedAt,
    installGuideDismissed: current.installGuideDismissed,
  };

  appendLog(nextState, 'バックアップ復元（結合）', `項目${bundle.items.length}件を既存データに結合しました`);
  await saveState(nextState);
  return nextState;
}
