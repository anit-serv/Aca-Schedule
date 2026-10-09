import { throwApiError } from "./errors.js";

const HH_MM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const END_TIME_REGEX = /^(?:([01]\d|2[0-3]):[0-5]\d|24:00)$/;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function ensureString(value, min, max, field, errors) {
  if (typeof value !== "string") {
    errors.push({ field, message: "must be a string" });
    return;
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    errors.push({ field, message: `must be between ${min} and ${max} characters` });
  }
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function validateTimeRanges(slot, slotIndex, errors, fieldName = "availableTimeSlots") {
  if (!Array.isArray(slot.timeRanges)) {
    errors.push({ field: `${fieldName}[${slotIndex}].timeRanges`, message: "must be an array" });
    return;
  }

  if (slot.timeRanges.length > 8) {
    errors.push({ field: `${fieldName}[${slotIndex}].timeRanges`, message: "must have at most 8 ranges" });
  }

  const ranges = [];

  slot.timeRanges.forEach((range, rangeIndex) => {
    if (!range || typeof range !== "object") {
      errors.push({
        field: `${fieldName}[${slotIndex}].timeRanges[${rangeIndex}]`,
        message: "must be an object",
      });
      return;
    }

    if (typeof range.startTime !== "string" || !HH_MM_REGEX.test(range.startTime)) {
      errors.push({
        field: `${fieldName}[${slotIndex}].timeRanges[${rangeIndex}].startTime`,
        message: "must be HH:mm format",
      });
    }

    if (typeof range.endTime !== "string" || !END_TIME_REGEX.test(range.endTime)) {
      errors.push({
        field: `${fieldName}[${slotIndex}].timeRanges[${rangeIndex}].endTime`,
        message: "must be HH:mm format (24:00 is allowed as an end)",
      });
    }

    if (typeof range.startTime === "string" && typeof range.endTime === "string" && HH_MM_REGEX.test(range.startTime) && END_TIME_REGEX.test(range.endTime)) {
      const start = toMinutes(range.startTime);
      const end = toMinutes(range.endTime);
      if (start >= end) {
        errors.push({
          field: `${fieldName}[${slotIndex}].timeRanges[${rangeIndex}]`,
          message: "endTime must be later than startTime",
        });
      } else {
        ranges.push({ start, end, rangeIndex });
      }
    }
  });

  ranges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i += 1) {
    if (ranges[i].start < ranges[i - 1].end) {
      errors.push({
        field: `${fieldName}[${slotIndex}].timeRanges[${ranges[i].rangeIndex}]`,
        message: "time ranges must not overlap",
      });
    }
  }
}

export function validateAvailabilitySlots(slots, fieldName = "availableTimeSlots") {
  const errors = [];
  if (!Array.isArray(slots)) {
    errors.push({ field: fieldName, message: "must be an array" });
  } else {
    if (slots.length > 30) {
      errors.push({ field: fieldName, message: "must have at most 30 dates" });
    }
    const seenDates = new Set();
    slots.forEach((slot, slotIndex) => {
      if (!slot || typeof slot !== "object") {
        errors.push({ field: `${fieldName}[${slotIndex}]`, message: "must be an object" });
        return;
      }
      if (typeof slot.date !== "string" || !ISO_DATE_REGEX.test(slot.date)) {
        errors.push({ field: `${fieldName}[${slotIndex}].date`, message: "must be YYYY-MM-DD format" });
      } else if (seenDates.has(slot.date)) {
        errors.push({ field: `${fieldName}[${slotIndex}].date`, message: "date must be unique" });
      } else {
        seenDates.add(slot.date);
      }
      validateTimeRanges(slot, slotIndex, errors, fieldName);
    });
  }
  if (errors.length > 0) {
    throwApiError(400, "INVALID_FIELD", "Request validation failed.", errors);
  }
  return slots;
}

