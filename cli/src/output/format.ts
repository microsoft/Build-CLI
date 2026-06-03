import type { Session, SearchResult, CacheMeta } from '../contracts.js';

export function formatSessionShort(s: Session): string {
  const parts = [`[${s.sessionCode}] ${s.title}`];
  parts.push(`  Type: ${s.type || 'N/A'} | Level: ${s.level || 'N/A'} | Event: ${s.event}`);
  if (s.deliveryTypes) parts.push(`  Delivery: ${s.deliveryTypes}`);
  if (s.speakers) parts.push(`  Speaker(s): ${s.speakers}`);
  if (s.startDateTime) {
    const d = new Date(s.startDateTime);
    const date = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    parts.push(`  When: ${date}, ${s.timeSlot || d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`);
  } else if (s.timeSlot) {
    parts.push(`  When: ${s.timeSlot}`);
  }
  if (s.location) parts.push(`  Location: ${s.location}`);
  const links = [];
  if (s.onDemand) links.push('On-demand');
  if (s.slideDeck) links.push('Slides');
  if (links.length) parts.push(`  Links: ${links.join(', ')}`);
  return parts.join('\n');
}

export function formatSessionFull(s: Session): string {
  const lines = [
    `# [${s.sessionCode}] ${s.title}`,
    '',
    `Type: ${s.type || 'N/A'}`,
    `Level: ${s.level || 'N/A'}`,
    `Event: ${s.event}`,
  ];
  if (s.speakers) lines.push(`Speaker(s): ${s.speakers}`);
  if (s.timeSlot) lines.push(`When: ${s.timeSlot}`);
  if (s.startDateTime) lines.push(`Start: ${s.startDateTime}`);
  if (s.endDateTime) lines.push(`End: ${s.endDateTime}`);
  if (s.location) lines.push(`Location: ${s.location}`);
  if (s.topic) lines.push(`Topic: ${s.topic}`);
  if (s.solutionArea) lines.push(`Solution area: ${s.solutionArea}`);
  if (s.product) lines.push(`Product: ${s.product}`);
  if (s.languages) lines.push(`Languages: ${s.languages}`);
  if (s.tags) lines.push(`Tags: ${s.tags}`);
  if (s.deliveryTypes) lines.push(`Delivery: ${s.deliveryTypes}`);
  if (s.viewingOptions) lines.push(`Viewing: ${s.viewingOptions}`);
  lines.push(`Live stream: ${s.hasLiveStream ? 'Yes' : 'No'}`);
  lines.push(`On-demand: ${s.hasOnDemand ? 'Yes' : 'No'}`);
  if (s.relatedSessionCodes) lines.push(`Related sessions: ${s.relatedSessionCodes}`);
  lines.push('');
  if (s.description) lines.push(s.description);
  if (s.onDemand) lines.push(`\nOn-demand: ${s.onDemand}`);
  if (s.slideDeck) lines.push(`Slides: ${s.slideDeck}`);
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
