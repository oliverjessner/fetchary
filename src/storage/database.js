'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { FetcharyStorageError } = require('../errors');

function versionsTableSql(name, ifNotExists = false) {
  return `
    CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${name} (
      id INTEGER PRIMARY KEY,
      url_id INTEGER NOT NULL,
      version_number INTEGER NOT NULL,
      requested_url TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      final_url TEXT NOT NULL,
      content_type TEXT,
      content_length INTEGER NOT NULL,
      hash TEXT NOT NULL,
      file TEXT NOT NULL,
      etag TEXT,
      last_modified TEXT,
      UNIQUE (url_id, version_number),
      FOREIGN KEY (url_id) REFERENCES urls(id) ON DELETE CASCADE
    )
  `;
}

function migrateVersionsRequiredColumns(db) {
  const columns = new Map(db.prepare('PRAGMA table_info(versions)').all().map(column => [column.name, column]));
  const required = ['status_code', 'final_url', 'content_length'];
  if (required.every(name => Number(columns.get(name)?.notnull) === 1)) return;

  const invalid = db.prepare(`
    SELECT COUNT(*) AS count FROM versions
    WHERE status_code IS NULL OR final_url IS NULL OR content_length IS NULL
  `).get();
  if (Number(invalid.count) > 0) {
    throw new Error('cannot require version status_code, final_url, and content_length while NULL values exist');
  }

  transaction(db, () => {
    db.exec(`${versionsTableSql('versions_required_migration')};
      INSERT INTO versions_required_migration (
        id, url_id, version_number, requested_url, fetched_at, status_code,
        final_url, content_type, content_length, hash, file, etag, last_modified
      )
      SELECT
        id, url_id, version_number, requested_url, fetched_at, status_code,
        final_url, content_type, content_length, hash, file, etag, last_modified
      FROM versions;
      DROP TABLE versions;
      ALTER TABLE versions_required_migration RENAME TO versions;
    `);
  });
}

function openDatabase(dataDir) {
  try {
    fs.mkdirSync(path.join(dataDir, 'pages'), { recursive: true });
    const databasePath = path.join(dataDir, 'fetchary.sqlite');
    const db = new DatabaseSync(databasePath);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec(`
      CREATE TABLE IF NOT EXISTS urls (
        id INTEGER PRIMARY KEY,
        url TEXT NOT NULL UNIQUE,
        name TEXT,
        tag TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        last_checked_at TEXT,
        last_changed_at TEXT,
        current_hash TEXT,
        current_version_id INTEGER,
        removed_at TEXT
      );

      ${versionsTableSql('versions', true)};

      CREATE TABLE IF NOT EXISTS schedules (
        url_id INTEGER PRIMARY KEY,
        every TEXT NOT NULL,
        interval_seconds INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run_at TEXT,
        next_fetch_at TEXT NOT NULL,
        FOREIGN KEY (url_id) REFERENCES urls(id) ON DELETE CASCADE
      );
    `);
    migrateVersionsRequiredColumns(db);
    db.exec('CREATE INDEX IF NOT EXISTS versions_url_id_idx ON versions(url_id, version_number DESC)');
    return { db, databasePath };
  } catch (cause) {
    throw new FetcharyStorageError(`could not initialize storage at ${dataDir}`, { cause, dataDir });
  }
}

function transaction(db, callback) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

module.exports = { openDatabase, transaction };
