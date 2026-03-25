import { throwApiError } from "./errors.js";

const HH_MM_REGEX = /^([01]\d|2[0-3]):(00|30)$/;
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

function validateTimeRanges(slot, slotIndex, errors) {
  if (!Array.isArray(slot.timeRanges)) {
    errors.push({ field: `availableTimeSlots[${slotIndex}].timeRanges`, message: "must be an array" });
    return;
  }

  if (slot.timeRanges.length > 8) {
    errors.push({ field: `availableTimeSlots[${slotIndex}].timeRanges`, message: "must have at most 8 ranges" });
  }

  const ranges = [];

  slot.timeRanges.forEach((range, rangeIndex) => {
    if (!range || typeof range !== "object") {
      errors.push({
        field: `availableTimeSlots[${slotIndex}].timeRanges[${rangeIndex}]`,
        message: "must be an object",
      });
      return;
    }

    if (typeof range.startTime !== "string" || !HH_MM_REGEX.test(range.startTime)) {
      errors.push({
        field: `availableTimeSlots[${slotIndex}].timeRanges[${rangeIndex}].startTime`,
        message: "must be HH:mm format and minute must be 00 or 30",
      });
    }

    if (typeof range.endTime !== "string" || !HH_MM_REGEX.test(range.endTime)) {
      errors.push({
        field: `availableTimeSlots[${slotIndex}].timeRanges[${rangeIndex}].endTime`,
        message: "must be HH:mm format and minute must be 00 or 30",
      });
    }

    if (typeof range.startTime === "string" && typeof range.endTime === "string" && HH_MM_REGEX.test(range.startTime) && HH_MM_REGEX.test(range.endTime)) {
      const start = toMinutes(range.startTime);
      const end = toMinutes(range.endTime);
      if (start >= end) {
        errors.push({
          field: `availableTimeSlots[${slotIndex}].timeRanges[${rangeIndex}]`,
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
        field: `availableTimeSlots[${slotIndex}].timeRanges[${ranges[i].rangeIndex}]`,
        message: "time ranges must not overlap",
      });
    }
  }
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
  if (!Array.isArray(availableTimeSlots)) {
    errors.push({ field: "availableTimeSlots", message: "must be an array" });
  } else {
    if (availableTimeSlots.length > 30) {
      errors.push({ field: "availableTimeSlots", message: "must have at most 30 dates" });
    }

    const seenDates = new Set();
    availableTimeSlots.forEach((slot, slotIndex) => {
      if (!slot || typeof slot !== "object") {
        errors.push({ field: `availableTimeSlots[${slotIndex}]`, message: "must be an object" });
        return;
      }

      if (typeof slot.date !== "string" || !ISO_DATE_REGEX.test(slot.date)) {
        errors.push({ field: `availableTimeSlots[${slotIndex}].date`, message: "must be YYYY-MM-DD format" });
      } else if (seenDates.has(slot.date)) {
        errors.push({ field: `availableTimeSlots[${slotIndex}].date`, message: "date must be unique" });
      } else {
        seenDates.add(slot.date);
      }

      validateTimeRanges(slot, slotIndex, errors);
    });
  }

  if (errors.length > 0) {
    throwApiError(400, "INVALID_FIELD", "Request validation failed.", errors);
  }

  return {
    eventId: payload.eventId.trim(),
    name: payload.name.trim(),
    performanceDuration: payload.performanceDuration,
    performanceCount,
    members: members.map((member) => member.trim()).filter(Boolean),
    availableTimeSlots,
  };
}
