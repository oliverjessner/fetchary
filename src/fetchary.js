'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { openDatabase, transaction } = require('./storage/database');
const { parseInterval } = require('./intervals');
const { htmlToText, lineDiff } = require('./diff');
const { acquireLock, releaseLock } = require('./scheduler');
const {
  FetcharyError,
  FetcharyFetchError,
  FetcharyNotFoundError,
  FetcharyStorageError,
  FetcharyValidationError,
  FetcharyRunnerError,
} = require('./errors');

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_USER_AGENT = 'fetchary/0.1';

function isoNow() { return new Date().toISOString(); }
function asBoolean(value) { return Boolean(Number(value)); }

function sourceFromRow(row) {
  if (!row) return null;
  const source = {
    id: Number(row.id),
    url: row.url,
    name: row.name,
    tag: row.tag,
    enabled: asBoolean(row.enabled),
    createdAt: row.created_at,
    lastCheckedAt: row.last_checked_at,
    lastChangedAt: row.last_changed_at,
    currentHash: row.current_hash,
    currentVersionId: row.current_version_id == null ? null : Number(row.current_version_id),
    versions: Number(row.versions || 0),
  };
  if (row.schedule_enabled != null) {
    source.schedule = {
      enabled: asBoolean(row.schedule_enabled),
      every: row.schedule_every,
      intervalSeconds: Number(row.interval_seconds),
      lastRunAt: row.last_run_at,
      nextRunAt: row.next_fetch_at,
    };
  } else {
    source.schedule = null;
  }
  return source;
}

function versionFromRow(row) {
  if (!row) return null;
  return {
    id: Number(row.version_number),
    sourceId: Number(row.url_id),
    requestedUrl: row.requested_url,
    finalUrl: row.final_url,
    fetchedAt: row.fetched_at,
    status: row.status_code == null ? null : Number(row.status_code),
    contentType: row.content_type,
    contentLength: Number(row.content_length),
    hash: row.hash,
    etag: row.etag,
    lastModified: row.last_modified,
    file: row.file,
  };
}

function validateId(id, label = 'source id') {
  const number = typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : id;
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new FetcharyValidationError(`${label} must be a positive integer`, { id });
  }
  return number;
}

function validateUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new FetcharyValidationError('url is required', { url: value });
  }
  let parsed;
  try { parsed = new URL(value); } catch (cause) {
    throw new FetcharyValidationError(`invalid URL "${value}"`, { url: value, cause });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new FetcharyValidationError('url must use http or https', { url: value });
  }
  return parsed.href;
}

class Fetchary extends EventEmitter {
  constructor(options = {}) {
    super();
    this.dataDir = path.resolve(options.dataDir || path.join(os.homedir(), '.fetchary'));
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.userAgent = options.userAgent || DEFAULT_USER_AGENT;
    this.httpFetch = options.fetch || globalThis.fetch;
    this.hooks = options.hooks || {};
    this.inFlight = new Map();
    this.runner = null;
    this.closed = false;
    if (typeof this.httpFetch !== 'function') throw new FetcharyValidationError('a Fetch-compatible implementation is required');
    if (!Number.isFinite(this.timeout) || this.timeout <= 0) throw new FetcharyValidationError('timeout must be greater than zero');
    const storage = openDatabase(this.dataDir);
    this.db = storage.db;
    this.databasePath = storage.databasePath;
  }

  _assertOpen() {
    if (this.closed) throw new FetcharyError('this Fetchary instance is closed');
  }

  _sourceRow(id, includeRemoved = false) {
    const whereRemoved = includeRemoved ? '' : 'AND u.removed_at IS NULL';
    return this.db.prepare(`
      SELECT u.*, COUNT(v.id) AS versions,
             s.enabled AS schedule_enabled, s.every AS schedule_every,
             s.interval_seconds, s.last_run_at, s.next_fetch_at
      FROM urls u
      LEFT JOIN versions v ON v.url_id = u.id
      LEFT JOIN schedules s ON s.url_id = u.id AND s.enabled = 1
      WHERE u.id = ? ${whereRemoved}
      GROUP BY u.id
    `).get(id);
  }

