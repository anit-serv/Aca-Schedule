/**
 * UUID生成関数
 * HTTPSでは crypto.randomUUID() を使用し、
 * HTTPではフォールバック実装を使用する
 */
export const generateUUID = (): string => {
  // crypto.randomUUID() が利用可能な場合（HTTPS環境）
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  
  // HTTP環境用のフォールバック実装
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};
