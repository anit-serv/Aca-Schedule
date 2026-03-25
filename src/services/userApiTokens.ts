import type { User } from 'firebase/auth';
import type { UserApiTokenSummary } from '../types';

interface ApiEnvelope<T> {
  success: boolean;
  requestId: string;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

function toDateOrNull(value: unknown): Date | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const maybeTimestamp = value as { _seconds?: number; _nanoseconds?: number; seconds?: number; nanoseconds?: number };
  const seconds = maybeTimestamp._seconds ?? maybeTimestamp.seconds;
  const nanos = maybeTimestamp._nanoseconds ?? maybeTimestamp.nanoseconds ?? 0;

  if (typeof seconds === 'number') {
    return new Date(seconds * 1000 + Math.floor(nanos / 1_000_000));
  }

  return null;
}

function normalizeToken(input: unknown): UserApiTokenSummary {
  const data = (input || {}) as Record<string, unknown>;
  return {
    id: String(data.id || ''),
    name: String(data.name || ''),
    status: data.status === 'revoked' ? 'revoked' : 'active',
    tokenPrefix: String(data.tokenPrefix || ''),
    allowedEventIds: Array.isArray(data.allowedEventIds)
      ? data.allowedEventIds.filter((eventId): eventId is string => typeof eventId === 'string')
      : [],
    userId: String(data.userId || ''),
    userEmail: typeof data.userEmail === 'string' ? data.userEmail : null,
    expiresAt: toDateOrNull(data.expiresAt),
    lastUsedAt: toDateOrNull(data.lastUsedAt),
    createdAt: toDateOrNull(data.createdAt),
    updatedAt: toDateOrNull(data.updatedAt),
  };
}

async function fetchWithFirebaseAuth<T>(user: User, path: string, init?: RequestInit): Promise<ApiEnvelope<T>> {
  const token = await user.getIdToken();
  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });

  let payload: ApiEnvelope<T>;
  try {
    payload = await response.json();
  } catch {
    throw new Error('API応答の解析に失敗しました。');
  }

  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message || 'APIリクエストに失敗しました。');
  }

  return payload;
}

export const userApiTokenService = {
  async list(user: User): Promise<UserApiTokenSummary[]> {
    const payload = await fetchWithFirebaseAuth<{ tokens: unknown[] }>(user, '/api/v1/user-api-tokens');
    const tokens = payload.data?.tokens || [];
    return tokens.map(normalizeToken);
  },

  async create(user: User, input: { name: string; allowedEventIds: string[]; expiresInDays: number }): Promise<{ token: string; metadata: UserApiTokenSummary }> {
    const payload = await fetchWithFirebaseAuth<{ token: string; metadata: unknown }>(user, '/api/v1/user-api-tokens', {
      method: 'POST',
      body: JSON.stringify(input),
    });

    if (!payload.data?.token || !payload.data?.metadata) {
      throw new Error('トークン作成結果が不正です。');
    }

    return {
      token: payload.data.token,
      metadata: normalizeToken(payload.data.metadata),
    };
  },

  async revoke(user: User, tokenId: string): Promise<void> {
    await fetchWithFirebaseAuth<{ revoked: boolean }>(user, `/api/v1/user-api-tokens/${tokenId}`, {
      method: 'DELETE',
    });
  },

  async update(
    user: User,
    tokenId: string,
    input: { name?: string; allowedEventIds?: string[]; expiresInDays?: number }
  ): Promise<UserApiTokenSummary> {
    const payload = await fetchWithFirebaseAuth<{ token: unknown }>(user, `/api/v1/user-api-tokens/${tokenId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });

    if (!payload.data?.token) {
      throw new Error('トークン更新結果が不正です。');
    }

    return normalizeToken(payload.data.token);
  },
};
