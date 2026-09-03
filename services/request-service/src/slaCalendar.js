const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5]; // ISO weekday: Monday=1 ... Sunday=7
const DEFAULT_START = '09:00';
const DEFAULT_END = '17:00';

function validTimeZone(timeZone) {
  const candidate = String(timeZone || '').trim() || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return 'UTC';
  }
}

function parseClock(value, fallback) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return parseClock(fallback, '09:00');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return parseClock(fallback, '09:00');
  }
  return { hour, minute, totalMinutes: (hour * 60) + minute, text: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
}

function dateKey(parts) {
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function cleanHoliday(item) {
  if (typeof item === 'string') {
    const date = item.trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? { date, name: '' } : null;
  }
  const date = String(item?.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { date, name: String(item?.name || '').trim().slice(0, 120) };
}

export function normalizeBusinessCalendar(value = {}, fallbackTimeZone = 'UTC') {
  const workingDays = [...new Set((Array.isArray(value?.workingDays) ? value.workingDays : DEFAULT_WORKING_DAYS)
    .map(Number)
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))].sort((a, b) => a - b);
  const start = parseClock(value?.dayStart || value?.startTime, DEFAULT_START);
  let end = parseClock(value?.dayEnd || value?.endTime, DEFAULT_END);
  if (end.totalMinutes <= start.totalMinutes) end = parseClock(DEFAULT_END, '17:00');
  const holidays = (Array.isArray(value?.holidays) ? value.holidays : []).map(cleanHoliday).filter(Boolean);
  const uniqueHolidays = [...new Map(holidays.map((item) => [item.date, item])).values()].sort((a, b) => a.date.localeCompare(b.date));
  return {
    timeZone: validTimeZone(value?.timeZone || value?.timezone || fallbackTimeZone),
    workingDays: workingDays.length ? workingDays : DEFAULT_WORKING_DAYS,
    dayStart: start.text,
    dayEnd: end.text,
    holidays: uniqueHolidays
  };
}

function formatter(timeZone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  });
}

export function zonedParts(dateValue, timeZone) {
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  const parts = {};
  for (const part of formatter(validTimeZone(timeZone)).formatToParts(date)) {
    if (['year', 'month', 'day', 'hour', 'minute', 'second'].includes(part.type)) parts[part.type] = Number(part.value);
  }
  return parts;
}

function isoWeekday(parts) {
  const jsDay = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

function addLocalDays(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function zonedLocalToUtc(parts, timeZone) {
  const tz = validTimeZone(timeZone);
  const targetAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0, parts.millisecond || 0);
  let guess = targetAsUtc;
  for (let i = 0; i < 6; i += 1) {
    const observed = zonedParts(new Date(guess), tz);
    const observedAsUtc = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour || 0, observed.minute || 0, observed.second || 0, 0);
    const delta = targetAsUtc - observedAsUtc;
    if (Math.abs(delta) < 1000) break;
    guess += delta;
  }
  return new Date(guess);
}

function businessWindow(localDate, calendar) {
  const start = parseClock(calendar.dayStart, DEFAULT_START);
  const end = parseClock(calendar.dayEnd, DEFAULT_END);
  return {
    start: zonedLocalToUtc({ ...localDate, hour: start.hour, minute: start.minute, second: 0 }, calendar.timeZone),
    end: zonedLocalToUtc({ ...localDate, hour: end.hour, minute: end.minute, second: 0 }, calendar.timeZone)
  };
}

function isWorkingLocalDate(localDate, calendar) {
  const holidaySet = new Set((calendar.holidays || []).map((item) => item.date));
  return calendar.workingDays.includes(isoWeekday(localDate)) && !holidaySet.has(dateKey(localDate));
}

function nextWorkingStart(localDate, calendar, includeCurrent = false) {
  let cursor = includeCurrent ? { ...localDate } : addLocalDays(localDate, 1);
  for (let i = 0; i < 3700; i += 1) {
    if (isWorkingLocalDate(cursor, calendar)) return businessWindow(cursor, calendar).start;
    cursor = addLocalDays(cursor, 1);
  }
  throw new Error('Unable to find a working day in the configured SLA calendar.');
}

export function businessMinutesPerDay(calendarValue = {}) {
  const calendar = normalizeBusinessCalendar(calendarValue, calendarValue?.timeZone || 'UTC');
  const start = parseClock(calendar.dayStart, DEFAULT_START);
  const end = parseClock(calendar.dayEnd, DEFAULT_END);
  return Math.max(1, end.totalMinutes - start.totalMinutes);
}