  _requireSource(id, includeRemoved = false) {
    const sourceId = validateId(id);
    const row = this._sourceRow(sourceId, includeRemoved);
    if (!row) throw new FetcharyNotFoundError(`source ${sourceId} does not exist`, { sourceId });
    return sourceFromRow(row);
  }

  async _hook(name, value) {
    const hook = this.hooks[name];
    if (typeof hook !== 'function') return;
    try { await hook(value); } catch {}
  }

  _emit(name, value) {
    try { super.emit(name, value); } catch {}
  }

  _emitError(error) {
    if (this.listenerCount('error') > 0) this._emit('error', error);
  }

  async add(url, options = {}) {
    this._assertOpen();
    const normalizedUrl = validateUrl(url);
    if (options.every != null) parseInterval(options.every);
    const now = isoNow();
    let sourceId;
    try {
      const result = this.db.prepare(`
        INSERT INTO urls (url, name, tag, enabled, created_at)
        VALUES (?, ?, ?, 1, ?)
      `).run(normalizedUrl, options.name ?? null, options.tag ?? null, now);
      sourceId = Number(result.lastInsertRowid);
    } catch (cause) {
      if (String(cause.message).includes('UNIQUE')) {
        throw new FetcharyValidationError(`source already exists for ${normalizedUrl}`, { cause, url: normalizedUrl });
      }
      throw new FetcharyStorageError('could not add source', { cause, url: normalizedUrl });
    }

    let result;
    try {
      result = await this.fetch(sourceId);
      if (options.every != null) await this.schedule(sourceId, options.every);
    } catch (error) {
      try { this.db.prepare('DELETE FROM urls WHERE id = ?').run(sourceId); } catch {}
      try { fs.rmSync(path.join(this.dataDir, 'pages', String(sourceId)), { recursive: true, force: true }); } catch {}
      throw error;
    }
    return { ...this._requireSource(sourceId), version: result.version, changed: result.changed };
  }

  async list(options = {}) {
    this._assertOpen();
    const params = [];
    let tagClause = '';
    if (options.tag != null) {
      tagClause = 'AND u.tag = ?';
      params.push(options.tag);
    }
    const rows = this.db.prepare(`
      SELECT u.*, COUNT(v.id) AS versions,
             s.enabled AS schedule_enabled, s.every AS schedule_every,
             s.interval_seconds, s.last_run_at, s.next_fetch_at
      FROM urls u
      LEFT JOIN versions v ON v.url_id = u.id
      LEFT JOIN schedules s ON s.url_id = u.id AND s.enabled = 1
      WHERE u.removed_at IS NULL ${tagClause}
      GROUP BY u.id
      ORDER BY u.id
    `).all(...params);
    return rows.map(sourceFromRow);
  }

  async get(id) {
    this._assertOpen();
    return this._requireSource(id);
  }

  async fetch(target) {
    this._assertOpen();
    if (target == null) {
      const ids = this.db.prepare('SELECT id FROM urls WHERE enabled = 1 AND removed_at IS NULL ORDER BY id').all().map(row => Number(row.id));
      return this._fetchMany(ids);
    }
    if (Array.isArray(target)) return this._fetchMany(target.map(id => validateId(id)));
    return this._fetchOne(validateId(target));
  }

  async _fetchMany(ids) {
    const settled = await Promise.allSettled(ids.map(id => this._fetchOne(id)));
    const failed = settled.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    return settled.map(result => result.value);
  }

  _fetchOne(id) {
    if (this.inFlight.has(id)) return this.inFlight.get(id);
    const promise = this._performFetch(id).finally(() => this.inFlight.delete(id));
    this.inFlight.set(id, promise);
    return promise;
  }

