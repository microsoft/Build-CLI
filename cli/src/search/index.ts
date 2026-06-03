import MiniSearch from 'minisearch';
import type { Session, SearchResult } from '../contracts.js';
import { DEFAULT_LIMIT } from '../config.js';

let index: MiniSearch<Session> | null = null;
let indexedSessions: Session[] = [];

export function buildIndex(sessions: Session[]): void {
  indexedSessions = sessions;
  index = new MiniSearch<Session>({
    fields: [
      'title',
      'description',
      'product',
      'tags',
      'topic',
      'solutionArea',
      'languages',
      'speakers',
      'type',
      'level',
    ],
    storeFields: [
      'sessionCode', 'title', 'description', 'speakers', 'timeSlot',
      'startDateTime', 'endDateTime', 'location', 'level', 'type',
      'topic', 'solutionArea', 'product', 'languages', 'tags',
      'deliveryTypes', 'viewingOptions', 'hasLiveStream', 'hasOnDemand',
      'relatedSessionCodes', 'slideDeck', 'onDemand', 'event',
    ],
    idField: 'sessionCode',
    // Composite ID to handle cross-event collisions
    extractField: (doc, fieldName) => {
      if (fieldName === 'sessionCode') return `${doc.event}::${doc.sessionCode}`;
      return (doc as unknown as Record<string, string>)[fieldName] ?? '';
    },
  });
  index.addAll(sessions);
}

export interface SearchOptions {
  query?: string;
  tech?: string;
  speaker?: string;
  type?: string;
  event?: string;
  limit?: number;
}

export function searchSessions(opts: SearchOptions): SearchResult[] {
  if (!index || indexedSessions.length === 0) return [];

  const limit = opts.limit ?? DEFAULT_LIMIT;
  let results: SearchResult[];

  if (opts.query) {
    // Check if the query looks like a session code (e.g., BRK155, LAB329)
    const codePattern = /^[A-Za-z]{2,10}\d{1,5}$/;
    if (codePattern.test(opts.query.trim())) {
      // Session code search: exact match + variants (e.g., LAB329 → LAB329, LAB329-R1, LAB329-R2)
      const code = opts.query.trim().toUpperCase();
      const matches = indexedSessions.filter(
        (s) => s.sessionCode.toUpperCase() === code
          || s.sessionCode.toUpperCase().startsWith(code + '-'),
      );
      results = matches.map((s) => ({ session: s, score: s.sessionCode.toUpperCase() === code ? 100 : 50 }));
    } else {
      // Keyword search: boost title, enable fuzzy + prefix
      const raw = index.search(opts.query, {
        boost: { title: 3, product: 2, topic: 1.5 },
        fuzzy: 0.15,
        prefix: true,
      });
      results = raw.map((r) => ({
        session: indexedSessions.find(
          (s) => `${s.event}::${s.sessionCode}` === r.id,
        )!,
        score: r.score,
      }));
    }
  } else if (opts.tech) {
    // Technology search: search across product/tags/topic/languages, with title/description as fallback
    const raw = index.search(opts.tech, {
      fields: ['product', 'tags', 'topic', 'solutionArea', 'languages', 'title', 'description'],
      boost: { product: 3, tags: 2, topic: 2, languages: 1.5, title: 1, description: 0.5 },
      fuzzy: 0.2,
      prefix: true,
    });
    results = raw.map((r) => ({
      session: indexedSessions.find(
        (s) => `${s.event}::${s.sessionCode}` === r.id,
      )!,
      score: r.score,
    }));
  } else if (opts.speaker) {
    // Speaker search — use index for candidate retrieval, then post-filter
    // to require the query terms appear in the speaker field (not just fuzzy title hits)
    const raw = index.search(opts.speaker, {
      fields: ['speakers'],
      fuzzy: 0.2,
      prefix: true,
    });
    const speakerLower = opts.speaker.toLowerCase();
    const speakerParts = speakerLower.split(/\s+/).filter(Boolean);
    results = raw
      .map((r) => ({
        session: indexedSessions.find(
          (s) => `${s.event}::${s.sessionCode}` === r.id,
        )!,
        score: r.score,
      }))
      .filter((r) => {
        // Require at least the last name (last word of query) to appear in speakers
        const sessionSpeakers = r.session.speakers.toLowerCase();
        const lastName = speakerParts[speakerParts.length - 1];
        return lastName ? sessionSpeakers.includes(lastName) : true;
      });
  } else {
    // No search criteria — return all (filtered by event/type below)
    results = indexedSessions.map((s) => ({ session: s, score: 0 }));
  }

  // Post-search filters
  if (opts.event) {
    results = results.filter((r) => r.session.event === opts.event);
  }
  if (opts.type) {
    const typeFilter = opts.type.toLowerCase();
    results = results.filter((r) => r.session.type.toLowerCase().includes(typeFilter));
  }

  return results.slice(0, limit);
}

export function findSession(
  sessionCode: string,
  eventId?: string,
): Session[] {
  const code = sessionCode.toUpperCase();
  let matches = indexedSessions.filter(
    (s) => s.sessionCode.toUpperCase() === code,
  );
  if (eventId) {
    matches = matches.filter((s) => s.event === eventId);
  }
  return matches;
}
