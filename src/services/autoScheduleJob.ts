import type { User } from 'firebase/auth';
import type { AutoScheduleRange } from '../utils/autoSchedule';

export interface AutoScheduleJob {
  type?: 'performance' | 'rehearsal';
  range?: AutoScheduleRange | null;
  runId?: string;
  status: 'none' | 'preparing' | 'previewing' | 'prepared' | 'queued' | 'running' | 'completed' | 'failed';
  started?: boolean;
  placed?: number;
  remaining?: number;
  error?: string;
  timings?: { fetchMs?: number; computeMs?: number; saveMs?: number; totalMs?: number } | null;
  updatedAt?: string | null;
}

const statusOrder: Record<AutoScheduleJob['status'], number> = {
  none: 0, preparing: 1, previewing: 2, prepared: 3,
  queued: 4, running: 5, completed: 6, failed: 6,
};

/** Ignore an older poll response for the same run after a newer state arrived. */
export const latestAutoScheduleJob = (current: AutoScheduleJob | null, incoming: AutoScheduleJob): AutoScheduleJob =>
  current?.runId && current.runId === incoming.runId && statusOrder[current.status] > statusOrder[incoming.status]
    ? current : incoming;

async function request(user: User, eventId: string, method: 'GET' | 'POST', type: 'performance' | 'rehearsal' = 'performance', range?: AutoScheduleRange, action?: 'prepare' | 'apply-preview', runId?: string): Promise<AutoScheduleJob> {
  const token = await user.getIdToken();
  const response = await fetch(method === 'GET'
    ? `/api/v1/events/auto-schedule?eventId=${encodeURIComponent(eventId)}`
    : '/api/v1/events/auto-schedule', {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify({ eventId, type, range, action, runId }) : undefined,
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
  prepare: (user: User, eventId: string, type: 'performance' | 'rehearsal', range?: AutoScheduleRange) => request(user, eventId, 'POST', type, range, 'prepare'),
  applyPreview: (user: User, eventId: string, runId: string) => request(user, eventId, 'POST', 'performance', undefined, 'apply-preview', runId),
  get: (user: User, eventId: string) => request(user, eventId, 'GET'),
};
