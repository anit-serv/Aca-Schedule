import type { Band, EventSettings, Timetable } from '../types';
import type { User } from 'firebase/auth';
import type { ProgressRecord } from './stakeholderProgress';

interface ViewerPayload {
  progressRecords?: Record<string, ProgressRecord>;
  settings: Partial<EventSettings> & Pick<EventSettings, 'id' | 'name' | 'year' | 'venue' | 'performanceDates' | 'rehearsalType'>;
  bands: Array<Omit<Band, 'createdAt' | 'updatedAt'> & { createdAt: string | null; updatedAt: string | null }>;
  timetables: Array<Omit<Timetable, 'createdAt' | 'updatedAt'> & { createdAt: string | null; updatedAt: string | null }>;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message?: string };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as ApiResponse<T>;
  if (!response.ok || !body.success || !body.data) {
    throw new Error(body.error?.code || 'VIEWER_ERROR');
  }
  return body.data;
}

function normalize(payload: ViewerPayload) {
  const settings: EventSettings = {
    ...payload.settings,
    goal: '',
    ownerId: '',
    presetDurations: payload.settings.presetDurations || [],
  };
  const bands: Band[] = payload.bands.map(band => ({
    ...band,
    createdAt: band.createdAt ? new Date(band.createdAt) : new Date(0),
    updatedAt: band.updatedAt ? new Date(band.updatedAt) : new Date(0),
  }));
  const timetables: Timetable[] = payload.timetables.map(timetable => ({
    ...timetable,
    createdAt: timetable.createdAt ? new Date(timetable.createdAt) : new Date(0),
    updatedAt: timetable.updatedAt ? new Date(timetable.updatedAt) : new Date(0),
  }));
  return { settings, bands, timetables, progressRecords: payload.progressRecords || {} };
}

export const viewerService = {
  async loadPublic(eventId: string) {
    const response = await fetch(`/api/v1/viewer?eventId=${encodeURIComponent(eventId)}`, { cache: 'no-store' });
    return normalize(await parseResponse<ViewerPayload>(response));
  },
  async loadStakeholder(eventId: string, password: string) {
    const response = await fetch('/api/v1/viewer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId, password }),
      cache: 'no-store',
    });
    return normalize(await parseResponse<ViewerPayload>(response));
  },
};

async function passwordRequest(user: User, path: string, init?: RequestInit) {
  const token = await user.getIdToken();
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init?.headers },
    cache: 'no-store',
  });
  return parseResponse<{ configured: boolean }>(response);
}

export const viewerPasswordService = {
  status(user: User, eventId: string) {
    return passwordRequest(user, `/api/v1/viewer-password?eventId=${encodeURIComponent(eventId)}`);
  },
  set(user: User, eventId: string, password: string) {
    return passwordRequest(user, '/api/v1/viewer-password', { method: 'PUT', body: JSON.stringify({ eventId, password }) });
  },
  remove(user: User, eventId: string) {
    return passwordRequest(user, '/api/v1/viewer-password', { method: 'DELETE', body: JSON.stringify({ eventId }) });
  },
};
