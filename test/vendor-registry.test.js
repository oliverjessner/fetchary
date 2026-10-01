'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { createFetchary, FetcharyNotFoundError, FetcharyValidationError } = require('../src');
const { discoverVendors } = require('../src/vendors');
const { openDatabase } = require('../src/storage/database');
const { VendorRegistry } = require('../src/storage/vendors');

function tempDir(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fetchary-vendors-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeVendor(directory, file, name = file) {
  fs.writeFileSync(path.join(directory, `${file}.js`), `module.exports = {
    name: ${JSON.stringify(name)},
    matches: url => url === 'https://example.test/',
    overlays: [{ id: ${JSON.stringify(`${name}-cookie-consent`)}, async dismiss() { return true; } }],
  };`);
}

test('vendors are discovered at startup and activation persists across synchronization and restart', async t => {
  const dataDir = tempDir(t);
  let fetchary = await createFetchary({ dataDir });
  t.after(() => fetchary.close());
  const expected = discoverVendors().map(vendor => ({ name: vendor.name, active: true })).sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(await fetchary.vendors(), expected);
  assert.deepEqual(await fetchary.setVendorActive(' InStAgRaM ', false), { name: 'instagram', active: false });

  const disabled = expected.map(vendor => ({ ...vendor, active: vendor.name !== 'instagram' }));
  assert.deepEqual(await fetchary.syncVendors(), disabled);
  assert.deepEqual(await fetchary.syncVendors(), disabled, 'sync is idempotent');
  await fetchary.close();
  fetchary = await createFetchary({ dataDir });
  assert.deepEqual(await fetchary.vendors(), disabled);

  const database = new DatabaseSync(fetchary.databasePath);
  t.after(() => database.close());
  assert.equal(database.prepare('SELECT active FROM vendors WHERE name = ?').get('instagram').active, 0);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM vendors').get().count, expected.length);
  assert.throws(() => database.prepare('UPDATE vendors SET active = 2 WHERE name = ?').run('instagram'), /CHECK constraint/);
  assert.throws(() => database.prepare('UPDATE vendors SET active = NULL WHERE name = ?').run('instagram'), /NOT NULL constraint/);
  assert.deepEqual(await fetchary.setVendorActive('instagram', true), { name: 'instagram', active: true });
});

test('new vendor files are discovered without a registration list and existing flags are preserved', t => {
  const directory = tempDir(t);
  const { db } = openDatabase(tempDir(t));
  t.after(() => db.close());
  fs.writeFileSync(path.join(directory, 'index.js'), 'throw new Error("entrypoint must not be loaded");');
  fs.writeFileSync(path.join(directory, 'README.md'), 'Not a vendor module');
  fs.mkdirSync(path.join(directory, 'nested.js'));
  writeVendor(directory, 'alpha');
  const registry = new VendorRegistry(db, directory);
  assert.deepEqual(registry.sync(), [{ name: 'alpha', active: true }]);
  registry.setActive('alpha', false);

  writeVendor(directory, 'beta');
  assert.deepEqual(registry.sync(), [{ name: 'alpha', active: false }, { name: 'beta', active: true }]);
  assert.deepEqual(registry.activeModules().map(vendor => vendor.name), ['beta']);
  registry.setActive('alpha', true);
  fs.unlinkSync(path.join(directory, 'alpha.js'));
  assert.deepEqual(registry.sync(), [{ name: 'alpha', active: true }, { name: 'beta', active: true }]);
  assert.deepEqual(registry.activeModules().map(vendor => vendor.name), ['beta'], 'missing modules are never executed');
  assert.deepEqual(registry.sync(), registry.list());
});

test('invalid or duplicate vendor modules fail synchronization without partially inserting rows', t => {
  const directory = tempDir(t);
  const { db } = openDatabase(tempDir(t));
  t.after(() => db.close());
  writeVendor(directory, 'alpha');
  const registry = new VendorRegistry(db, directory);
  registry.sync();
  registry.setActive('alpha', false);
  writeVendor(directory, 'beta');
  writeVendor(directory, 'duplicate', 'alpha');
  assert.throws(() => registry.sync(), error => error instanceof FetcharyValidationError && /duplicate vendor name/.test(error.message));
  assert.deepEqual(registry.list(), [{ name: 'alpha', active: false }]);
  fs.unlinkSync(path.join(directory, 'duplicate.js'));
  fs.writeFileSync(path.join(directory, 'invalid.js'), 'module.exports = { name: "invalid" };');
  assert.throws(() => registry.sync(), error => error instanceof FetcharyValidationError && /invalid vendor module/.test(error.message));
  assert.deepEqual(registry.list(), [{ name: 'alpha', active: false }]);
  fs.unlinkSync(path.join(directory, 'invalid.js'));
  assert.deepEqual(registry.sync(), [{ name: 'alpha', active: false }, { name: 'beta', active: true }]);
});

test('vendor activation validates arguments and respects the instance lifecycle', async t => {
  const fetchary = await createFetchary({ dataDir: tempDir(t) });
  t.after(() => fetchary.close());
  for (const active of [0, 1, 'false', null, undefined]) {
    await assert.rejects(() => fetchary.setVendorActive('instagram', active), FetcharyValidationError);
  }
  for (const name of ['', ' ', null, 12, 'instagram; DROP TABLE vendors']) {
    await assert.rejects(() => fetchary.setVendorActive(name, false), FetcharyValidationError);
  }
  await assert.rejects(() => fetchary.setVendorActive('unknown', false), FetcharyNotFoundError);
  assert.equal((await fetchary.vendors()).find(vendor => vendor.name === 'instagram').active, true);
  await fetchary.close();
  await assert.rejects(() => fetchary.vendors(), /instance is closed/);
  await assert.rejects(() => fetchary.syncVendors(), /instance is closed/);
  await assert.rejects(() => fetchary.setVendorActive('instagram', false), /instance is closed/);
});

test('disabled vendors skip preparation and overlays while generic capture continues', async t => {
  const dataDir = tempDir(t);
  let preparations = 0;
  let evaluations = 0;
  const raw = '<div id="app">Original response</div>';
  const options = {
    dataDir,
    fetch: async () => new Response(raw, { headers: { 'content-type': 'text/html' } }),
    launchBrowser: async () => ({
      async newPage() {
        let handled = false;
        return {
          browser() { return { async userAgent() { return 'Mozilla/5.0 HeadlessChrome/140.0.0.0'; } }; },
          async setUserAgent() { preparations++; },
          async goto() {},
          async evaluate() { evaluations++; handled = true; return true; },
          async content() { return `<html><body><main>${handled ? 'Public profile' : 'Profile with overlays'}</main></body></html>`; },
          url() { return 'https://x.com/example'; },
          async close() {},
        };
      },
      async close() {},
    }),
  };
  const fetchary = await createFetchary(options);
  const other = await createFetchary({ dataDir });
  const independent = await createFetchary({ dataDir: tempDir(t) });
  t.after(() => Promise.all([fetchary.close(), other.close(), independent.close()]));
  const source = await fetchary.add('https://x.com/example', { waitAfterLoad: 0 });
  assert.equal(preparations, 1);
  assert.equal(evaluations, 2);

  await other.setVendorActive('x', false);
  const disabled = await fetchary.fetch(source.id);
  assert.equal(preparations, 1);
  assert.equal(evaluations, 2);
  assert.deepEqual(disabled.dismissedOverlays, []);
  assert.equal(await fetchary.read(source.id), raw);
  assert.match(await fetchary.readRendered(source.id), /Profile with overlays/);
  assert.equal((await fetchary.get(source.id)).enabled, true, 'deactivating a vendor does not disable its sources');
  assert.equal((await independent.vendors()).find(vendor => vendor.name === 'x').active, true, 'settings are isolated by data directory');

  const redirected = await fetchary.add('https://redirect.test/profile', { waitAfterLoad: 0 });
  assert.equal(preparations, 1);
  assert.equal(evaluations, 2, 'disabled vendors remain disabled after redirects');
  assert.match(await fetchary.readRendered(redirected.id), /Profile with overlays/);

  await other.setVendorActive('x', true);
  const enabled = await fetchary.fetch(source.id);
  assert.equal(preparations, 2);
  assert.equal(evaluations, 4);
  assert.deepEqual(enabled.dismissedOverlays, ['x-cookie-consent', 'x-login-dialog']);
  assert.match(await fetchary.readRendered(source.id), /Public profile/);
});
