import type {
  AppState,
  GradingBasis,
  KnowledgeItem,
  OrganizationProposal,
  ProposalTool,
  ReviewQuestion,
  ReviewRecord,
  Tendency,
  TendencyCategory,
} from '../types.ts';
import {
  appendLog,
  applyAutoHideTendenciesForSubject,
  ensureFolderExistsInState,
  generateId,
  getTodayJST,
  loadState,
  normalizePath,
  saveState,
  splitPath,
} from './storeService.ts';

export interface ReviewSessionTracker {
  savedCount: number;
  tendencyCount: number;
  organizedCount: number;
  proposalsQueuedCount: number;
  savedHeadings: string[];
  recordedTendencyNames: string[];
  occurrenceIds: string[];
  errorCounts: Map<string, number>;
  finalizedReview?: ReviewRecord;
}

export function createSessionTracker(): ReviewSessionTracker {
  return {
    savedCount: 0,
    tendencyCount: 0,
    organizedCount: 0,
    proposalsQueuedCount: 0,
    savedHeadings: [],
    recordedTendencyNames: [],
    occurrenceIds: [],
    errorCounts: new Map<string, number>(),
  };
}

const ALLOWED_CATEGORIES: TendencyCategory[] = ['計算', '転記', '読解', '表記', '最終確認'];

const NON_PII_SCHOOL_TERMS = [
  '高校数学',
  '高校英語',
  '高校国語',
  '高校物理',
  '高校化学',
  '高校生物',
  '高校地学',
  '高校日本史',
  '高校世界史',
  '高校地理',
  '高校範囲',
  '高校レベル',
  '高校生',
  '高校入試',
  '中学数学',
  '中学英語',
  '中学範囲',
];

function containsSuspectedPII(text: string): boolean {
  if (!text) return false;
  const emailRegex = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  const phoneRegex = /0\d{1,4}-\d{1,4}-\d{3,4}/;
  const classNumberRegex = /[1-3]年[1-9A-Z組]{1,2}\d{1,2}番/;
  const explicitLabelRegex = /(氏名|名前|学籍番号|出席番号)\s*[:：]/;
  const honorificNameRegex = /[一-龥]{1,4}\s*(さん|くん|君|様)(?:$|[\s、。])/m;

  if (
    emailRegex.test(text) ||
    phoneRegex.test(text) ||
    classNumberRegex.test(text) ||
    explicitLabelRegex.test(text) ||
    honorificNameRegex.test(text)
  ) {
    return true;
  }

  let sanitized = text;
  for (const term of NON_PII_SCHOOL_TERMS) {
    sanitized = sanitized.split(term).join('');
  }
  const schoolNameRegex = /[一-龥ぁ-んァ-ヶ]{2,8}(高等学校|高校|中学校|学園)/;
  return schoolNameRegex.test(sanitized);
}

function normalizeForSimilarity(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s・、。,.!！?？「」『』()（）の]/g, '');
}

function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigramsA = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    bigramsA.set(bg, (bigramsA.get(bg) ?? 0) + 1);
  }
  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2);
    const count = bigramsA.get(bg) ?? 0;
    if (count > 0) {
      intersection++;
      bigramsA.set(bg, count - 1);
    }
  }
  return (2 * intersection) / (a.length - 1 + (b.length - 1));
}

function findSimilarTendency(tendencies: Tendency[], candidateName: string): Tendency | undefined {
  const normCandidate = normalizeForSimilarity(candidateName);
  if (!normCandidate) return undefined;

  let bestMatch: Tendency | undefined;
  let bestScore = 0;

  for (const t of tendencies) {
    const normExisting = normalizeForSimilarity(t.name);
    if (!normExisting) continue;
    if (normExisting === normCandidate) return t;
    if (
      normCandidate.length >= 4 &&
      normExisting.length >= 4 &&
      (normExisting.includes(normCandidate) || normCandidate.includes(normExisting))
    ) {
      const ratio =
        Math.min(normCandidate.length, normExisting.length) /
        Math.max(normCandidate.length, normExisting.length);
      if (ratio >= 0.72 && ratio > bestScore) {
        bestScore = ratio;
        bestMatch = t;
      }
    }
    const score = diceCoefficient(normCandidate, normExisting);
    if (score >= 0.72 && score > bestScore) {
      bestScore = score;
      bestMatch = t;
    }
  }
  return bestMatch;
}

function findActiveItemByFullPath(state: AppState, fullPath: string): KnowledgeItem | undefined {
  const norm = normalizePath(fullPath);
  const lastSlash = norm.lastIndexOf('/');
  if (lastSlash === -1) return undefined;
  const folderPath = norm.slice(0, lastSlash);
  const heading = norm.slice(lastSlash + 1);
  return state.items.find((i) => !i.hidden && i.folder_path === folderPath && i.heading === heading);
}

function getFolderMaxChildDepthOffset(state: AppState, folderPath: string): number {
  const prefix = `${folderPath}/`;
  let maxExtra = 0;
  for (const f of state.folders) {
    if (f.startsWith(prefix)) {
      const rest = f.slice(prefix.length).split('/').length;
      if (rest > maxExtra) maxExtra = rest;
    }
  }
  return maxExtra;
}

