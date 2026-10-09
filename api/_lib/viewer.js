import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

export function parseEventId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) return null;
  return value;
}

export async function hashViewerPassword(password) {
  const salt = randomBytes(32).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return { salt, hash: hash.toString("hex") };
}

export async function verifyViewerPassword(password, secret) {
  if (typeof password !== "string" || !secret || typeof secret.salt !== "string" || typeof secret.hash !== "string") return false;
  const expected = Buffer.from(secret.hash, "hex");
  if (expected.length !== 64) return false;
  const actual = await scrypt(password, secret.salt, 64);
  return timingSafeEqual(actual, expected);
}

function publicCustomFields(customFields) {
  if (!customFields) return undefined;
  const result = {};
  for (const type of ["performance", "rehearsal"]) {
    const source = customFields[type] || { columns: [], dailyData: {} };
    const columns = (source.columns || []).filter(column => column.isPublic === true).map(column =>
      column.shift ? { ...column, shift: { ...column.shift, candidates: [] } } : column
    );
    const visibleIds = new Set(columns.map(column => column.id));
    const dailyData = {};
    for (const [date, daily] of Object.entries(source.dailyData || {})) {
      const filterRows = rows => Object.fromEntries(
        Object.entries(rows || {}).map(([rowId, cells]) => [
          rowId,
          Object.fromEntries(Object.entries(cells || {}).filter(([columnId]) => visibleIds.has(columnId))),
        ]).filter(([, cells]) => Object.keys(cells).length > 0)
      );
      dailyData[date] = {
        bySequence: filterRows(daily.bySequence),
        byEntity: filterRows(daily.byEntity),
      };
    }
    result[type] = { columns, dailyData };
  }
  return result;
}

export function projectViewerData(eventId, settings, bands, timetables, audience, progress = {}) {
  const stakeholder = audience === "stakeholder";
  const performanceEntries = new Set(timetables.filter(table => table.type === "performance").flatMap(table =>
    (table.dailyTimetables || []).flatMap(day =>
      (day.cools?.length ? day.cools.flatMap(cool => cool.entries || []) : day.entries || [])
        .map(entry => `performance|${day.date}|${entry.id}`))));
  const publicProgressRecords = Object.fromEntries(Object.entries(progress.records || {})
    .filter(([key]) => performanceEntries.has(key))
    .map(([key, record]) => [key, Object.fromEntries(["actualStart", "actualEnd"]
      .filter(field => typeof record?.[field] === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(record[field]))
      .map(field => [field, record[field]]))])
    .filter(([, record]) => Object.keys(record).length > 0));
  return {
    ...(stakeholder ? {} : { progressRecords: publicProgressRecords }),
    settings: {
      id: eventId,
      name: settings.name,
      year: settings.year,
      venue: settings.venue,
      performanceDates: settings.performanceDates || [],
      rehearsalType: settings.rehearsalType || "none",
      rehearsalDates: settings.rehearsalDates || [],
      rehearsalDuration: settings.rehearsalDuration,
      presetDurations: settings.presetDurations || [],
      customFields: stakeholder ? settings.customFields : publicCustomFields(settings.customFields),
      isPublic: settings.isPublic === true,
    },
    bands: bands.map(band => ({
      id: band.id,
      name: band.name,
      performanceDuration: band.performanceDuration,
      performanceCount: band.performanceCount,
      members: stakeholder ? (band.members || []) : [],
      availableTimeSlots: stakeholder ? (band.availableTimeSlots || []) : [],
      backupRehearsalTimeSlots: stakeholder ? (band.backupRehearsalTimeSlots || []) : [],
      createdAt: band.createdAt?.toDate?.()?.toISOString?.() || null,
      updatedAt: band.updatedAt?.toDate?.()?.toISOString?.() || null,
    })),
    timetables: (stakeholder ? timetables : timetables.filter(timetable => timetable.type === "performance")).map(timetable => ({
      id: timetable.id,
      eventId,
      type: timetable.type,
      dailyTimetables: timetable.dailyTimetables || [],
      createdAt: timetable.createdAt?.toDate?.()?.toISOString?.() || null,
      updatedAt: timetable.updatedAt?.toDate?.()?.toISOString?.() || null,
    })),
  };
}
