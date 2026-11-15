export const APP_NAME = 'Anarize';
export const APP_NAME_KANA = 'アナライズ';
export const APP_FULL_NAME = `${APP_NAME}（${APP_NAME_KANA}）`;
export const APP_DESCRIPTION = '答案を送るだけで、要復習と不注意ミスを自動で記録・整理する';

export const APP_BUILD_VERSION =
  typeof __APP_BUILD_VERSION__ !== 'undefined' ? __APP_BUILD_VERSION__ : 'local';

export const PDF_COLORS = {
  background: '#FFFFFF',
  text: '#1F2937',
  muted: '#6B7280',
  primary: '#1E3A8A',
  bandBg: '#E8EEFB',
  border: '#D1D5DB',
  redSheet: '#E53935',
} as const;