function folderExists(state: AppState, folderPath: string): boolean {
  const norm = normalizePath(folderPath);
  const parts = splitPath(norm);
  if (parts.length === 1) return state.subjects.includes(parts[0]);
  return state.folders.includes(norm);
}

function makeError(
  tracker: ReviewSessionTracker,
  toolName: string,
  args: Record<string, unknown>,
  code: string,
  message: string
): Record<string, unknown> {
  const sig = `${toolName}:${JSON.stringify(args)}:${code}`;
  const count = (tracker.errorCounts.get(sig) ?? 0) + 1;
  tracker.errorCounts.set(sig, count);

  const finalMessage =
    count >= 2
      ? `${message}（同じエラーが2回続きました。この操作は諦めて次の処理へ進んでください）`
      : message;

  return {
    status: 'error',
    code,
    message: finalMessage,
  };
}

function executeCreateFolder(state: AppState, folderPath: string): { ok: boolean; code?: string; message?: string } {
  const norm = normalizePath(folderPath);
  const parts = splitPath(norm);
  if (parts.length <= 1) {
    return { ok: false, code: 'FORBIDDEN_OPERATION', message: '科目フォルダそのものは作成できません。' };
  }
  if (!state.subjects.includes(parts[0])) {
    return { ok: false, code: 'SUBJECT_NOT_FOUND', message: `科目「${parts[0]}」が見つかりません。` };
  }
  if (parts.length > 3) {
    return { ok: false, code: 'DEPTH_EXCEEDED', message: '階層は科目の下に最大2段までです。' };
  }
  if (parts[parts.length - 1].length > state.limits.maxHeadingLength) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: `フォルダ名は${state.limits.maxHeadingLength}文字以内にしてください。`,
    };
  }
  if (state.folders.includes(norm)) {
    return { ok: false, code: 'ALREADY_EXISTS', message: `フォルダ「${norm}」は既に存在します。` };
  }
  ensureFolderExistsInState(state, norm);
  return { ok: true };
}

function executeMoveItem(
  state: AppState,
  fromPath: string,
  toFolderPath: string
): { ok: boolean; code?: string; message?: string } {
  const normFrom = normalizePath(fromPath);
  const normTo = normalizePath(toFolderPath);
  const fromParts = splitPath(normFrom);
  const toParts = splitPath(normTo);

  if (fromParts.length <= 1) {
    return { ok: false, code: 'FORBIDDEN_OPERATION', message: '科目自体は移動できません。' };
  }
  if (toParts.length === 0 || !state.subjects.includes(toParts[0])) {
    return { ok: false, code: 'SUBJECT_NOT_FOUND', message: `移動先の科目「${toParts[0] ?? ''}」が存在しません。` };
  }
  if (!folderExists(state, normTo)) {
    return { ok: false, code: 'NOT_FOUND', message: `移動先フォルダ「${normTo}」が存在しません。` };
  }

  const item = findActiveItemByFullPath(state, normFrom);
  if (item) {
    if (toParts.length < 2 || toParts.length > 3) {
      return {
        ok: false,
        code: 'DEPTH_EXCEEDED',
        message: '知識項目は科目の下の単元フォルダ（1〜2段）に移動してください。',
      };
    }
    const collision = state.items.find(
      (other) => !other.hidden && other.id !== item.id && other.folder_path === normTo && other.heading === item.heading
    );
    if (collision) {
      return {
        ok: false,
        code: 'ALREADY_EXISTS',
        message: `移動先「${normTo}」に同じ見出し「${item.heading}」が既に存在します。`,
      };
    }
    item.folder_path = normTo;
    item.updated_at = new Date().toISOString();
    return { ok: true };
  }

  if (state.folders.includes(normFrom)) {
    if (normTo === normFrom || normTo.startsWith(`${normFrom}/`)) {
      return { ok: false, code: 'VALIDATION_ERROR', message: '自分自身や子孫フォルダの中には移動できません。' };
    }
    const folderName = fromParts[fromParts.length - 1];
    const newFolderPath = `${normTo}/${folderName}`;
    const childOffset = getFolderMaxChildDepthOffset(state, normFrom);
    if (splitPath(newFolderPath).length + childOffset > 3) {
      return { ok: false, code: 'DEPTH_EXCEEDED', message: '移動後の階層が科目の下2段を超えます。' };
    }
    if (state.folders.includes(newFolderPath)) {
      return { ok: false, code: 'ALREADY_EXISTS', message: `移動先にフォルダ「${newFolderPath}」が既に存在します。` };
    }

    state.folders = state.folders.map((f) => {
      if (f === normFrom) return newFolderPath;
      if (f.startsWith(`${normFrom}/`)) return `${newFolderPath}${f.slice(normFrom.length)}`;
      return f;
    });
    state.items = state.items.map((it) => {
      if (it.folder_path === normFrom) return { ...it, folder_path: newFolderPath, updated_at: new Date().toISOString() };
      if (it.folder_path.startsWith(`${normFrom}/`)) {
        return {
          ...it,
          folder_path: `${newFolderPath}${it.folder_path.slice(normFrom.length)}`,
          updated_at: new Date().toISOString(),
        };
      }
      return it;
    });
    return { ok: true };
  }

  return { ok: false, code: 'NOT_FOUND', message: `移動元「${normFrom}」が見つかりません。` };
}

