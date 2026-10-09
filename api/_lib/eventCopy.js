import { ApiError } from "./errors.js";

const MAX_BATCH_WRITES = 499;

function entryCount(timetable) {
  return (timetable.dailyTimetables || []).reduce((total, day) => total + (
    day.cools?.length
      ? day.cools.reduce((count, cool) => count + (cool.entries || []).length, 0)
      : (day.entries || []).length
  ), 0);
}

function selectTimetables(docs) {
  const byType = new Map();
  for (const doc of docs) {
    const data = doc.data();
    if (data.type !== "performance" && data.type !== "rehearsal") continue;
    const previous = byType.get(data.type);
    if (!previous || (data.dailyTimetables || []).length > (previous.dailyTimetables || []).length
      || ((data.dailyTimetables || []).length === (previous.dailyTimetables || []).length && entryCount(data) > entryCount(previous))) {
      byType.set(data.type, data);
    }
  }
  return [...byType.values()];
}

function remapDays(days, bandIds) {
  const remapEntry = entry => entry.type === "band" && entry.bandId && bandIds.has(entry.bandId)
    ? { ...entry, bandId: bandIds.get(entry.bandId) }
    : { ...entry };
  return (days || []).map(day => ({
    ...day,
    entries: (day.entries || []).map(remapEntry),
    cools: (day.cools || []).map(cool => ({ ...cool, entries: (cool.entries || []).map(remapEntry) })),
  }));
}

/** One server-side commit makes the copy complete even if the browser closes. */
export async function copyEventOnServer(db, sourceEventId, userId) {
  const sourceEventRef = db.collection("events").doc(sourceEventId);
  const sourceEvent = await sourceEventRef.get();
  if (!sourceEvent.exists) throw new ApiError(404, "EVENT_NOT_FOUND", "Event was not found.");
  const settings = sourceEvent.data();
  if (settings.ownerId !== userId) throw new ApiError(403, "FORBIDDEN", "Only the event owner can copy it.");
  const copyableSettings = Object.fromEntries(Object.entries(settings).filter(([key]) =>
    !/(?:token|password|secret|apiKey)/i.test(key)));

  const [bands, timetableDocs] = await Promise.all([
    db.collection("bands").where("eventId", "==", sourceEventId).get(),
    db.collection("timetables").where("eventId", "==", sourceEventId).get(),
  ]);

  const timetables = selectTimetables(timetableDocs.docs);
  if (1 + bands.size + timetables.length > MAX_BATCH_WRITES) {
    throw new ApiError(413, "EVENT_TOO_LARGE", "This event is too large to copy in one operation.");
  }

  const now = new Date();
  const destinationEventRef = db.collection("events").doc();
  const bandIds = new Map(bands.docs.map(doc => [doc.id, db.collection("bands").doc().id]));
  const batch = db.batch();
  batch.set(destinationEventRef, {
    ...copyableSettings,
    name: `${settings.name} (コピー)`,
    ownerId: userId,
    isPublic: false,
    collaboratorEmails: [],
    pendingCollaboratorEmails: [],
    pendingOwnerEmail: "",
    transferFromOwnerEmail: "",
    createdAt: now,
    updatedAt: now,
  });
  for (const doc of bands.docs) {
    batch.set(db.collection("bands").doc(bandIds.get(doc.id)), {
      ...doc.data(), eventId: destinationEventRef.id, createdAt: now, updatedAt: now,
    });
  }
  for (const timetable of timetables) {
    batch.set(db.collection("timetables").doc(), {
      ...timetable,
      eventId: destinationEventRef.id,
      dailyTimetables: remapDays(timetable.dailyTimetables, bandIds),
      createdAt: now,
      updatedAt: now,
    });
  }
  await batch.commit();
  return { eventId: destinationEventRef.id, bandCount: bands.size, timetableCount: timetables.length };
}