  async _performFetch(id) {
    const source = this._requireSource(id);
    await this._hook('beforeFetch', { sourceId: id, url: source.url });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout);
    let response;
    let body;
    try {
      response = await this.httpFetch(source.url, {
        headers: { 'user-agent': this.userAgent },
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!response || typeof response.arrayBuffer !== 'function') throw new TypeError('fetch returned an invalid response');
      if (!response.ok) {
        throw new FetcharyFetchError(`fetch failed with HTTP ${response.status}`, {
          sourceId: id,
          url: source.url,
          status: response.status,
        });
      }
      body = Buffer.from(await response.arrayBuffer());
    } catch (cause) {
      const error = cause instanceof FetcharyFetchError ? cause : new FetcharyFetchError(`fetch failed for ${source.url}`, {
        sourceId: id,
        url: source.url,
        cause,
      });
      const event = { sourceId: id, url: source.url, error };
      this._emit('fetch:error', event);
      this._emitError(error);
      await this._hook('onError', event);
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const fetchedAt = isoNow();
    const hash = crypto.createHash('sha256').update(body).digest('hex');
    const status = Number(response.status);
    const finalUrl = response.url || source.url;
    const contentType = response.headers?.get?.('content-type') || null;
    const etag = response.headers?.get?.('etag') || null;
    const lastModified = response.headers?.get?.('last-modified') || null;
    let outcome;
    let createdVersionDir;

    try {
      outcome = transaction(this.db, () => {
        const current = this.db.prepare('SELECT current_hash, current_version_id FROM urls WHERE id = ? AND removed_at IS NULL').get(id);
        if (!current) throw new FetcharyNotFoundError(`source ${id} does not exist`, { sourceId: id });
        if (current.current_hash === hash) {
          this.db.prepare('UPDATE urls SET last_checked_at = ? WHERE id = ?').run(fetchedAt, id);
          return { changed: false, version: Number(current.current_version_id) };
        }

        const latest = this.db.prepare('SELECT COALESCE(MAX(version_number), 0) AS number FROM versions WHERE url_id = ?').get(id);
        const versionNumber = Number(latest.number) + 1;
        const versionDir = path.join(this.dataDir, 'pages', String(id), String(versionNumber));
        createdVersionDir = versionDir;
        const file = path.join(versionDir, 'response.html');
        fs.mkdirSync(versionDir, { recursive: true });
        fs.writeFileSync(file, body);
        const metadata = {
          url: source.url,
          finalUrl,
          fetchedAt,
          status,
          contentType,
          contentLength: body.length,
          sha256: hash,
          etag,
          lastModified,
        };
        fs.writeFileSync(path.join(versionDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
        this.db.prepare(`
          INSERT INTO versions (
            url_id, version_number, requested_url, fetched_at, status_code,
            final_url, content_type, content_length, hash, file, etag, last_modified
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, versionNumber, source.url, fetchedAt, status, finalUrl, contentType, body.length, hash, file, etag, lastModified);
        this.db.prepare(`
          UPDATE urls SET last_checked_at = ?, last_changed_at = ?, current_hash = ?, current_version_id = ?
          WHERE id = ?
        `).run(fetchedAt, fetchedAt, hash, versionNumber, id);
        return { changed: true, previousHash: current.current_hash, version: versionNumber, file };
      });
    } catch (cause) {
      if (createdVersionDir) {
        try { fs.rmSync(createdVersionDir, { recursive: true, force: true }); } catch {}
      }
      const error = cause instanceof FetcharyError ? cause : new FetcharyStorageError('could not archive response', { cause, sourceId: id });
      const event = { sourceId: id, url: source.url, error };
      this._emit('fetch:error', event);
      this._emitError(error);
      await this._hook('onError', event);
      throw error;
    }

    const result = {
      id,
      sourceId: id,
      url: source.url,
      changed: outcome.changed,
      ...(outcome.changed && outcome.previousHash ? { previousHash: outcome.previousHash } : {}),
      hash,
      version: outcome.version,
      fetchedAt,
      status,
      contentLength: body.length,
    };
    if (outcome.changed) {
      const archivedVersion = await this.version(id, outcome.version);
      this._emit('version', archivedVersion);
      this._emit('change', result);
      await this._hook('onChange', result);
    }
    this._emit('fetch', result);
    await this._hook('afterFetch', result);
    return result;
  }

  async history(id, options = {}) {
    this._assertOpen();
    const sourceId = validateId(id);
    this._requireSource(sourceId, true);
    const limit = options.limit == null ? -1 : Number(options.limit);
    const offset = options.offset == null ? 0 : Number(options.offset);
    if (!Number.isInteger(limit) || limit === 0 || limit < -1 || !Number.isInteger(offset) || offset < 0) {
      throw new FetcharyValidationError('history limit and offset are invalid');
    }
    return this.db.prepare(`
      SELECT * FROM versions WHERE url_id = ? ORDER BY version_number DESC LIMIT ? OFFSET ?
    `).all(sourceId, limit, offset).map(versionFromRow);
  }

  async version(sourceId, versionId) {
    this._assertOpen();
    const id = validateId(sourceId);
    this._requireSource(id, true);
    const row = versionId == null
      ? this.db.prepare('SELECT * FROM versions WHERE url_id = ? ORDER BY version_number DESC LIMIT 1').get(id)
      : this.db.prepare('SELECT * FROM versions WHERE url_id = ? AND version_number = ?').get(id, validateId(versionId, 'version id'));
    if (!row) throw new FetcharyNotFoundError(`version ${versionId ?? 'latest'} does not exist for source ${id}`, { sourceId: id, versionId });
    return versionFromRow(row);
  }

  async read(sourceId, versionId) {
    const archived = await this.version(sourceId, versionId);
    try { return await fs.promises.readFile(archived.file, 'utf8'); } catch (cause) {
      throw new FetcharyStorageError(`could not read archived version ${archived.id}`, { cause, sourceId: archived.sourceId, versionId: archived.id });
    }
  }

  async diff(sourceId, options = {}) {
    this._assertOpen();
    const id = validateId(sourceId);
    const mode = options.mode ?? 'text';
    if (!['text', 'raw'].includes(mode)) throw new FetcharyValidationError('diff mode must be "text" or "raw"');
    let from = options.from;
    let to = options.to;
    if (from == null || to == null) {
      const latest = await this.history(id, { limit: 2 });
      if (latest.length < 2) throw new FetcharyValidationError(`source ${id} needs at least two versions for a diff`, { sourceId: id });
      to ??= latest[0].id;
      from ??= latest[1].id;
    }
    const [beforeHtml, afterHtml] = await Promise.all([this.read(id, from), this.read(id, to)]);
    const before = mode === 'raw' ? beforeHtml : htmlToText(beforeHtml);
    const after = mode === 'raw' ? afterHtml : htmlToText(afterHtml);
    const changes = lineDiff(before, after);
    return { sourceId: id, from: Number(from), to: Number(to), mode, changed: changes.length > 0, diff: changes };
  }

  async edit(id, changes = {}) {
    this._assertOpen();
    const source = this._requireSource(id);
    const allowed = ['url', 'name', 'tag'];
    const entries = Object.entries(changes).filter(([key]) => allowed.includes(key));
    if (!entries.length) throw new FetcharyValidationError('provide at least one of url, name, or tag');
    const assignments = [];
    const values = [];
    for (const [key, value] of entries) {
      if (key === 'url') {
        assignments.push('url = ?');
        values.push(validateUrl(value));
      } else {
        if (value != null && typeof value !== 'string') throw new FetcharyValidationError(`${key} must be a string or null`);
        assignments.push(`${key} = ?`);
        values.push(value ?? null);
      }
    }
    try { this.db.prepare(`UPDATE urls SET ${assignments.join(', ')} WHERE id = ?`).run(...values, source.id); } catch (cause) {
      throw new FetcharyValidationError('could not update source', { cause, sourceId: source.id });
    }
    return this._requireSource(source.id);
  }

  async enable(id) {
    this._assertOpen();
    const source = this._requireSource(id);
    this.db.prepare('UPDATE urls SET enabled = 1 WHERE id = ?').run(source.id);
    return this._requireSource(source.id);
  }

  async disable(id) {
    this._assertOpen();
    const source = this._requireSource(id);
    this.db.prepare('UPDATE urls SET enabled = 0 WHERE id = ?').run(source.id);
    return this._requireSource(source.id);
  }

  async remove(id, options = {}) {
    this._assertOpen();
    const source = this._requireSource(id, Boolean(options.purge));
    if (!options.purge) {
      const now = isoNow();
      transaction(this.db, () => {
        this.db.prepare('UPDATE urls SET enabled = 0, removed_at = ? WHERE id = ?').run(now, source.id);
        this.db.prepare('UPDATE schedules SET enabled = 0 WHERE url_id = ?').run(source.id);
      });
      return;
    }
    const sourceDir = path.join(this.dataDir, 'pages', String(source.id));
    const tombstone = `${sourceDir}.purge-${process.pid}-${Date.now()}`;
    let moved = false;
    let metadataDeleted = false;
    try {
      if (fs.existsSync(sourceDir)) {
        fs.renameSync(sourceDir, tombstone);
        moved = true;
      }
      transaction(this.db, () => this.db.prepare('DELETE FROM urls WHERE id = ?').run(source.id));
      metadataDeleted = true;
      if (moved) fs.rmSync(tombstone, { recursive: true, force: true });
    } catch (cause) {
      if (!metadataDeleted && moved && fs.existsSync(tombstone) && !fs.existsSync(sourceDir)) {
        try { fs.renameSync(tombstone, sourceDir); } catch {}
      }
      throw new FetcharyStorageError(`could not purge source ${source.id}`, { cause, sourceId: source.id });
    }
  }

  async schedule(id, every, options = {}) {
    this._assertOpen();
    const source = this._requireSource(id);
    const interval = parseInterval(every);
    const immediate = options.now ? await this.fetch(source.id) : null;
    const nextRunAt = new Date(Date.now() + interval.intervalSeconds * 1000).toISOString();
    this.db.prepare(`
      INSERT INTO schedules (url_id, every, interval_seconds, enabled, last_run_at, next_fetch_at)
      VALUES (?, ?, ?, 1, ?, ?)
      ON CONFLICT(url_id) DO UPDATE SET
        every = excluded.every,
        interval_seconds = excluded.interval_seconds,
        enabled = 1,
        last_run_at = COALESCE(excluded.last_run_at, schedules.last_run_at),
        next_fetch_at = excluded.next_fetch_at
    `).run(source.id, interval.every, interval.intervalSeconds, immediate?.fetchedAt ?? null, nextRunAt);
    return { sourceId: source.id, enabled: true, ...interval, lastRunAt: immediate?.fetchedAt ?? null, nextRunAt };
  }

  async unschedule(id) {
    this._assertOpen();
    const source = this._requireSource(id);
    this.db.prepare('UPDATE schedules SET enabled = 0 WHERE url_id = ?').run(source.id);
  }

  async schedules() {
    this._assertOpen();
    return this.db.prepare(`
      SELECT s.* FROM schedules s
      JOIN urls u ON u.id = s.url_id
      WHERE s.enabled = 1 AND u.removed_at IS NULL
      ORDER BY s.next_fetch_at, s.url_id
    `).all().map(row => ({
      sourceId: Number(row.url_id),
      enabled: asBoolean(row.enabled),
      every: row.every,
      intervalSeconds: Number(row.interval_seconds),
      lastRunAt: row.last_run_at,
      nextRunAt: row.next_fetch_at,
    }));
  }

  async run(options = {}) {
    this._assertOpen();
    if (this.runner) throw new FetcharyRunnerError('a scheduler is already active for this data directory');
    const pollInterval = options.pollInterval ?? 1_000;
    if (!Number.isFinite(pollInterval) || pollInterval < 10) throw new FetcharyValidationError('pollInterval must be at least 10 milliseconds');
    const lock = acquireLock(this.dataDir);
    let stopped = false;
    let ticking = false;
    const tick = async () => {
      if (stopped || ticking || this.closed) return;
      ticking = true;
      try {
        const due = this.db.prepare(`
          SELECT s.url_id, s.interval_seconds FROM schedules s
          JOIN urls u ON u.id = s.url_id
          WHERE s.enabled = 1 AND u.enabled = 1 AND u.removed_at IS NULL AND s.next_fetch_at <= ?
          ORDER BY s.next_fetch_at
        `).all(isoNow());
        for (const row of due) {
          const sourceId = Number(row.url_id);
          const runAt = isoNow();
          try { await this.fetch(sourceId); } catch {}
          const nextRunAt = new Date(Date.now() + Number(row.interval_seconds) * 1000).toISOString();
          this.db.prepare('UPDATE schedules SET last_run_at = ?, next_fetch_at = ? WHERE url_id = ? AND enabled = 1').run(runAt, nextRunAt, sourceId);
        }
      } catch (error) {
        this._emitError(error);
      } finally {
        ticking = false;
      }
    };
    const timer = setInterval(tick, pollInterval);
    const runner = {
      stop: async () => {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
        while (ticking) await new Promise(resolve => setTimeout(resolve, 5));
        releaseLock(lock);
        if (this.runner === runner) this.runner = null;
        this._emit('scheduler:stop', { dataDir: this.dataDir });
      },
    };
    this.runner = runner;
    this._emit('scheduler:start', { dataDir: this.dataDir, pollInterval });
    void tick();
    return runner;
  }

  async export(id, options = {}) {
    this._assertOpen();
    const source = this._requireSource(id, true);
    const versions = await this.history(source.id);
    const root = path.resolve(options.output || process.cwd());
    const directory = path.join(root, `fetchary-export-${source.id}`);
    const versionsDir = path.join(directory, 'versions');
    try {
      await fs.promises.mkdir(versionsDir, { recursive: true });
      const ordered = [...versions].sort((a, b) => a.id - b.id);
      for (const archived of ordered) {
        await fs.promises.copyFile(archived.file, path.join(versionsDir, `${String(archived.id).padStart(3, '0')}.html`));
      }
      const metadata = { exportedAt: isoNow(), source, versions: ordered };
      await fs.promises.writeFile(path.join(directory, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
      await fs.promises.writeFile(path.join(directory, 'hashes.txt'), ordered.map(item => `${item.hash}  versions/${String(item.id).padStart(3, '0')}.html`).join('\n') + (ordered.length ? '\n' : ''));
    } catch (cause) {
      throw new FetcharyStorageError(`could not export source ${source.id}`, { cause, sourceId: source.id });
    }
    return { sourceId: source.id, directory, versions: versions.length };
  }

  async status() {
    this._assertOpen();
    const row = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM urls WHERE removed_at IS NULL) AS sources,
        (SELECT COUNT(*) FROM versions v JOIN urls u ON u.id = v.url_id WHERE u.removed_at IS NULL) AS versions,
        (SELECT COUNT(*) FROM urls WHERE removed_at IS NULL AND last_changed_at >= ?) AS changed_today,
        (SELECT MAX(last_checked_at) FROM urls WHERE removed_at IS NULL) AS last_fetch
    `).get(new Date().toISOString().slice(0, 10));
    return {
      sources: Number(row.sources),
      versions: Number(row.versions),
      changedToday: Number(row.changed_today),
      lastFetch: row.last_fetch,
      database: this.databasePath,
    };
  }

  async close() {
    if (this.closed) return;
    if (this.runner) await this.runner.stop();
    if (this.inFlight.size) await Promise.allSettled([...this.inFlight.values()]);
    this.db.close();
    this.closed = true;
  }
}

module.exports = { Fetchary, validateId, validateUrl };