function executeRenameItem(
  state: AppState,
  targetPath: string,
  newName: string
): { ok: boolean; code?: string; message?: string } {
  const norm = normalizePath(targetPath);
  const cleanNew = newName.trim();
  const parts = splitPath(norm);

  if (parts.length <= 1) {
    return { ok: false, code: 'FORBIDDEN_OPERATION', message: '科目名は変更できません。' };
  }
  if (!cleanNew || cleanNew.includes('/')) {
    return { ok: false, code: 'VALIDATION_ERROR', message: '新しい名前が不正です（空や「/」は不可）。' };
  }
  if (cleanNew.length > state.limits.maxHeadingLength) {
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: `新しい名前は${state.limits.maxHeadingLength}文字以内にしてください。`,
    };
  }
  if (containsSuspectedPII(cleanNew)) {
    return { ok: false, code: 'PII_SUSPECTED', message: '個人情報らしき文字列が含まれています。修正してください。' };
  }

  const item = findActiveItemByFullPath(state, norm);
  if (item) {
    const collision = state.items.find(
      (other) =>
        !other.hidden && other.id !== item.id && other.folder_path === item.folder_path && other.heading === cleanNew
    );
    if (collision) {
      return { ok: false, code: 'ALREADY_EXISTS', message: `同じフォルダに見出し「${cleanNew}」が既に存在します。` };
    }
    item.heading = cleanNew;
    item.updated_at = new Date().toISOString();
    return { ok: true };
  }

  if (state.folders.includes(norm)) {
    const parentPath = parts.slice(0, -1).join('/');
    const nextFolderPath = `${parentPath}/${cleanNew}`;
    if (state.folders.includes(nextFolderPath)) {
      return { ok: false, code: 'ALREADY_EXISTS', message: `フォルダ「${nextFolderPath}」は既に存在します。` };
    }
    state.folders = state.folders.map((f) => {
      if (f === norm) return nextFolderPath;
      if (f.startsWith(`${norm}/`)) return `${nextFolderPath}${f.slice(norm.length)}`;
      return f;
    });
    state.items = state.items.map((it) => {
      if (it.folder_path === norm) return { ...it, folder_path: nextFolderPath, updated_at: new Date().toISOString() };
      if (it.folder_path.startsWith(`${norm}/`)) {
        return {
          ...it,
          folder_path: `${nextFolderPath}${it.folder_path.slice(norm.length)}`,
          updated_at: new Date().toISOString(),
        };
      }
      return it;
    });
    return { ok: true };
  }

  return { ok: false, code: 'NOT_FOUND', message: `対象「${norm}」が見つかりません。` };
}

function executeMergeItems(
  state: AppState,
  fromPath: string,
  intoPath: string
): { ok: boolean; code?: string; message?: string } {
  const normFrom = normalizePath(fromPath);
  const normInto = normalizePath(intoPath);
  if (normFrom === normInto) {
    return { ok: false, code: 'VALIDATION_ERROR', message: '同一の項目同士は統合できません。' };
  }
  const fromItem = findActiveItemByFullPath(state, normFrom);
  if (!fromItem) {
    return { ok: false, code: 'NOT_FOUND', message: `統合元の知識項目「${normFrom}」が見つかりません。` };
  }
  const intoItem = findActiveItemByFullPath(state, normInto);
  if (!intoItem) {
    return { ok: false, code: 'NOT_FOUND', message: `統合先の知識項目「${normInto}」が見つかりません。` };
  }

  intoItem.mistake_count += fromItem.mistake_count;
  intoItem.updated_at = new Date().toISOString();
  fromItem.hidden = true;
  fromItem.merged_into_id = intoItem.id;
  fromItem.updated_at = new Date().toISOString();
  return { ok: true };
}

function queueProposal(
  state: AppState,
  tool: ProposalTool,
  args: Record<string, string>,
  reason: string,
  summary: string
): OrganizationProposal {
  const proposal: OrganizationProposal = {
    proposal_id: generateId('prp'),
    tool,
    args,
    reason,
    summary,
    status: 'pending',
    created_at: new Date().toISOString(),
  };
  state.proposals.unshift(proposal);
  return proposal;
}

