'use strict';

const { discoverVendors } = require('../vendors');
const { transaction } = require('./database');
const { FetcharyNotFoundError, FetcharyStorageError, FetcharyValidationError } = require('../errors');

function vendorFromRow(row) {
  return { name: row.name, active: Boolean(Number(row.active)) };
}

class VendorRegistry {
  constructor(db, directory) {
    this.db = db;
    this.directory = directory;
    this.modules = [];
  }

  sync() {
    const modules = discoverVendors(this.directory);
    try {
      transaction(this.db, () => {
        const insert = this.db.prepare('INSERT INTO vendors (name) VALUES (?) ON CONFLICT(name) DO NOTHING');
        for (const vendor of modules) insert.run(vendor.name);
      });
    } catch (cause) {
      throw new FetcharyStorageError('could not synchronize vendors', { cause });
    }
    this.modules = modules;
    return this.list();
  }

  list() {
    return this.db.prepare('SELECT name, active FROM vendors ORDER BY name').all().map(vendorFromRow);
  }

  setActive(name, active) {
    if (typeof name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(name.trim().toLowerCase())) {
      throw new FetcharyValidationError('vendor name must be a non-empty name such as "instagram"');
    }
    if (typeof active !== 'boolean') throw new FetcharyValidationError('vendor active must be a boolean');
    const vendorName = name.trim().toLowerCase();
    const result = this.db.prepare('UPDATE vendors SET active = ? WHERE name = ?').run(active ? 1 : 0, vendorName);
    if (Number(result.changes) === 0) {
      throw new FetcharyNotFoundError(`vendor "${vendorName}" does not exist`, { vendorName });
    }
    return vendorFromRow(this.db.prepare('SELECT name, active FROM vendors WHERE name = ?').get(vendorName));
  }

  activeModules() {
    const activeNames = new Set(this.db.prepare('SELECT name FROM vendors WHERE active = 1').all().map(row => row.name));
    return this.modules.filter(vendor => activeNames.has(vendor.name));
  }
}

module.exports = { VendorRegistry };
