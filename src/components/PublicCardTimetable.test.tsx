import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
import type { Band, EventSettings, DailyTimetable } from '../types';
import { PublicCardTimetable } from './PublicCardTimetable';

it('shows stakeholder-adjusted performance times and shifts later entries in the same cool', () => {
  const date = '2026-11-15';
  const settings = { id: 'event', name: 'ライブ', venue: '会場', performanceDates: [date] } as EventSettings;
  const bands: Band[] = ['a', 'b'].map(id => ({
    id, name: `バンド${id.toUpperCase()}`, performanceDuration: 10, performanceCount: 1,
    members: [], toriPriority: 1, costume: false, bandMaster: '', availableTimeSlots: [],
    createdAt: new Date(), updatedAt: new Date(),
  }));
  const dailyTimetables = [{ date, startTime: '10:00', entries: [], cools: [{ id: 'cool', number: 1, startTime: '10:00', entries: [
    { id: 'a', type: 'band', bandId: 'a', order: 0, startTime: '10:00', endTime: '10:10' },
    { id: 'b', type: 'band', bandId: 'b', order: 1, startTime: '10:15', endTime: '10:25' },
  ] }] }] as DailyTimetable[];
  render(<MemoryRouter><PublicCardTimetable settings={settings} bands={bands} dailyTimetables={dailyTimetables}
    progressRecords={{ [`performance|${date}|a`]: { actualStart: '10:05' } }} eventId="event" /></MemoryRouter>);
  expect(screen.getByRole('status').textContent).toContain('進行時刻の調整');
  expect(screen.getByText('10:05')).toBeTruthy();
  expect(screen.getByText('10:20')).toBeTruthy();
  expect(screen.getAllByText('5分遅れ')).toHaveLength(2);
});

it('shows separate start and end differences when an adjusted performance changes duration', () => {
  const date = '2026-11-15';
  const settings = { id: 'event', name: 'ライブ', venue: '会場', performanceDates: [date] } as EventSettings;
  const bands: Band[] = [{
    id: 'a', name: 'バンドA', performanceDuration: 10, performanceCount: 1,
    members: [], toriPriority: 1, costume: false, bandMaster: '', availableTimeSlots: [],
    createdAt: new Date(), updatedAt: new Date(),
  }];
  const dailyTimetables = [{ date, startTime: '10:00', entries: [], cools: [{
    id: 'cool', number: 1, startTime: '10:00', entries: [
      { id: 'a', type: 'band', bandId: 'a', order: 0, startTime: '10:00', endTime: '10:10' },
    ],
  }] }] as DailyTimetable[];
  render(<MemoryRouter><PublicCardTimetable settings={settings} bands={bands} dailyTimetables={dailyTimetables}
    progressRecords={{ [`performance|${date}|a`]: { actualStart: '10:05', actualEnd: '10:07' } }} eventId="event" /></MemoryRouter>);
  expect(screen.getByText('開始 5分遅れ')).toBeTruthy();
  expect(screen.getByText('終了 3分早まり')).toBeTruthy();
});
