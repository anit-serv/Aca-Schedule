export interface ProgressRecord {
  actualStart?: string;
  actualEnd?: string;
}

export interface ProgressHistoryItem {
  key: string;
  coolId: string;
  field: 'start' | 'end';
  actualTime: string;
  at: string;
}

export interface StakeholderProgress {
  version: number;
  records: Record<string, ProgressRecord>;
  history: ProgressHistoryItem[];
}

export const progressKey = (type: 'performance' | 'rehearsal', date: string, entryId: string) => `${type}|${date}|${entryId}`;

async function request(body: Record<string, unknown>): Promise<StakeholderProgress> {
  const response = await fetch('/api/v1/viewer', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store',
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error?.code || 'PROGRESS_ERROR');
  return result.data as StakeholderProgress;
}

export const stakeholderProgressService = {
  read(eventId: string, password: string) {
    return request({ action: 'read', eventId, password });
  },
  apply(args: { eventId: string; password: string; timetableType: 'performance' | 'rehearsal'; date: string; coolId: string; entryId: string; field: 'start' | 'end'; actualTime: string; expectedVersion: number }) {
    return request({ action: 'apply', ...args });
  },
};
