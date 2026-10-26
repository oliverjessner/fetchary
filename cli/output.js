'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { FetcharyValidationError, FetcharyError } = require('../src/errors');

async function prepareOutput(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new FetcharyValidationError('--filepath must be a file or directory path');
  const target = path.resolve(value);
  try {
    const stat = await fs.lstat(target);
    if (!stat.isDirectory()) throw new FetcharyValidationError('--filepath already exists; choose a new file or an output directory');
    return { target, directory: true };
  } catch (error) {
    if (error.code === 'ENOENT') return { target, directory: /[\\/]$/.test(value) || !path.extname(target) };
    if (error instanceof FetcharyValidationError) throw error;
    throw new FetcharyValidationError('could not access --filepath');
  }
}
function extension(state) {
  const { options = {}, type, command, result } = state;
  if (options.help || options.version || !command) return 'txt';
  if (options.binary) return { 'image/png':'png', 'image/jpeg':'jpg', 'image/gif':'gif', 'image/webp':'webp', 'image/svg+xml':'svg', 'image/x-icon':'ico', 'image/vnd.microsoft.icon':'ico' }[result?.image?.contentType] || 'bin';
  if (options.json) return 'json';
  if (options.list || options['urls-only']) return 'txt';
  if (type === 'analyse' || ['images','videos','social-links','social-insights','emails','telephone','links','documents','metadata','structured-data','tracker-intelligence','price'].includes(type)) return 'json';
  return type === 'html' || type === 'selector' && options.format === 'html' ? 'html' : 'txt';
}
async function saveOutput(plan, body, state) {
  const suffix = extension(state);
  const label = [state.command || (state.options?.version ? 'version' : 'help'), state.type].filter(Boolean).join('-').replace(/[^a-z0-9-]/gi, '-');
  const filename = `fetchary-${label}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.${suffix}`;
  const target = plan.directory ? path.join(plan.target, filename) : plan.target;
  let handle; let created = false;
  try {
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    handle = await fs.open(target, 'wx', 0o600); created = true;
    await handle.writeFile(body); await handle.close(); handle = null;
    return target;
  } catch (error) {
    await handle?.close().catch(() => {});
    if (created) await fs.unlink(target).catch(() => {});
    throw new FetcharyError(error.code === 'EEXIST' ? 'output file already exists; choose a new --filepath' : 'could not save output to --filepath');
  }
}
module.exports = { prepareOutput, saveOutput };
