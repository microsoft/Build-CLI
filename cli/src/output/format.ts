import type { Session, SearchResult, CacheMeta } from '../contracts.js';
import { sanitizeSession } from '../data/validate.js';

export function formatSessionShort(s: Session): string {
  const clean = sanitizeSession(s);
  const parts = [`[${clean.sessionCode}] ${clean.title}`];
  parts.push(`  Type: ${clean.type || 'N/A'} | Level: ${clean.level || 'N/A'} | Event: ${clean.event}`);
  if (clean.speakers) parts.push(`  Speaker(s): ${clean.speakers}`);
  if (clean.startDateTime) {
    const d = new Date(clean.startDateTime);
    if (Number.isFinite(d.getTime())) {
      const date = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      parts.push(`  When: ${date}, ${clean.timeSlot || d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`);
    } else if (clean.timeSlot) {
      parts.push(`  When: ${clean.timeSlot}`);
    } else {
      parts.push(`  When: ${clean.startDateTime}`);
    }
  } else if (clean.timeSlot) {
    parts.push(`  When: ${clean.timeSlot}`);
  }
  if (clean.location) parts.push(`  Location: ${clean.location}`);
  const links = [];
  if (clean.onDemand) links.push('On-demand');
  if (clean.slideDeck) links.push('Slides');
  if (links.length) parts.push(`  Links: ${links.join(', ')}`);
  return parts.join('\n');
}

export function formatSessionFull(s: Session): string {
  const clean = sanitizeSession(s);
  const lines = [
    `# [${clean.sessionCode}] ${clean.title}`,
    '',
    `Type: ${clean.type || 'N/A'}`,
    `Level: ${clean.level || 'N/A'}`,
    `Event: ${clean.event}`,
  ];
  if (clean.speakers) lines.push(`Speaker(s): ${clean.speakers}`);
  if (clean.timeSlot) lines.push(`When: ${clean.timeSlot}`);
  if (clean.startDateTime) lines.push(`Start: ${clean.startDateTime}`);
  if (clean.endDateTime) lines.push(`End: ${clean.endDateTime}`);
  if (clean.location) lines.push(`Location: ${clean.location}`);
  if (clean.topic) lines.push(`Topic: ${clean.topic}`);
  if (clean.solutionArea) lines.push(`Solution area: ${clean.solutionArea}`);
  if (clean.product) lines.push(`Product: ${clean.product}`);
  if (clean.languages) lines.push(`Languages: ${clean.languages}`);
  if (clean.tags) lines.push(`Tags: ${clean.tags}`);
  if (clean.relatedSessionCodes) lines.push(`Related sessions: ${clean.relatedSessionCodes}`);
  lines.push('');
  if (clean.description) lines.push(clean.description);
  if (clean.onDemand) lines.push(`\nOn-demand: ${clean.onDemand}`);
  if (clean.slideDeck) lines.push(`Slides: ${clean.slideDeck}`);
  return lines.join('\n');
}

export function formatSearchResults(results: SearchResult[], json: boolean): string {
  if (json) return JSON.stringify(results.map((r) => sanitizeSession(r.session)), null, 2);
  if (results.length === 0) return 'No sessions found.';
  return `Found ${results.length} session(s):\n\n` +
    results.map((r) => formatSessionShort(r.session)).join('\n\n');
}

export function formatSessionDetail(sessions: Session[], json: boolean): string {
  if (json) {
    const clean = sessions.map((session) => sanitizeSession(session));
    return JSON.stringify(clean.length === 1 ? clean[0] : clean, null, 2);
  }
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
