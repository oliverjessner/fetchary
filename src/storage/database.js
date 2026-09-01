'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { FetcharyStorageError } = require('../errors');

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

      CREATE TABLE IF NOT EXISTS versions (
        id INTEGER PRIMARY KEY,
        url_id INTEGER NOT NULL,
        version_number INTEGER NOT NULL,
        requested_url TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        status_code INTEGER,
        final_url TEXT,
        content_type TEXT,
        content_length INTEGER,
        hash TEXT NOT NULL,
        file TEXT NOT NULL,
        etag TEXT,
        last_modified TEXT,
        UNIQUE (url_id, version_number),
        FOREIGN KEY (url_id) REFERENCES urls(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS versions_url_id_idx ON versions(url_id, version_number DESC);

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