export function validateBackupRehearsalContext(backupSlots, normalSlots, event, rehearsalDays) {
  const errors = [];
  const rehearsalDates = event.rehearsalType === "rehearsal-day"
    ? event.rehearsalDates || []
    : event.rehearsalType === "none" ? [] : event.performanceDates || [];
  const allowedDates = new Set(rehearsalDates);
  const daysByDate = new Map((rehearsalDays || []).map(day => [day.date, day]));
  backupSlots.forEach((slot, slotIndex) => {
    const field = `backupRehearsalTimeSlots[${slotIndex}]`;
    if (!allowedDates.has(slot.date)) {
      errors.push({ field: `${field}.date`, message: "must be a rehearsal date for this event" });
      return;
    }
    const day = daysByDate.get(slot.date);
    if (!day || typeof day.startTime !== "string" || !HH_MM_REGEX.test(day.startTime)) {
      errors.push({ field: `${field}.date`, message: "rehearsal timetable start time is not configured for this date" });
      return;
    }
    const dayStart = toMinutes(day.startTime);
    const dayEnd = day.endTime ? toMinutes(day.endTime) : 1440;
    const normalRanges = normalSlots.find(item => item.date === slot.date)?.timeRanges || [];
    slot.timeRanges.forEach((range, rangeIndex) => {
      const start = toMinutes(range.startTime);
      const end = toMinutes(range.endTime);
      const rangeField = `${field}.timeRanges[${rangeIndex}]`;
      if (start < dayStart || end > dayEnd) {
        errors.push({ field: rangeField, message: "must stay within the rehearsal day's start and end times" });
      }
      if (normalRanges.some(normal => start < toMinutes(normal.endTime) && toMinutes(normal.startTime) < end)) {
        errors.push({ field: rangeField, message: "must not overlap availableTimeSlots" });
      }
    });
  });
  if (errors.length > 0) throwApiError(400, "INVALID_FIELD", "Request validation failed.", errors);
}

export function validateCreateBandPayload(payload) {
  const errors = [];

  if (!payload || typeof payload !== "object") {
    throwApiError(400, "INVALID_BODY", "Body must be a JSON object.");
  }

  ensureString(payload.eventId, 1, 64, "eventId", errors);
  ensureString(payload.name, 1, 100, "name", errors);

  if (typeof payload.performanceDuration !== "number" || !Number.isInteger(payload.performanceDuration)) {
    errors.push({ field: "performanceDuration", message: "must be an integer" });
  } else if (payload.performanceDuration < 1 || payload.performanceDuration > 180) {
    errors.push({ field: "performanceDuration", message: "must be between 1 and 180" });
  }

  const performanceCount = payload.performanceCount ?? 1;
  if (typeof performanceCount !== "number" || !Number.isInteger(performanceCount)) {
    errors.push({ field: "performanceCount", message: "must be an integer" });
  } else if (performanceCount < 1 || performanceCount > 10) {
    errors.push({ field: "performanceCount", message: "must be between 1 and 10" });
  }

  const toriPriority = payload.toriPriority === undefined ? 1 : payload.toriPriority;
  if (![1, 2, 3].includes(toriPriority)) {
    errors.push({ field: "toriPriority", message: "must be 1, 2, or 3" });
  }

  const costume = payload.costume === undefined ? false : payload.costume;
  if (typeof costume !== "boolean") {
    errors.push({ field: "costume", message: "must be a boolean" });
  }

  const bandMaster = payload.bandMaster === undefined ? "" : payload.bandMaster;
  if (typeof bandMaster !== "string" || bandMaster.trim().length > 100) {
    errors.push({ field: "bandMaster", message: "must be a string of at most 100 characters" });
  }

  const members = payload.members ?? [];
  if (!Array.isArray(members)) {
    errors.push({ field: "members", message: "must be an array" });
  } else {
    if (members.length > 30) {
      errors.push({ field: "members", message: "must have at most 30 members" });
    }
    members.forEach((member, index) => {
      if (typeof member !== "string") {
        errors.push({ field: `members[${index}]`, message: "must be a string" });
      } else {
        const trimmed = member.trim();
        if (trimmed.length < 1 || trimmed.length > 40) {
          errors.push({ field: `members[${index}]`, message: "must be between 1 and 40 characters" });
        }
      }
    });
  }

  const availableTimeSlots = payload.availableTimeSlots ?? [];
  const backupRehearsalTimeSlots = payload.backupRehearsalTimeSlots ?? [];
  for (const [slots, fieldName] of [[availableTimeSlots, "availableTimeSlots"], [backupRehearsalTimeSlots, "backupRehearsalTimeSlots"]]) {
    try {
      validateAvailabilitySlots(slots, fieldName);
    } catch (error) {
      if (error?.code === "INVALID_FIELD") errors.push(...error.details);
      else throw error;
    }
  }

  if (errors.length > 0) {
    throwApiError(400, "INVALID_FIELD", "Request validation failed.", errors);
  }

  return {
    eventId: payload.eventId.trim(),
    name: payload.name.trim(),
    performanceDuration: payload.performanceDuration,
    performanceCount,
    toriPriority,
    costume,
    bandMaster: bandMaster.trim(),
    members: members.map((member) => member.trim()).filter(Boolean),
    availableTimeSlots,
    backupRehearsalTimeSlots,
  };
}
