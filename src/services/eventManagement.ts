import type { User } from 'firebase/auth';
import type { EventSettings } from '../types';

export type EventCreateInput = Omit<EventSettings, 'id' | 'ownerId'>;

async function request<T>(user: User, path: string, init: RequestInit): Promise<T> {
  const token = await user.getIdToken();
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init.headers },
    cache: 'no-store',
  });
  const payload = await response.json() as {
    success: boolean;
    data?: T;
    error?: { message?: string; code?: string };
  };
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error?.message || 'イベントの操作に失敗しました。');
  }
  return payload.data;
}

export const eventManagementService = {
  async create(user: User, settings: EventCreateInput): Promise<string> {
    const result = await request<{ eventId: string }>(user, '/api/v1/events', {
      method: 'POST', body: JSON.stringify(settings),
    });
    return result.eventId;
  },
  async copy(user: User, eventId: string): Promise<string> {
    const result = await request<{ eventId: string }>(user, '/api/v1/events/copy', {
      method: 'POST', body: JSON.stringify({ eventId }),
    });
    return result.eventId;
  },
  async remove(user: User, eventId: string): Promise<void> {
    await request<{ eventId: string }>(user, '/api/v1/events/delete', {
      method: 'POST', body: JSON.stringify({ eventId }),
    });
  },
};
