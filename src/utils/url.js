'use strict';

const dns = require('node:dns/promises');
const { isIP, BlockList } = require('node:net');
const { FetcharyValidationError } = require('../errors');

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]]) blocked.addSubnet(address, prefix, 'ipv4');
// IPv6 is restricted to global unicast, excluding documentation, transition,
// and mapped ranges which can route back into private IPv4 networks.
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [['2001::',32],['2001:db8::',32],['2002::',16]]) blocked.addSubnet(address,prefix,'ipv6');

function validateUrl(value) {
  let url;
  try { if (typeof value !== 'string' || !value.trim()) throw new Error(); url = new URL(value); } catch {
    throw new FetcharyValidationError('url must be an absolute HTTP(S) URL');
  }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new FetcharyValidationError('url must use http or https without embedded credentials');
  return url.href;
}

function isPrivateAddress(address) {
  const family = isIP(address);
  if (!family) return true;
  return family === 4 ? blocked.check(address, 'ipv4') : !globalV6.check(address, 'ipv6') || blocked.check(address, 'ipv6');
}

async function validateRemoteUrl(value, options = {}) {
  const url = new URL(validateUrl(value));
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (options.allowPrivateNetwork) return { url, addresses: null };
  if (/^(?:localhost|.*\.(?:localhost|local|internal|home|lan))$/i.test(host) || !host.includes('.') && !isIP(host)) throw new FetcharyValidationError('private and internal network targets are disabled');
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await (options.lookup || dns.lookup)(host, { all: true, verbatim: true });
  if (!Array.isArray(addresses) || !addresses.length || addresses.some(item => isPrivateAddress(item.address))) throw new FetcharyValidationError('private and internal network targets are disabled');
  return { url, addresses };
}

module.exports = { validateUrl, validateRemoteUrl, isPrivateAddress };
