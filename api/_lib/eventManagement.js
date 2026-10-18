import { ApiError } from "./errors.js";

const MAX_BATCH_WRITES = 499;
const rehearsalTypes = new Set(["none", "rehearsal-day", "cool-pre-rehearsal", "day-start-rehearsal"]);
const isDate = value => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

function validateCreateInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ApiError(400, "INVALID_BODY", "Event settings are required.");
  }
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 200) throw new ApiError(400, "INVALID_NAME", "Event name is required and must be at most 200 characters.");
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) {
    throw new ApiError(400, "INVALID_YEAR", "Year must be between 2000 and 2100.");
  }
  if (typeof input.venue !== "string" || input.venue.length > 500 || typeof input.goal !== "string" || input.goal.length > 5000) {
    throw new ApiError(400, "INVALID_FIELD", "Venue or goal is invalid.");
  }
  if (!Array.isArray(input.performanceDates) || input.performanceDates.length < 1 || input.performanceDates.length > 100
    || !input.performanceDates.every(isDate)) {
    throw new ApiError(400, "INVALID_DATES", "At least one valid performance date is required.");
  }
  if (!rehearsalTypes.has(input.rehearsalType)) throw new ApiError(400, "INVALID_REHEARSAL_TYPE", "Rehearsal type is invalid.");
  if (input.rehearsalType === "rehearsal-day"
    && (!Array.isArray(input.rehearsalDates) || input.rehearsalDates.length < 1 || input.rehearsalDates.length > 100
      || !input.rehearsalDates.every(isDate))) {
    throw new ApiError(400, "INVALID_DATES", "At least one valid rehearsal date is required.");
  }
  if (input.rehearsalType !== "none" && (!Number.isInteger(input.rehearsalDuration) || input.rehearsalDuration < 1 || input.rehearsalDuration > 240)) {
    throw new ApiError(400, "INVALID_REHEARSAL_DURATION", "Rehearsal duration is invalid.");
  }
  if (!Array.isArray(input.presetDurations) || input.presetDurations.length > 50
    || !input.presetDurations.every(value => Number.isInteger(value) && value > 0 && value <= 240)) {
    throw new ApiError(400, "INVALID_PRESET_DURATIONS", "Preset durations are invalid.");
  }
  return {
    name,
    year: input.year,
    venue: input.venue.trim(),
    goal: input.goal.trim(),
    performanceDates: [...new Set(input.performanceDates)].sort(),
    rehearsalType: input.rehearsalType,
    ...(input.rehearsalType === "rehearsal-day" ? { rehearsalDates: [...new Set(input.rehearsalDates)].sort() } : {}),
    ...(input.rehearsalType !== "none" ? { rehearsalDuration: input.rehearsalDuration } : {}),
    presetDurations: input.presetDurations,
  };
}

export async function createEventOnServer(db, input, userId) {
  const settings = validateCreateInput(input);
  const now = new Date();
  const eventRef = db.collection("events").doc();
  const batch = db.batch();
  batch.set(eventRef, {
    ...settings, ownerId: userId, isPublic: false,
    collaboratorEmails: [], pendingCollaboratorEmails: [], pendingOwnerEmail: "", transferFromOwnerEmail: "",
    createdAt: now, updatedAt: now,
  });
  for (const type of settings.rehearsalType === "none" ? ["performance"] : ["performance", "rehearsal"]) {
    batch.set(db.collection("timetables").doc(), {
      eventId: eventRef.id, type, dailyTimetables: [], createdAt: now, updatedAt: now,
    });
  }
  await batch.commit();
  return { eventId: eventRef.id };
}

export async function deleteEventOnServer(db, eventId, userId) {
  const eventRef = db.collection("events").doc(eventId);
  const event = await eventRef.get();
  if (!event.exists) throw new ApiError(404, "EVENT_NOT_FOUND", "Event was not found.");
  if (event.data().ownerId !== userId) throw new ApiError(403, "FORBIDDEN", "Only the event owner can delete it.");
  const [bands, timetables] = await Promise.all([
    db.collection("bands").where("eventId", "==", eventId).get(),
    db.collection("timetables").where("eventId", "==", eventId).get(),
  ]);
  if (4 + bands.size + timetables.size > MAX_BATCH_WRITES) {
    throw new ApiError(413, "EVENT_TOO_LARGE", "This event is too large to delete in one operation.");
  }
  const batch = db.batch();
  for (const doc of bands.docs) batch.delete(doc.ref);
  for (const doc of timetables.docs) batch.delete(doc.ref);
  batch.delete(db.collection("viewerPasswords").doc(eventId));
  batch.delete(db.collection("stakeholderProgress").doc(eventId));
  batch.delete(db.collection("autoScheduleJobs").doc(eventId));
  batch.delete(eventRef);
  await batch.commit();
  return { eventId, bandCount: bands.size, timetableCount: timetables.size };
}
