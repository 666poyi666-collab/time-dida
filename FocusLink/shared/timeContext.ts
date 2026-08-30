import { isValidTaskTimeZone, zonedDateTimeParts, zonedDateTimeToEpoch } from './taskRecurrence';

export interface FocusLinkTimeContext {
  serverTime: number;
  timezone: string;
  utcIso: string;
  localDate: string;
  localTime: string;
  localDateTime: string;
  offsetMinutes: number;
  dayStart: number;
  dayEndExclusive: number;
}

export function buildFocusLinkTimeContext(
  serverTime: number,
  timezone: string,
): FocusLinkTimeContext {
  if (!Number.isFinite(serverTime) || serverTime < 0) throw new Error('invalid_server_time');
  if (!isValidTaskTimeZone(timezone)) throw new Error('invalid_time_zone');
  const parts = zonedDateTimeParts(serverTime, timezone);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const dayStart = localDateToEpoch(parts.year, parts.month, parts.day, timezone);
  const tomorrow = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  const dayEndExclusive = localDateToEpoch(
    tomorrow.getUTCFullYear(),
    tomorrow.getUTCMonth() + 1,
    tomorrow.getUTCDate(),
    timezone,
  );
  const localDate = `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
  const localTime = `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
  return {
    serverTime,
    timezone,
    utcIso: new Date(serverTime).toISOString(),
    localDate,
    localTime,
    localDateTime: `${localDate}T${localTime}`,
    offsetMinutes: Math.round((localAsUtc - Math.trunc(serverTime / 1_000) * 1_000) / 60_000),
    dayStart,
    dayEndExclusive,
  };
}

function localDateToEpoch(year: number, month: number, day: number, timezone: string): number {
  return zonedDateTimeToEpoch(
    { year, month, day, hour: 0, minute: 0, second: 0, millisecond: 0 },
    timezone,
  );
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}
