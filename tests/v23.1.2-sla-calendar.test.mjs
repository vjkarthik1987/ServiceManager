import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addSlaDuration,
  normalizeBusinessCalendar,
  slaConsumptionRatio,
  zonedLocalToUtc,
  zonedParts
} from '../services/request-service/src/slaCalendar.js';

const johannesburg = normalizeBusinessCalendar({
  timeZone: 'Africa/Johannesburg',
  workingDays: [1, 2, 3, 4, 5],
  dayStart: '09:00',
  dayEnd: '17:00',
  holidays: []
});

function localDate(parts, timeZone) {
  return zonedLocalToUtc(parts, timeZone);
}

function expectLocal(date, timeZone, expected) {
  const parts = zonedParts(date, timeZone);
  assert.deepEqual(
    { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute },
    expected
  );
}

test('working-hour SLA carries Friday work into Monday', () => {
  const start = localDate({ year: 2026, month: 9, day: 4, hour: 16, minute: 0 }, johannesburg.timeZone);
  const due = addSlaDuration(start, 4, 'business_hours', johannesburg);
  expectLocal(due, johannesburg.timeZone, { year: 2026, month: 9, day: 7, hour: 12, minute: 0 });
});

test('business calendar skips configured client holiday', () => {
  const calendar = normalizeBusinessCalendar({ ...johannesburg, holidays: [{ date: '2026-09-07', name: 'Client holiday' }] });
  const start = localDate({ year: 2026, month: 9, day: 4, hour: 16, minute: 0 }, calendar.timeZone);
  const due = addSlaDuration(start, 4, 'business_hours', calendar);
  expectLocal(due, calendar.timeZone, { year: 2026, month: 9, day: 8, hour: 12, minute: 0 });
});

test('one working day means the configured business-day duration, not 24 elapsed hours', () => {
  const start = localDate({ year: 2026, month: 9, day: 4, hour: 16, minute: 0 }, johannesburg.timeZone);
  const due = addSlaDuration(start, 1, 'business_days', johannesburg);
  expectLocal(due, johannesburg.timeZone, { year: 2026, month: 9, day: 7, hour: 16, minute: 0 });
});

test('Copenhagen business SLA stays correct across DST transition', () => {
  const copenhagen = normalizeBusinessCalendar({
    timeZone: 'Europe/Copenhagen',
    workingDays: [1, 2, 3, 4, 5],
    dayStart: '09:00',
    dayEnd: '17:00',
    holidays: []
  });
  const start = localDate({ year: 2026, month: 3, day: 27, hour: 16, minute: 0 }, copenhagen.timeZone);
  const due = addSlaDuration(start, 2, 'business_hours', copenhagen);
  expectLocal(due, copenhagen.timeZone, { year: 2026, month: 3, day: 30, hour: 10, minute: 0 });
});

test('75 percent working-time consumption is detected accurately', () => {
  const start = localDate({ year: 2026, month: 9, day: 7, hour: 9, minute: 0 }, johannesburg.timeZone);
  const now = localDate({ year: 2026, month: 9, day: 7, hour: 12, minute: 0 }, johannesburg.timeZone);
  assert.equal(slaConsumptionRatio(start, now, 4, 'business_hours', johannesburg), 0.75);
});

test('elapsed-hour SLA remains 24x7 and does not stop at weekends', () => {
  const start = localDate({ year: 2026, month: 9, day: 4, hour: 16, minute: 0 }, johannesburg.timeZone);
  const due = addSlaDuration(start, 24, 'hours', johannesburg);
  expectLocal(due, johannesburg.timeZone, { year: 2026, month: 9, day: 5, hour: 16, minute: 0 });
});
