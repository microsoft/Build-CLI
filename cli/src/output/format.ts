import type { Session, SearchResult, CacheMeta } from '../contracts.js';
import { stripControlSequences as S } from '../data/sanitize.js';

export function formatSessionShort(s: Session): string {
  const parts = [`[${S(s.sessionCode)}] ${S(s.title)}`];
  parts.push(`  Type: ${S(s.type) || 'N/A'} | Level: ${S(s.level) || 'N/A'} | Event: ${S(s.event)}`);
  if (s.speakers) parts.push(`  Speaker(s): ${S(s.speakers)}`);
  if (s.startDateTime) {
    const d = new Date(s.startDateTime);
    if (Number.isFinite(d.getTime())) {
      const date = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      parts.push(`  When: ${date}, ${S(s.timeSlot) || d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`);
    } else if (s.timeSlot) {
      parts.push(`  When: ${S(s.timeSlot)}`);
    } else {
      // startDateTime present but unparseable — fall back to the sanitized raw value.
      parts.push(`  When: ${S(s.startDateTime)}`);
    }
  } else if (s.timeSlot) {
    parts.push(`  When: ${S(s.timeSlot)}`);
  }
  if (s.location) parts.push(`  Location: ${S(s.location)}`);
  const links = [];
  if (s.onDemand) links.push('On-demand');
  if (s.slideDeck) links.push('Slides');
  if (links.length) parts.push(`  Links: ${links.join(', ')}`);
  return parts.join('\n');
}

export function formatSessionFull(s: Session): string {
  const lines = [
    `# [${S(s.sessionCode)}] ${S(s.title)}`,
    '',
    `Type: ${S(s.type) || 'N/A'}`,
    `Level: ${S(s.level) || 'N/A'}`,
    `Event: ${S(s.event)}`,
  ];
  if (s.speakers) lines.push(`Speaker(s): ${S(s.speakers)}`);
  if (s.timeSlot) lines.push(`When: ${S(s.timeSlot)}`);
  if (s.startDateTime) lines.push(`Start: ${S(s.startDateTime)}`);
  if (s.endDateTime) lines.push(`End: ${S(s.endDateTime)}`);
  if (s.location) lines.push(`Location: ${S(s.location)}`);
  if (s.topic) lines.push(`Topic: ${S(s.topic)}`);
  if (s.solutionArea) lines.push(`Solution area: ${S(s.solutionArea)}`);
  if (s.product) lines.push(`Product: ${S(s.product)}`);
  if (s.languages) lines.push(`Languages: ${S(s.languages)}`);
  if (s.tags) lines.push(`Tags: ${S(s.tags)}`);
  if (s.relatedSessionCodes) lines.push(`Related sessions: ${S(s.relatedSessionCodes)}`);
  lines.push('');
  if (s.description) lines.push(S(s.description));
  if (s.onDemand) lines.push(`\nOn-demand: ${S(s.onDemand)}`);
  if (s.slideDeck) lines.push(`Slides: ${S(s.slideDeck)}`);
  return lines.join('\n');
}

export function formatSearchResults(results: SearchResult[], json: boolean): string {
  if (json) return JSON.stringify(results.map((r) => r.session), null, 2);
  if (results.length === 0) return 'No sessions found.';
  return `Found ${results.length} session(s):\n\n` +
    results.map((r) => formatSessionShort(r.session)).join('\n\n');
}

export function formatSessionDetail(sessions: Session[], json: boolean): string {
  if (json) return JSON.stringify(sessions.length === 1 ? sessions[0] : sessions, null, 2);
  if (sessions.length === 0) return 'Session not found.';
  if (sessions.length === 1) return formatSessionFull(sessions[0]!);
  // Disambiguation
  return `Found ${sessions.length} sessions with that code across events:\n\n` +
    sessions.map((s) => formatSessionShort(s)).join('\n\n') +
    '\n\nUse --event to narrow down.';
}

function formatAge(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatStatus(
  statuses: Array<{ eventId: string; meta: CacheMeta | null }>,
  json: boolean,
): string {
  if (json) return JSON.stringify(statuses, null, 2);
  if (statuses.length === 0) return 'No known events configured.';
  return statuses
    .map(({ eventId, meta }) => {
      if (!meta) return `  ${eventId}: not cached`;
      const cachedAge = formatAge(Date.now() - new Date(meta.fetchedAt).getTime());
      const checkedAge = meta.checkedAt
        ? `, checked ${formatAge(Date.now() - new Date(meta.checkedAt).getTime())}`
        : '';
      const status = meta.lastCheckStatus === 'failed' ? ', last check failed' : '';
      return `  ${eventId}: ${meta.sessionCount} sessions, cached ${cachedAge}${checkedAge}${status}`;
    })
    .join('\n');
}
