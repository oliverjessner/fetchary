import type { EventEmitter } from 'node:events';

export type FetcharyHooks = {
  beforeFetch?: (context: { sourceId: number; url: string }) => void | Promise<void>;
  afterFetch?: (result: FetchResult) => void | Promise<void>;
  onChange?: (result: FetchResult) => void | Promise<void>;
  onError?: (event: { sourceId: number; url: string; error: Error }) => void | Promise<void>;
};

export type FetcharyOptions = {
  dataDir?: string;
  timeout?: number;
  userAgent?: string;
  fetch?: typeof globalThis.fetch;
  hooks?: FetcharyHooks;
};

export type CaptureMode = 'browser' | 'http';

export type Schedule = {
  sourceId: number;
  enabled: boolean;
  every: string;
  intervalSeconds: number;
  lastRunAt?: string | null;
  nextRunAt: string;
};

export type Source = {
  id: number;
  url: string;
  name: string | null;
  tag: string | null;
  enabled: boolean;
  createdAt: string;
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
  currentHash: string | null;
  currentRawHash: string | null;
  currentRenderedHash: string | null;
  currentComparisonHash: string | null;
  currentVersionId: number | null;
  ignoreSelectors: string[];
  captureMode: CaptureMode;
  waitAfterLoadMs: number;
  versions: number;
  schedule: Omit<Schedule, 'sourceId'> | null;
};

export type Version = {
  id: number;
  sourceId: number;
  requestedUrl: string;
  finalUrl: string;
  fetchedAt: string;
  status: number;
  contentType: string | null;
  contentLength: number;
  hash: string;
  rawHash: string;
  renderedHash: string | null;
  comparisonHash: string | null;
  etag: string | null;
  lastModified: string | null;
  file: string;
  rawFile: string;
  renderedFile: string | null;
  renderedLength: number | null;
  captureMode: CaptureMode;
  renderedCapturedAt: string | null;
  browserFinalUrl: string | null;
};

export type FetchResult = {
  id: number;
  sourceId: number;
  url: string;
  /** Whether the visible text content changed. */
  changed: boolean;
  /** Whether the exact response bytes changed and a new version was archived. */
  rawChanged: boolean;
  /** Whether the exact rendered browser DOM changed. */
  renderedChanged: boolean;
  /** Whether the visible text content changed. */
  contentChanged: boolean;
  previousHash?: string;
  hash: string;
  rawHash: string;
  renderedHash: string | null;
  contentHash: string;
  comparisonHash: string;
  captureMode: CaptureMode;
  version: number;
  fetchedAt: string;
  status: number;
  contentLength: number;
  renderedLength: number | null;
  finalUrl: string;
  browserFinalUrl: string | null;
  /** Known overlays dismissed before the browser DOM snapshot was taken. */
  dismissedOverlays: string[];
};

export type DiffResult = {
  sourceId: number;
  from: number;
  to: number;
  mode: 'text' | 'element-content' | 'element-raw' | 'raw';
  changed: boolean;
  diff: Array<{ type: 'added' | 'removed'; value: string }>;
};

export type FetcharyRunner = { stop(): Promise<void> };

export declare class Fetchary extends EventEmitter {
  readonly dataDir: string;
  readonly databasePath: string;
  add(url: string, options?: { name?: string; tag?: string; every?: string; ignoreSelectors?: string[]; mode?: CaptureMode; captureMode?: CaptureMode; waitAfterLoad?: string | number; waitAfterLoadMs?: string | number }): Promise<Source & { version: number; changed: boolean; rawChanged: boolean; renderedChanged: boolean; contentChanged: boolean }>;
  list(options?: { tag?: string }): Promise<Source[]>;
  get(id: number): Promise<Source>;
  fetch(): Promise<FetchResult[]>;
  fetch(id: number): Promise<FetchResult>;
  fetch(ids: number[]): Promise<FetchResult[]>;
  history(id: number, options?: { limit?: number; offset?: number }): Promise<Version[]>;
  version(sourceId: number, versionId?: number): Promise<Version>;
  read(sourceId: number, versionId?: number): Promise<string>;
  readRendered(sourceId: number, versionId?: number): Promise<string>;
  diff(sourceId: number, options?: { from?: number; to?: number; mode?: 'text' | 'element-content' | 'element-raw' | 'raw' }): Promise<DiffResult>;
  edit(id: number, changes: { url?: string; name?: string | null; tag?: string | null; ignoreSelectors?: string[]; mode?: CaptureMode; captureMode?: CaptureMode; waitAfterLoad?: string | number; waitAfterLoadMs?: string | number }): Promise<Source>;
  enable(id: number): Promise<Source>;
  disable(id: number): Promise<Source>;
  remove(id: number, options?: { purge?: boolean }): Promise<void>;
  schedule(id: number, every: string, options?: { now?: boolean }): Promise<Schedule>;
  unschedule(id: number): Promise<void>;
  schedules(): Promise<Schedule[]>;
  run(options?: { pollInterval?: number }): Promise<FetcharyRunner>;
  export(id: number, options?: { output?: string }): Promise<{ sourceId: number; directory: string; versions: number }>;
  status(): Promise<{ sources: number; versions: number; fetchBytes: number; changedToday: number; lastFetch: string | null; database: string }>;
  close(): Promise<void>;
}

export declare function createFetchary(options?: FetcharyOptions): Promise<Fetchary>;
export declare function parseInterval(every: string): { every: string; intervalSeconds: number };

export declare class FetcharyError extends Error {}
export declare class FetcharyFetchError extends FetcharyError { sourceId?: number; url?: string; status?: number }
export declare class FetcharyBrowserError extends FetcharyError { sourceId?: number; url?: string; phase?: 'launch' | 'navigation' | 'post-load-wait' | 'snapshot' }
export declare class FetcharyNotFoundError extends FetcharyError { sourceId?: number; versionId?: number }
export declare class FetcharyIntervalError extends FetcharyError { interval?: unknown }
export declare class FetcharyStorageError extends FetcharyError {}
export declare class FetcharyValidationError extends FetcharyError {}
export declare class FetcharyRunnerError extends FetcharyError {}
