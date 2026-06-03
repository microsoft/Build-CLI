import type { RawSession, Session } from '../contracts.js';

function stringifyDisplayValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  return String(value).trim();
}

function extractDisplayValue(field: unknown): string {
  if (!field) return '';
  if (typeof field === 'object' && field !== null && 'displayValue' in field) {
    return stringifyDisplayValue((field as { displayValue?: unknown }).displayValue);
  }
  return stringifyDisplayValue(field);
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
  const code = raw.sessionCode?.trim();
  if (!code) return null;

  return {
    sessionCode: code,
    title: raw.title?.trim() ?? '',
    description: raw.description?.trim() ?? '',
    speakers: typeof raw.speakerNames === 'string'
      ? raw.speakerNames.trim()
      : Array.isArray(raw.speakerNames)
        ? raw.speakerNames.join(', ')
        : '',
    timeSlot: raw.TimeSlot?.trim() ?? '',
    startDateTime: raw.startDateTime ?? '',
    endDateTime: raw.endDateTime ?? '',
    location: extractDisplayValues(raw.location),
    level: extractDisplayValues(raw.sessionLevel),
    type: extractDisplayValues(raw.sessionType),
    topic: extractDisplayValues(raw.topic),
    solutionArea: extractDisplayValues(raw.solutionArea),
    product: extractDisplayValues(raw.product),
    languages: extractDisplayValues(raw.programmingLanguages),
    tags: extractDisplayValues(raw.tags),
    deliveryTypes: extractDisplayValues(raw.deliveryTypes),
    viewingOptions: extractDisplayValues(raw.viewingOptions),
    hasLiveStream: !!raw.hasLiveStream,
    hasOnDemand: !!raw.hasOnDemand,
    relatedSessionCodes: Array.isArray(raw.relatedSessionCodes)
      ? raw.relatedSessionCodes.join(', ')
      : '',
    slideDeck: raw.slideDeck ?? '',
    onDemand: raw.onDemand ?? '',
    event: eventId,
  };
}

export function normalizeCatalog(raw: unknown[], eventId: string): Session[] {
  return (raw as RawSession[])
    .map((s) => normalizeSession(s, eventId))
    .filter((s): s is Session => s !== null);
}
