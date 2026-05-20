import type { RawSession, Session } from '../contracts.js';
import { stripControlSequences } from './sanitize.js';
import { isRawSession } from './validate.js';

const MAX_FIELD_LEN = 64 * 1024;
const SESSION_CODE_RE = /^[A-Z0-9][A-Z0-9_.-]{0,32}$/i;

function clean(value: unknown): string {
  if (value === undefined || value === null) return '';
  const s = typeof value === 'string' ? value : String(value);
  const stripped = stripControlSequences(s).trim();
  return stripped.length > MAX_FIELD_LEN ? stripped.slice(0, MAX_FIELD_LEN) : stripped;
}

function extractDisplayValue(field: unknown): string {
  if (!field) return '';
  if (typeof field === 'object' && field !== null) {
    // For objects, only honour an own `displayValue` property — never walk the
    // prototype chain. If absent, return '' rather than stringifying the object.
    if (Object.hasOwn(field as object, 'displayValue')) {
      return clean((field as { displayValue?: unknown }).displayValue);
    }
    return '';
  }
  return clean(field);
}

// Extract displayValue from nested dict fields, handling all observed shapes
function extractDisplayValues(field: unknown): string {
  if (!field) return '';
  if (Array.isArray(field)) {
    return field
      .map((item) => extractDisplayValue(item))
      .filter(Boolean)
      .join(', ');
  }
  return extractDisplayValue(field);
}

export function normalizeSession(raw: RawSession, eventId: string): Session | null {
  const code = clean(raw.sessionCode);
  if (!code || !SESSION_CODE_RE.test(code)) return null;

  return {
    sessionCode: code,
    title: clean(raw.title),
    description: clean(raw.description),
    speakers: typeof raw.speakerNames === 'string'
      ? clean(raw.speakerNames)
      : Array.isArray(raw.speakerNames)
        ? clean(raw.speakerNames.join(', '))
        : '',
    timeSlot: clean(raw.TimeSlot),
    startDateTime: clean(raw.startDateTime),
    endDateTime: clean(raw.endDateTime),
    location: extractDisplayValues(raw.location),
    level: extractDisplayValues(raw.sessionLevel),
    type: extractDisplayValues(raw.sessionType),
    topic: extractDisplayValues(raw.topic),
    solutionArea: extractDisplayValues(raw.solutionArea),
    product: extractDisplayValues(raw.product),
    languages: extractDisplayValues(raw.programmingLanguages),
    tags: extractDisplayValues(raw.tags),
    relatedSessionCodes: Array.isArray(raw.relatedSessionCodes)
      ? clean(raw.relatedSessionCodes.join(', '))
      : '',
    slideDeck: clean(raw.slideDeck),
    onDemand: clean(raw.onDemand),
    event: eventId,
  };
}

export function normalizeCatalog(raw: unknown[], eventId: string): Session[] {
  return raw
    .filter(isRawSession)
    .map((s) => normalizeSession(s, eventId))
    .filter((s): s is Session => s !== null);
}