export async function resolveProposal(
  proposalId: string,
  action: 'approve' | 'reject'
): Promise<{ ok: boolean; error?: string; state: AppState }> {
  const state = await loadState();
  const idx = state.proposals.findIndex((p) => p.proposal_id === proposalId);
  if (idx === -1) {
    return { ok: false, error: '対象の提案が見つかりません。', state };
  }
  const proposal = state.proposals[idx];
  if (proposal.status !== 'pending') {
    return { ok: false, error: 'この提案は既に処理済みです。', state };
  }

  const now = new Date().toISOString();
  if (action === 'reject') {
    proposal.status = 'rejected';
    proposal.resolved_at = now;
    appendLog(state, '提案却下', proposal.summary);
    await saveState(state);
    return { ok: true, state };
  }

  let execResult: { ok: boolean; code?: string; message?: string } = { ok: false, message: '未対応の提案です。' };
  if (proposal.tool === 'create_folder') {
    execResult = executeCreateFolder(state, proposal.args.folder_path ?? '');
  } else if (proposal.tool === 'move_item') {
    execResult = executeMoveItem(state, proposal.args.from_path ?? '', proposal.args.to_folder_path ?? '');
  } else if (proposal.tool === 'rename_item') {
    execResult = executeRenameItem(state, proposal.args.path ?? '', proposal.args.new_name ?? '');
  } else if (proposal.tool === 'merge_items') {
    execResult = executeMergeItems(state, proposal.args.from_path ?? '', proposal.args.into_path ?? '');
  }

  if (!execResult.ok) {
    proposal.status = 'invalidated';
    proposal.invalid_reason = execResult.message ?? '対象の状態が既に変更されていたため実行できませんでした。';
    proposal.resolved_at = now;
    appendLog(state, '提案無効化', `${proposal.summary} (${proposal.invalid_reason})`);
    await saveState(state);
    return { ok: false, error: proposal.invalid_reason, state };
  }

  proposal.status = 'approved';
  proposal.resolved_at = now;
  appendLog(state, '提案承認', proposal.summary);
  await saveState(state);
  return { ok: true, state };
}

