// Shared types for the CLI

export interface RawSession {
  sessionCode?: string;
  title?: string;
  description?: string;
  speakerNames?: string | string[];
  TimeSlot?: string;
  startDateTime?: string;
  endDateTime?: string;
  location?: Array<{ displayValue?: string; logicalValue?: string } | string>
    | { displayValue?: string; logicalValue?: string }
    | string;
  sessionLevel?: Array<{ displayValue?: string; logicalValue?: string }> | string;
  sessionType?: { displayValue?: string; logicalValue?: string } | string;
  topic?: Array<{ displayValue?: string; logicalValue?: string }> | string;
  solutionArea?: Array<{ displayValue?: string; logicalValue?: string }> | string;
  product?: Array<{ displayValue?: string; logicalValue?: string } | string>;
  programmingLanguages?: Array<{ displayValue?: string; logicalValue?: string } | string>;
  tags?: Array<{ displayValue?: string; logicalValue?: string } | string>;
  deliveryTypes?: Array<{ displayValue?: string; logicalValue?: string } | string>;
  viewingOptions?: Array<{ displayValue?: string; logicalValue?: string } | string>;
  hasLiveStream?: boolean;
  hasOnDemand?: boolean;
  relatedSessionCodes?: string[];
  slideDeck?: string;
  onDemand?: string;
  [key: string]: unknown;
}

export interface Session {
  sessionCode: string;
  title: string;
  description: string;
  speakers: string;
  timeSlot: string;
  startDateTime: string;
  endDateTime: string;
  location: string;
  level: string;
  type: string;
  topic: string;
  solutionArea: string;
  product: string;
  languages: string;
  tags: string;
  deliveryTypes: string;
  viewingOptions: string;
  hasLiveStream: boolean;
  hasOnDemand: boolean;
  relatedSessionCodes: string;
  slideDeck: string;
  onDemand: string;
  event: string;
}

export interface EventConfig {
  id: string;
  name: string;
  endpoint: string;
}

export type CacheCheckStatus = 'updated' | 'not-modified' | 'failed';

export interface CacheMeta {
  eventId: string;
  /**
   * When session content was last downloaded and written locally.
   * Kept as fetchedAt for compatibility with existing cache metadata.
   */
  fetchedAt: string;
  /** Last time the remote catalog was checked, including 304 responses. */
  checkedAt?: string;
  /** Next time search commands may revalidate this cache. */
  nextCheckAt?: string;
  sessionCount: number;
  etag?: string;
  lastModified?: string;
  lastCheckStatus?: CacheCheckStatus;
  consecutiveFailures?: number;
}

export interface SearchResult {
  session: Session;
  score: number;
}
