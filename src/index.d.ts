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
  currentVersionId: number | null;
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
  etag: string | null;
  lastModified: string | null;
  file: string;
};

export type FetchResult = {
  id: number;
  sourceId: number;
  url: string;
  changed: boolean;
  previousHash?: string;
  hash: string;
  version: number;
  fetchedAt: string;
  status: number;
  contentLength: number;
};

export type DiffResult = {
  sourceId: number;
  from: number;
  to: number;
  mode: 'text' | 'raw';
  changed: boolean;
  diff: Array<{ type: 'added' | 'removed'; value: string }>;
};

export type FetcharyRunner = { stop(): Promise<void> };

export declare class Fetchary extends EventEmitter {
  readonly dataDir: string;
  readonly databasePath: string;
  add(url: string, options?: { name?: string; tag?: string; every?: string }): Promise<Source & { version: number; changed: boolean }>;
  list(options?: { tag?: string }): Promise<Source[]>;
  get(id: number): Promise<Source>;
  fetch(): Promise<FetchResult[]>;
  fetch(id: number): Promise<FetchResult>;
  fetch(ids: number[]): Promise<FetchResult[]>;
  history(id: number, options?: { limit?: number; offset?: number }): Promise<Version[]>;
  version(sourceId: number, versionId?: number): Promise<Version>;
  read(sourceId: number, versionId?: number): Promise<string>;
  diff(sourceId: number, options?: { from?: number; to?: number; mode?: 'text' | 'raw' }): Promise<DiffResult>;
  edit(id: number, changes: { url?: string; name?: string | null; tag?: string | null }): Promise<Source>;
  enable(id: number): Promise<Source>;
  disable(id: number): Promise<Source>;
  remove(id: number, options?: { purge?: boolean }): Promise<void>;
  schedule(id: number, every: string, options?: { now?: boolean }): Promise<Schedule>;
  unschedule(id: number): Promise<void>;
  schedules(): Promise<Schedule[]>;
  run(options?: { pollInterval?: number }): Promise<FetcharyRunner>;
  export(id: number, options?: { output?: string }): Promise<{ sourceId: number; directory: string; versions: number }>;
  status(): Promise<{ sources: number; versions: number; changedToday: number; lastFetch: string | null; database: string }>;
  close(): Promise<void>;
}

export declare function createFetchary(options?: FetcharyOptions): Promise<Fetchary>;
export declare function parseInterval(every: string): { every: string; intervalSeconds: number };

export declare class FetcharyError extends Error {}
export declare class FetcharyFetchError extends FetcharyError { sourceId?: number; url?: string; status?: number }
export declare class FetcharyNotFoundError extends FetcharyError { sourceId?: number; versionId?: number }
export declare class FetcharyIntervalError extends FetcharyError { interval?: unknown }
export declare class FetcharyStorageError extends FetcharyError {}
export declare class FetcharyValidationError extends FetcharyError {}
export declare class FetcharyRunnerError extends FetcharyError {}