export function targetMinutes(value, unit, calendarValue = {}) {
  const amount = Number(value);
  const normalizedUnit = String(unit || '').trim().toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0 || normalizedUnit === 'none') return null;
  if (normalizedUnit === 'minutes') return amount;
  if (normalizedUnit === 'hours' || normalizedUnit === 'business_hours') return amount * 60;
  if (normalizedUnit === 'days') return amount * 24 * 60;
  if (normalizedUnit === 'business_days') return amount * businessMinutesPerDay(calendarValue);
  if (normalizedUnit === 'daily') return 24 * 60;
  if (normalizedUnit === 'twice_daily') return 12 * 60;
  if (normalizedUnit === 'weekly') return 7 * 24 * 60;
  return null;
}

export function isBusinessUnit(unit) {
  return ['business_hours', 'business_days'].includes(String(unit || '').trim().toLowerCase());
}

export function addBusinessMinutes(startValue, minutesValue, calendarValue = {}) {
  const calendar = normalizeBusinessCalendar(calendarValue, calendarValue?.timeZone || 'UTC');
  let cursor = startValue instanceof Date ? new Date(startValue) : new Date(startValue);
  let remaining = Number(minutesValue);
  if (Number.isNaN(cursor.getTime()) || !Number.isFinite(remaining) || remaining <= 0) return cursor;

  for (let guard = 0; guard < 20000 && remaining > 0.000001; guard += 1) {
    const local = zonedParts(cursor, calendar.timeZone);
    const localDate = { year: local.year, month: local.month, day: local.day };
    if (!isWorkingLocalDate(localDate, calendar)) {
      cursor = nextWorkingStart(localDate, calendar);
      continue;
    }
    const window = businessWindow(localDate, calendar);
    if (cursor < window.start) cursor = window.start;
    if (cursor >= window.end) {
      cursor = nextWorkingStart(localDate, calendar);
      continue;
    }
    const available = Math.max(0, (window.end.getTime() - cursor.getTime()) / 60000);
    if (remaining <= available + 0.000001) return new Date(cursor.getTime() + (remaining * 60000));
    remaining -= available;
    cursor = nextWorkingStart(localDate, calendar);
  }
  return cursor;
}

export function businessMinutesBetween(startValue, endValue, calendarValue = {}) {
  const calendar = normalizeBusinessCalendar(calendarValue, calendarValue?.timeZone || 'UTC');
  let cursor = startValue instanceof Date ? new Date(startValue) : new Date(startValue);
  const end = endValue instanceof Date ? new Date(endValue) : new Date(endValue);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime()) || end <= cursor) return 0;
  let total = 0;

  for (let guard = 0; guard < 20000 && cursor < end; guard += 1) {
    const local = zonedParts(cursor, calendar.timeZone);
    const localDate = { year: local.year, month: local.month, day: local.day };
    if (!isWorkingLocalDate(localDate, calendar)) {
      cursor = nextWorkingStart(localDate, calendar);
      continue;
    }
    const window = businessWindow(localDate, calendar);
    if (cursor < window.start) cursor = window.start;
    if (cursor >= window.end) {
      cursor = nextWorkingStart(localDate, calendar);
      continue;
    }
    const segmentEnd = end < window.end ? end : window.end;
    if (segmentEnd > cursor) total += (segmentEnd.getTime() - cursor.getTime()) / 60000;
    if (segmentEnd >= end) break;
    cursor = nextWorkingStart(localDate, calendar);
  }
  return total;
}

export function addSlaDuration(startValue, value, unit, calendarValue = {}) {
  const amountMinutes = targetMinutes(value, unit, calendarValue);
  if (!amountMinutes) return null;
  const start = startValue instanceof Date ? new Date(startValue) : new Date(startValue);
  if (Number.isNaN(start.getTime())) return null;
  return isBusinessUnit(unit)
    ? addBusinessMinutes(start, amountMinutes, calendarValue)
    : new Date(start.getTime() + (amountMinutes * 60000));
}

export function slaConsumptionRatio(startValue, nowValue, value, unit, calendarValue = {}) {
  const total = targetMinutes(value, unit, calendarValue);
  if (!total) return 0;
  const start = startValue instanceof Date ? new Date(startValue) : new Date(startValue);
  const now = nowValue instanceof Date ? new Date(nowValue) : new Date(nowValue);
  if (Number.isNaN(start.getTime()) || Number.isNaN(now.getTime()) || now <= start) return 0;
  const elapsed = isBusinessUnit(unit)
    ? businessMinutesBetween(start, now, calendarValue)
    : (now.getTime() - start.getTime()) / 60000;
  return Math.max(0, elapsed / total);
}