export async function executeAITool(
  toolName: string,
  rawArgs: Record<string, unknown>,
  tracker: ReviewSessionTracker,
  forceAllowNoteTruncate = false
): Promise<Record<string, unknown>> {
  const state = await loadState();

  switch (toolName) {
    case 'get_tree': {
      const folderPath = normalizePath(String(rawArgs.folder_path ?? ''));
      const parts = splitPath(folderPath);
      if (parts.length === 0 || !state.subjects.includes(parts[0])) {
        return makeError(
          tracker,
          toolName,
          rawArgs,
          'SUBJECT_NOT_FOUND',
          `科目「${parts[0] ?? ''}」は存在しません。利用可能な科目: ${state.subjects.join(', ')}`
        );
      }
      if (!folderExists(state, folderPath)) {
        return makeError(tracker, toolName, rawArgs, 'NOT_FOUND', `フォルダ「${folderPath}」は存在しません。`);
      }

      const depth = parts.length;
      const directFolders = state.folders
        .filter((f) => f.startsWith(`${folderPath}/`) && splitPath(f).length === depth + 1)
        .map((f) => splitPath(f)[depth]);

      const matchingItems = state.items
        .filter((i) => !i.hidden && i.folder_path === folderPath)
        .sort((a, b) => b.mistake_count - a.mistake_count);

      const truncated = matchingItems.length > 50;
      const items = matchingItems.slice(0, 50).map((i) => ({
        heading: i.heading,
        mistake_count: i.mistake_count,
      }));

      return {
        folder_path: folderPath,
        folders: directFolders,
        items,
        truncated,
      };
    }

    case 'read_file': {
      const folderPath = normalizePath(String(rawArgs.folder_path ?? ''));
      const heading = String(rawArgs.heading ?? '').trim();
      const parts = splitPath(folderPath);
      if (parts.length === 0 || !state.subjects.includes(parts[0])) {
        return makeError(tracker, toolName, rawArgs, 'SUBJECT_NOT_FOUND', `科目「${parts[0] ?? ''}」は存在しません。`);
      }
      const item = state.items.find((i) => !i.hidden && i.folder_path === folderPath && i.heading === heading);
      if (!item) {
        return makeError(
          tracker,
          toolName,
          rawArgs,
          'NOT_FOUND',
          `知識項目「${folderPath}/${heading}」が見つかりません。`
        );
      }
      return {
        heading: item.heading,
        explanation: item.explanation,
        mistake_count: item.mistake_count,
      };
    }

    case 'save_file': {
      if (tracker.savedCount >= state.limits.maxSavePerReview) {
        return makeError(
          tracker,
          toolName,
          rawArgs,
          'LIMIT_EXCEEDED',
          `1回の添削で登録できる知識項目は最大${state.limits.maxSavePerReview}件までです。`
        );
      }
      const folderPath = normalizePath(String(rawArgs.folder_path ?? ''));
      const heading = String(rawArgs.heading ?? '').trim();
      const explanation = String(rawArgs.explanation ?? '').trim();
      const parts = splitPath(folderPath);

      if (parts.length === 0 || !state.subjects.includes(parts[0])) {
        return makeError(tracker, toolName, rawArgs, 'SUBJECT_NOT_FOUND', `科目「${parts[0] ?? ''}」は存在しません。`);
      }
      if (parts.length < 2) {
        return makeError(
          tracker,
          toolName,
          rawArgs,
          'VALIDATION_ERROR',
          '登録先の単元フォルダを指定してください（例: "数学/三角関数"）。'
        );
      }
      if (parts.length > 3) {
        return makeError(tracker, toolName, rawArgs, 'DEPTH_EXCEEDED', 'フォルダ階層は科目の下に最大2段までです。');
      }
      if (!heading || heading.includes('/')) {
        return makeError(tracker, toolName, rawArgs, 'VALIDATION_ERROR', '見出しが空または不正です。');
      }
      if (heading.length > state.limits.maxHeadingLength) {
        return makeError(
          tracker,
          toolName,
          rawArgs,
          'VALIDATION_ERROR',
          `見出しは${state.limits.maxHeadingLength}文字以内にしてください。`
        );
      }
      if (!explanation || explanation.length > state.limits.maxExplanationLength) {
        return makeError(
          tracker,
          toolName,
          rawArgs,
          'VALIDATION_ERROR',
          `解説は1〜${state.limits.maxExplanationLength}文字以内にしてください。`
        );
      }
      if (containsSuspectedPII(heading) || containsSuspectedPII(explanation)) {
        return makeError(
          tracker,
          toolName,
          rawArgs,
          'PII_SUSPECTED',
          '氏名や学校名などの個人情報らしき文字列が含まれているため登録できません。一般的な表現に修正してください。'
        );
      }

      ensureFolderExistsInState(state, folderPath);

      const existing = state.items.find(
        (i) => !i.hidden && i.folder_path === folderPath && i.heading === heading
      );
      const now = new Date().toISOString();

      if (existing) {
        existing.mistake_count += 1;
        existing.updated_at = now;
        await saveState(state);
        tracker.savedCount += 1;
        if (!tracker.savedHeadings.includes(heading)) tracker.savedHeadings.push(heading);
        return {
          status: 'incremented',
          item_id: existing.id,
          mistake_count: existing.mistake_count,
        };
      }

      const newItem: KnowledgeItem = {
        id: generateId('itm'),
        folder_path: folderPath,
        heading,
        explanation,
        mistake_count: 1,
        hidden: false,
        verified: false,
        created_at: now,
        updated_at: now,
      };
      state.items.push(newItem);
      await saveState(state);
      tracker.savedCount += 1;
      if (!tracker.savedHeadings.includes(heading)) tracker.savedHeadings.push(heading);
      return {
        status: 'created',
        item_id: newItem.id,
        mistake_count: 1,
      };
    }

    case 'create_folder': {
      const folderPath = normalizePath(String(rawArgs.folder_path ?? ''));
      const parts = splitPath(folderPath);
      if (parts.length <= 1) {
        return makeError(tracker, toolName, rawArgs, 'FORBIDDEN_OPERATION', '科目フォルダそのものは作成できません。');
      }
      if (!state.subjects.includes(parts[0])) {
        return makeError(tracker, toolName, rawArgs, 'SUBJECT_NOT_FOUND', `科目「${parts[0]}」は存在しません。`);
      }
      if (parts.length > 3) {
        return makeError(tracker, toolName, rawArgs, 'DEPTH_EXCEEDED', '階層は科目の下に最大2段までです。');
      }
      if (state.folders.includes(folderPath)) {
        return makeError(tracker, toolName, rawArgs, 'ALREADY_EXISTS', `フォルダ「${folderPath}」は既に存在します。`);
      }

      if (state.mode === '確認') {
        const duplicateProposal = state.proposals.find(
          (p) => p.status === 'pending' && p.tool === 'create_folder' && p.args.folder_path === folderPath
        );
        if (duplicateProposal) {
          return { status: 'queued_for_approval', proposal_id: duplicateProposal.proposal_id };
        }
        const proposal = queueProposal(
          state,
          'create_folder',
          { folder_path: folderPath },
          '単元整理のためのフォルダ作成',
          `フォルダを作成: ${folderPath}`
        );
        await saveState(state);
        tracker.proposalsQueuedCount += 1;
        return { status: 'queued_for_approval', proposal_id: proposal.proposal_id };
      }

      const res = executeCreateFolder(state, folderPath);
      if (!res.ok) return makeError(tracker, toolName, rawArgs, res.code ?? 'ERROR', res.message ?? 'エラー');
      await saveState(state);
      tracker.organizedCount += 1;
      return { status: 'created', folder_path: folderPath };
    }

    case 'move_item': {
      const fromPath = normalizePath(String(rawArgs.from_path ?? ''));
      const toFolderPath = normalizePath(String(rawArgs.to_folder_path ?? ''));
      const reason = String(rawArgs.reason ?? '').trim();

      if (!reason || reason.length > state.limits.maxReasonLength) {
        return makeError(
          tracker,
          toolName,
          rawArgs,
          'VALIDATION_ERROR',
          `移動の理由は1〜${state.limits.maxReasonLength}文字以内にしてください。`
        );
      }

      const testState: AppState = JSON.parse(JSON.stringify(state));
      const check = executeMoveItem(testState, fromPath, toFolderPath);
      if (!check.ok) {
        return makeError(tracker, toolName, rawArgs, check.code ?? 'ERROR', check.message ?? '移動できません。');
      }

      if (state.mode === '確認') {
        const dup = state.proposals.find(
          (p) =>
            p.status === 'pending' &&
            p.tool === 'move_item' &&
            p.args.from_path === fromPath &&
            p.args.to_folder_path === toFolderPath
        );
        if (dup) return { status: 'queued_for_approval', proposal_id: dup.proposal_id };
        const proposal = queueProposal(
          state,
          'move_item',
          { from_path: fromPath, to_folder_path: toFolderPath },
          reason,
          `移動: ${fromPath} → ${toFolderPath}`
        );
        await saveState(state);
        tracker.proposalsQueuedCount += 1;
        return { status: 'queued_for_approval', proposal_id: proposal.proposal_id };
      }

      executeMoveItem(state, fromPath, toFolderPath);
      await saveState(state);
      tracker.organizedCount += 1;
      return { status: 'moved', from_path: fromPath, to_folder_path: toFolderPath };
    }

    case 'rename_item': {
      const targetPath = normalizePath(String(rawArgs.path ?? ''));
      const newName = String(rawArgs.new_name ?? '').trim();
      const reason = String(rawArgs.reason ?? '').trim();

      if (!reason || reason.length > state.limits.maxReasonLength) {
        return makeError(
          tracker,
          toolName,
          rawArgs,
          'VALIDATION_ERROR',
          `変更の理由は1〜${state.limits.maxReasonLength}文字以内にしてください。`
        );
      }

      const testState: AppState = JSON.parse(JSON.stringify(state));
      const check = executeRenameItem(testState, targetPath, newName);
      if (!check.ok) {
        return makeError(tracker, toolName, rawArgs, check.code ?? 'ERROR', check.message ?? '名前を変更できません。');
      }

      if (state.mode === '確認') {
        const dup = state.proposals.find(
          (p) =>
            p.status === 'pending' &&
            p.tool === 'rename_item' &&
            p.args.path === targetPath &&
            p.args.new_name === newName
        );
        if (dup) return { status: 'queued_for_approval', proposal_id: dup.proposal_id };
        const proposal = queueProposal(
          state,
          'rename_item',
          { path: targetPath, new_name: newName },
          reason,
          `名前変更: ${targetPath} → ${newName}`
        );
        await saveState(state);
        tracker.proposalsQueuedCount += 1;
        return { status: 'queued_for_approval', proposal_id: proposal.proposal_id };
      }

      executeRenameItem(state, targetPath, newName);
      await saveState(state);
      tracker.organizedCount += 1;
      return { status: 'renamed', path: targetPath, new_name: newName };
    }

    case 'merge_items': {
      const fromPath = normalizePath(String(rawArgs.from_path ?? ''));
      const intoPath = normalizePath(String(rawArgs.into_path ?? ''));
      const reason = String(rawArgs.reason ?? '').trim();

      if (!reason || reason.length > state.limits.maxReasonLength) {
        return makeError(
          tracker,
          toolName,
          rawArgs,
          'VALIDATION_ERROR',
          `統合の理由は1〜${state.limits.maxReasonLength}文字以内にしてください。`
        );
      }

      const testState: AppState = JSON.parse(JSON.stringify(state));
      const check = executeMergeItems(testState, fromPath, intoPath);
      if (!check.ok) {
        return makeError(tracker, toolName, rawArgs, check.code ?? 'ERROR', check.message ?? '統合できません。');
      }

      if (state.mode === '確認') {
        const dup = state.proposals.find(
          (p) =>
            p.status === 'pending' &&
            p.tool === 'merge_items' &&
            p.args.from_path === fromPath &&
            p.args.into_path === intoPath
        );
        if (dup) return { status: 'queued_for_approval', proposal_id: dup.proposal_id };
        const proposal = queueProposal(
          state,
          'merge_items',
          { from_path: fromPath, into_path: intoPath },
          reason,
          `項目統合: ${fromPath} → ${intoPath}`
        );
        await saveState(state);
        tracker.proposalsQueuedCount += 1;
        return { status: 'queued_for_approval', proposal_id: proposal.proposal_id };
      }

      executeMergeItems(state, fromPath, intoPath);
      await saveState(state);
      tracker.organizedCount += 1;
      return { status: 'merged', from_path: fromPath, into_path: intoPath };
    }

    case 'get_tendencies': {
      const subject = rawArgs.subject ? String(rawArgs.subject).trim() : undefined;
      if (subject && !state.subjects.includes(subject)) {
        return makeError(tracker, toolName, rawArgs, 'SUBJECT_NOT_FOUND', `科目「${subject}」は存在しません。`);
      }

      const filtered = state.tendencies
        .filter((t) => !subject || t.subjects.includes(subject))
        .map((t) => {
          const sortedOcc = [...t.occurrences].sort((a, b) => b.date.localeCompare(a.date));
          const latestDate = sortedOcc[0]?.date ?? t.updated_at.slice(0, 10);
          return {
            latestDate,
            payload: {
              tendency_id: t.tendency_id,
              name: t.name,
              category: t.category,
              subjects: t.subjects,
              recent: sortedOcc.slice(0, 5).map((o) => ({
                subject: o.subject,
                unit: o.unit,
                situation: o.situation,
                date: o.date,
              })),
              recent_count: t.occurrences.length,
              visible_in: t.visible_in,
              ...(t.hidden ? { hidden: true } : {}),
            },
          };
        })
        .sort((a, b) => b.latestDate.localeCompare(a.latestDate))
        .slice(0, 30)
        .map((entry) => entry.payload);

      return { tendencies: filtered };
    }

    case 'record_tendency': {
      if (tracker.tendencyCount >= state.limits.maxTendencyPerReview) {
        return makeError(
          tracker,
          toolName,
          rawArgs,
          'LIMIT_EXCEEDED',
          `1回の添削で記録できる傾向は最大${state.limits.maxTendencyPerReview}件までです。`
        );
      }
      const tendencyId = rawArgs.tendency_id ? String(rawArgs.tendency_id).trim() : undefined;
      const newName = rawArgs.new_name ? String(rawArgs.new_name).trim() : undefined;
      const category = rawArgs.category ? (String(rawArgs.category).trim() as TendencyCategory) : undefined;
      const subject = String(rawArgs.subject ?? '').trim();
      const unit = String(rawArgs.unit ?? '').trim();
      const situation = String(rawArgs.situation ?? '').trim();

      if (!subject || !state.subjects.includes(subject)) {
        return makeError(tracker, toolName, rawArgs, 'SUBJECT_NOT_FOUND', `科目「${subject}」は存在しません。`);
      }
      if (!unit) {
        return makeError(tracker, toolName, rawArgs, 'VALIDATION_ERROR', '単元（unit）を指定してください。');
      }
      if (!situation || situation.length > state.limits.maxSituationLength) {
        return makeError(
          tracker,
          toolName,
          rawArgs,
          'VALIDATION_ERROR',
          `situationは1〜${state.limits.maxSituationLength}文字以内にしてください。`
        );
      }
      if (containsSuspectedPII(situation) || (newName && containsSuspectedPII(newName))) {
        return makeError(
          tracker,
          toolName,
          rawArgs,
          'PII_SUSPECTED',
          '個人情報らしき文字列が含まれているため登録できません。一般的な表現に修正してください。'
        );
      }
      if (!tendencyId && !newName) {
        return makeError(
          tracker,
          toolName,
          rawArgs,
          'VALIDATION_ERROR',
          'tendency_id または new_name のいずれかを指定してください。'
        );
      }

      const today = getTodayJST();
      const now = new Date().toISOString();
      const occId = generateId('occ');

      if (tendencyId) {
        const existing = state.tendencies.find((t) => t.tendency_id === tendencyId);
        if (!existing) {
          return makeError(tracker, toolName, rawArgs, 'NOT_FOUND', `tendency_id「${tendencyId}」が見つかりません。`);
        }
        existing.occurrences.unshift({ id: occId, subject, unit, situation, date: today });
        if (!existing.subjects.includes(subject)) existing.subjects.push(subject);
        if (!existing.visible_in.includes(subject)) existing.visible_in.push(subject);
        existing.hidden = false; // Resurface if auto-hidden previously
        existing.updated_at = now;
        await saveState(state);
        tracker.tendencyCount += 1;
        tracker.occurrenceIds.push(occId);
        if (!tracker.recordedTendencyNames.includes(existing.name)) {
          tracker.recordedTendencyNames.push(existing.name);
        }
        return {
          status: 'incremented',
          tendency_id: existing.tendency_id,
          name: existing.name,
        };
      }

      if (!newName || newName.length > state.limits.maxTendencyNameLength) {
        return makeError(
          tracker,
          toolName,
          rawArgs,
          'VALIDATION_ERROR',
          `傾向名は1〜${state.limits.maxTendencyNameLength}文字以内にしてください。`
        );
      }

      const similar = findSimilarTendency(state.tendencies, newName);
      if (similar) {
        similar.occurrences.unshift({ id: occId, subject, unit, situation, date: today });
        if (!similar.subjects.includes(subject)) similar.subjects.push(subject);
        if (!similar.visible_in.includes(subject)) similar.visible_in.push(subject);
        similar.hidden = false;
        similar.updated_at = now;
        await saveState(state);
        tracker.tendencyCount += 1;
        tracker.occurrenceIds.push(occId);
        if (!tracker.recordedTendencyNames.includes(similar.name)) {
          tracker.recordedTendencyNames.push(similar.name);
        }
        return {
          status: 'merged_into_existing',
          tendency_id: similar.tendency_id,
          name: similar.name,
        };
      }

      if (!category || !ALLOWED_CATEGORIES.includes(category)) {
        return makeError(
          tracker,
          toolName,
          rawArgs,
          'VALIDATION_ERROR',
          `新規作成時は category を「${ALLOWED_CATEGORIES.join(' / ')}」から指定してください。`
        );
      }

      const created: Tendency = {
        tendency_id: generateId('tdc'),
        name: newName,
        category,
        subjects: [subject],
        visible_in: [subject],
        hidden: false,
        occurrences: [{ id: occId, subject, unit, situation, date: today }],
        created_at: now,
        updated_at: now,
      };
      state.tendencies.unshift(created);
      await saveState(state);
      tracker.tendencyCount += 1;
      tracker.occurrenceIds.push(occId);
      if (!tracker.recordedTendencyNames.includes(created.name)) {
        tracker.recordedTendencyNames.push(created.name);
      }
      return {
        status: 'created',
        tendency_id: created.tendency_id,
        name: created.name,
      };
    }

    case 'finalize_review': {
      const subject = String(rawArgs.subject ?? '').trim();
      const basis = String(rawArgs.basis ?? 'ai_grading') as GradingBasis;
      const confidenceLow = Boolean(rawArgs.confidence_low);
      const rawQuestions = Array.isArray(rawArgs.questions) ? rawArgs.questions : [];
      const pastRelation = rawArgs.past_relation ? String(rawArgs.past_relation).trim() : undefined;
      let note = rawArgs.note ? String(rawArgs.note).trim() : undefined;

      if (!state.subjects.includes(subject)) {
        return makeError(tracker, toolName, rawArgs, 'SUBJECT_NOT_FOUND', `科目「${subject}」は存在しません。`);
      }

      if (note && note.length > state.limits.maxNoteLength) {
        if (forceAllowNoteTruncate) {
          note = note.slice(0, state.limits.maxNoteLength);
        } else {
          return makeError(
            tracker,
            toolName,
            rawArgs,
            'VALIDATION_ERROR',
            `ひとこと（note）は${state.limits.maxNoteLength}文字以内にしてください（現在${note.length}文字）。`
          );
        }
      }

      const questions: ReviewQuestion[] = rawQuestions.map((q) => {
        const obj = (q ?? {}) as Record<string, unknown>;
        return {
          label: String(obj.label ?? '問題'),
          result: (['correct', 'partial', 'incorrect'].includes(String(obj.result))
            ? String(obj.result)
            : 'partial') as ReviewQuestion['result'],
          error_location: obj.error_location ? String(obj.error_location) : undefined,
          cause: (['knowledge', 'carelessness', 'both', 'none'].includes(String(obj.cause))
            ? String(obj.cause)
            : 'none') as ReviewQuestion['cause'],
          knowledge_headings: Array.isArray(obj.knowledge_headings)
            ? obj.knowledge_headings.map((h) => String(h))
            : undefined,
          tendency_names: Array.isArray(obj.tendency_names)
            ? obj.tendency_names.map((t) => String(t))
            : undefined,
        };
      });

      const declaredHeadings = Array.from(
        new Set(questions.flatMap((q) => q.knowledge_headings ?? []).filter(Boolean))
      );
      const declaredTendencies = Array.from(
        new Set(questions.flatMap((q) => q.tendency_names ?? []).filter(Boolean))
      );

      const discrepancies: string[] = [];
      for (const h of declaredHeadings) {
        if (!tracker.savedHeadings.includes(h)) {
          discrepancies.push(`申告された知識項目「${h}」は未登録です`);
        }
      }
      for (const t of declaredTendencies) {
        if (!tracker.recordedTendencyNames.includes(t)) {
          discrepancies.push(`申告された傾向「${t}」は未記録です`);
        }
      }

      const registrationLine =
        tracker.proposalsQueuedCount > 0
          ? `登録: 知識項目${tracker.savedCount}件、傾向${tracker.tendencyCount}件、整理${tracker.organizedCount}件（整理提案${tracker.proposalsQueuedCount}件）`
          : `登録: 知識項目${tracker.savedCount}件、傾向${tracker.tendencyCount}件、整理${tracker.organizedCount}件`;

      const reviewId = generateId('rev');
      const review: ReviewRecord = {
        review_id: reviewId,
        date: getTodayJST(),
        created_at: new Date().toISOString(),
        subject,
        basis: basis === 'model_answer' ? 'model_answer' : 'ai_grading',
        confidence_low: confidenceLow,
        questions,
        past_relation: pastRelation || undefined,
        note: note || undefined,
        registration_line: registrationLine,
        discrepancy_note: discrepancies.length > 0 ? discrepancies.join(' / ') : undefined,
      };

      for (const tend of state.tendencies) {
        for (const occ of tend.occurrences) {
          if (tracker.occurrenceIds.includes(occ.id)) {
            occ.review_id = reviewId;
          }
        }
      }

      state.reviews.unshift(review);
      applyAutoHideTendenciesForSubject(state, subject);
      appendLog(state, '添削完了', `${subject} (${registrationLine})`);
      await saveState(state);
      tracker.finalizedReview = review;

      return {
        status: 'saved',
        review_id: reviewId,
        registration_line: registrationLine,
      };
    }

    default:
      return makeError(tracker, toolName, rawArgs, 'UNKNOWN_TOOL', `不明なツール「${toolName}」です。`);
  }
}
