import { db, type MetaRecord } from '../db/database.ts';
import type {
  AppLimits,
  AppState,
  ExportDataBundle,
  KnowledgeItem,
  OrganizationMode,
} from '../types.ts';

const API_KEY_STORAGE_KEY = 'tensaku_gemini_api_key';

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
  autoHideTendencyDays: 60,
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
    consentAccepted: false,
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

function applyAutoHideTendencies(state: AppState): boolean {
  const days = state.limits.autoHideTendencyDays;
  if (!days || days <= 0) return false;

  const todayMs = Date.parse(getTodayJST());
  const thresholdMs = days * 24 * 60 * 60 * 1000;
  let changed = false;

  for (const t of state.tendencies) {
    if (t.hidden) continue;
    const latestDate = t.occurrences
      .map((o) => o.date)
      .sort((a, b) => b.localeCompare(a))[0];
    const refStr = latestDate ?? t.updated_at.slice(0, 10);
    const refMs = Date.parse(refStr);
    if (!Number.isNaN(refMs) && todayMs - refMs >= thresholdMs) {
      t.hidden = true;
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

  const [items, tendencies, reviews, proposals] = await Promise.all([
    db.items.toArray(),
    db.tendencies.toArray(),
    db.reviews.toArray(),
    db.proposals.toArray(),
  ]);

  reviews.sort((a, b) => b.created_at.localeCompare(a.created_at));
  proposals.sort((a, b) => b.created_at.localeCompare(a.created_at));

  const state: AppState = {
    subjects: meta.subjects.length > 0 ? meta.subjects : createInitialMeta().subjects,
    folders: meta.folders ?? [],
    items,
    tendencies,
    reviews,
    proposals,
    mode: meta.mode === '一任' || meta.mode === '確認' ? meta.mode : '確認',
    limits: { ...DEFAULT_LIMITS, ...(meta.limits ?? {}) },
    consentAccepted: Boolean(meta.consentAccepted),
    consentAcceptedAt: meta.consentAcceptedAt,
  };

  if (applyAutoHideTendencies(state)) {
    await saveState(state);
  }

  return state;
}

export async function saveState(state: AppState): Promise<void> {
  const meta: MetaRecord = {
    key: 'workspace',
    subjects: state.subjects,
    folders: state.folders,
    mode: state.mode,
    limits: state.limits,
    consentAccepted: state.consentAccepted,
    consentAcceptedAt: state.consentAcceptedAt,
  };

  await db.transaction('rw', [db.meta, db.items, db.tendencies, db.reviews, db.proposals], async () => {
    await db.meta.put(meta);
    await db.items.clear();
    if (state.items.length > 0) await db.items.bulkPut(state.items);
    await db.tendencies.clear();
    if (state.tendencies.length > 0) await db.tendencies.bulkPut(state.tendencies);
    await db.reviews.clear();
    if (state.reviews.length > 0) await db.reviews.bulkPut(state.reviews);
    await db.proposals.clear();
    if (state.proposals.length > 0) await db.proposals.bulkPut(state.proposals);
  });
}

export async function acceptConsent(): Promise<AppState> {
  const state = await loadState();
  state.consentAccepted = true;
  state.consentAcceptedAt = new Date().toISOString();
  await saveState(state);
  return state;
}

export async function setMode(mode: OrganizationMode): Promise<AppState> {
  const state = await loadState();
  state.mode = mode;
  await saveState(state);
  return state;
}

export async function updateLimits(limits: Partial<AppLimits>): Promise<AppState> {
  const state = await loadState();
  state.limits = { ...state.limits, ...limits };
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
  state.tendencies[idx] = {
    ...state.tendencies[idx],
    hidden,
    updated_at: new Date().toISOString(),
  };
  await saveState(state);
  return { ok: true, state };
}

export async function exportAllDataBundle(): Promise<ExportDataBundle> {
  const state = await loadState();
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    subjects: state.subjects,
    folders: state.folders,
    items: state.items,
    tendencies: state.tendencies,
    reviews: state.reviews,
    proposals: state.proposals,
    mode: state.mode,
    limits: state.limits,
  };
}

export async function importAllDataBundle(
  rawJson: string
): Promise<{ ok: boolean; error?: string; state?: AppState }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { ok: false, error: 'JSON ファイルの形式が正しくありません。' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'バックアップデータの形式が不正です。' };
  }

  const bundle = parsed as Partial<ExportDataBundle>;
  if (!Array.isArray(bundle.subjects) || bundle.subjects.length === 0) {
    return { ok: false, error: '科目データ（subjects）が含まれていません。' };
  }
  if (
    !Array.isArray(bundle.folders) ||
    !Array.isArray(bundle.items) ||
    !Array.isArray(bundle.tendencies) ||
    !Array.isArray(bundle.reviews)
  ) {
    return { ok: false, error: 'バックアップファイルの必須項目が不足しています。' };
  }

  const current = await loadState();
  const nextState: AppState = {
    subjects: bundle.subjects.map((s) => String(s)),
    folders: bundle.folders.map((f) => String(f)),
    items: bundle.items,
    tendencies: bundle.tendencies,
    reviews: bundle.reviews,
    proposals: Array.isArray(bundle.proposals) ? bundle.proposals : [],
    mode: bundle.mode === '一任' || bundle.mode === '確認' ? bundle.mode : current.mode,
    limits: { ...DEFAULT_LIMITS, ...(bundle.limits ?? {}) },
    consentAccepted: current.consentAccepted,
    consentAcceptedAt: current.consentAcceptedAt,
  };

  await saveState(nextState);
  return { ok: true, state: nextState };
}
