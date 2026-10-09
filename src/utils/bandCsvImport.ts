import type { Band, EventSettings, TimeRange } from '../types';
import { normalizeTimeRanges, timeToMinutes } from './availabilityRanges';
import { generateUUID } from './generateUUID';

export const importDateColumns = (settings: EventSettings) => [
  ...(settings.rehearsalType === 'rehearsal-day'
    ? (settings.rehearsalDates ?? []).map((date, index) => ({ date, label: `リハ${index + 1}日目`, kind: 'rehearsal' as const }))
    : []),
  ...settings.performanceDates.map((date, index) => ({ date, label: `本番${index + 1}日目`, kind: 'performance' as const })),
];

const parsePositiveInteger = (value: string, label: string, rowNumber: number): number => {
  const trimmed = value.trim();
  if (!/^[1-9]\d*$/.test(trimmed) || !Number.isSafeInteger(Number(trimmed))) {
    throw new Error(`${rowNumber}行目: ${label}は正の整数で入力してください`);
  }
  return Number(trimmed);
};

const parseAvailability = (value: string, rowNumber: number, label: string) => {
  const normal: TimeRange[] = [];
  const buffer: TimeRange[] = [];
  if (!value.trim()) return { normal, buffer };

  for (const rawEntry of value.split(';')) {
    const entry = rawEntry.trim();
    const match = /^(\d{1,2}:[0-5]\d)-(\d{1,2}:[0-5]\d)(?:&type=(normal|buffer))?$/.exec(entry);
    if (!match) {
      throw new Error(`${rowNumber}行目 ${label}: 時間帯「${entry || '(空欄)'}」は 9:00-10:00 または 9:00-10:00&type=buffer の形式で入力してください`);
    }
    const startTime = match[1].padStart(5, '0');
    const endTime = match[2].padStart(5, '0');
    const start = timeToMinutes(startTime);
    const end = timeToMinutes(endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || start === 1440) {
      throw new Error(`${rowNumber}行目 ${label}: 時間帯「${entry}」の開始・終了時刻が不正です`);
    }
    (match[3] === 'buffer' ? buffer : normal).push({ startTime, endTime });
  }

  const ordered = [...normal, ...buffer]
    .map(range => ({ start: timeToMinutes(range.startTime), end: timeToMinutes(range.endTime) }))
    .sort((a, b) => a.start - b.start);
  if (ordered.some((range, index) => index > 0 && range.start < ordered[index - 1].end)) {
    throw new Error(`${rowNumber}行目 ${label}: 通常・予備の時間帯が重複しています`);
  }
  return { normal: normalizeTimeRanges(normal), buffer: normalizeTimeRanges(buffer) };
};

export const parseBandCsvRows = (rows: string[][], settings: EventSettings): Band[] => {
  const dates = importDateColumns(settings);
  const expectedColumns = 5 + dates.length;
  const bands: Band[] = [];
  const errors: string[] = [];

  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    try {
      if (row.length !== expectedColumns) {
        throw new Error(`${rowNumber}行目: ${expectedColumns}列必要ですが、${row.length}列あります`);
      }
      const name = row[0].trim();
      if (!name) throw new Error(`${rowNumber}行目: バンド名が入力されていません`);
      const performanceDuration = parsePositiveInteger(row[1], '出演時間(分)', rowNumber);
      const performanceCount = parsePositiveInteger(row[2], '出演回数', rowNumber);
      const costumeValue = row[3].trim().toLowerCase();
      if (!['0', '1', 'false', 'true'].includes(costumeValue)) {
        throw new Error(`${rowNumber}行目: 衣装は 0、1、false、true のいずれかで入力してください`);
      }
      const members = row[4].trim()
        ? row[4].split(';').map(member => member.trim())
        : [];
      if (members.some(member => !member)) {
        throw new Error(`${rowNumber}行目: メンバーは名前を ; で区切って入力してください`);
      }

      const availableTimeSlots: Band['availableTimeSlots'] = [];
      const backupRehearsalTimeSlots: NonNullable<Band['backupRehearsalTimeSlots']> = [];
      dates.forEach(({ date, label, kind }, dateIndex) => {
        const { normal, buffer } = parseAvailability(row[5 + dateIndex], rowNumber, label);
        if (kind === 'performance' && buffer.length) {
          throw new Error(`${rowNumber}行目 ${label}: 本番日の予備時間（&type=buffer）は指定できません`);
        }
        if (normal.length) availableTimeSlots.push({ date, timeRanges: normal });
        if (buffer.length) backupRehearsalTimeSlots.push({ date, timeRanges: buffer });
      });
      const now = new Date();
      bands.push({
        id: generateUUID(), name, performanceDuration, performanceCount,
        toriPriority: 1, costume: costumeValue === '1' || costumeValue === 'true',
        bandMaster: '', members, availableTimeSlots, backupRehearsalTimeSlots,
        createdAt: now, updatedAt: now,
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `${rowNumber}行目: データが不正です`);
    }
  });
  if (errors.length) {
    const displayed = errors.slice(0, 10);
    const remainder = errors.length - displayed.length;
    throw new Error(`以下のエラーがあります（${errors.length}件）:\n${displayed.join('\n')}${remainder ? `\nほか${remainder}件` : ''}`);
  }
  if (!bands.length) throw new Error('インポート可能なバンドが見つかりませんでした');
  return bands;
};
