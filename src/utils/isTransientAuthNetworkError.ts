export const isTransientAuthNetworkError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? error.code : undefined;
  return code === 'auth/network-request-failed';
};
