import type { User } from 'firebase/auth';
import type { AutoScheduleRange } from '../utils/autoSchedule';

export interface AutoScheduleJob {
  type?: 'performance' | 'rehearsal';
  range?: AutoScheduleRange | null;
  runId?: string;
  status: 'none' | 'queued' | 'running' | 'completed' | 'failed';
  started?: boolean;
  placed?: number;
  remaining?: number;
  error?: string;
  timings?: { fetchMs?: number; computeMs?: number; saveMs?: number; totalMs?: number } | null;
  updatedAt?: string | null;
}

async function request(user: User, eventId: string, method: 'GET' | 'POST', type: 'performance' | 'rehearsal' = 'performance', range?: AutoScheduleRange): Promise<AutoScheduleJob> {
  const token = await user.getIdToken();
  const response = await fetch(method === 'GET'
    ? `/api/v1/events/auto-schedule?eventId=${encodeURIComponent(eventId)}`
    : '/api/v1/events/auto-schedule', {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify({ eventId, type, range }) : undefined,
    cache: 'no-store',
  });
  const payload = await response.json() as {
    success: boolean;
    data?: AutoScheduleJob;
    error?: { message?: string };
  };
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error?.message || '自動配置ジョブの操作に失敗しました。');
  }
  return payload.data;
}

export const autoScheduleJobService = {
  start: (user: User, eventId: string, type: 'performance' | 'rehearsal', range?: AutoScheduleRange) => request(user, eventId, 'POST', type, range),
  get: (user: User, eventId: string) => request(user, eventId, 'GET'),
};
