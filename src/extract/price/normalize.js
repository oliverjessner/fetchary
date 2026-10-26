'use strict';

const currencies = new Set(Intl.supportedValuesOf('currency'));
const symbols = { '€':'EUR', '£':'GBP', '₹':'INR', '₩':'KRW', '₽':'RUB', '₺':'TRY', '₫':'VND', '₴':'UAH' };

function currencyCode(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return currencies.has(code) ? code : null;
}

// No Number/parseFloat arithmetic: even very large amounts retain their digits.
function normalizePrice(value, currency, machine = false) {
  const raw = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 2048) return { amount:null, currency:currencyCode(currency), error:'INVALID_AMOUNT' };
  const found = new Set();
  let text = raw.trim();
  text = text.replace(/(?<![A-Za-z])[A-Za-z]{3}(?![A-Za-z])/g, token => {
    const code = currencyCode(token);
    if (code) { found.add(code); return ''; }
    return token;
  });
  text = text.replace(/US\$|CA\$|AU\$|NZ\$|HK\$|SG\$/gi, token => {
    found.add({ US:'USD', CA:'CAD', AU:'AUD', NZ:'NZD', HK:'HKD', SG:'SGD' }[token.slice(0,2).toUpperCase()]); return '';
  });
  text = text.replace(/[€£₹₩₽₺₫₴]/g, token => { found.add(symbols[token]); return ''; });
  const explicit = currencyCode(currency);
  if (explicit) found.add(explicit);
  const normalizedCurrency = found.size === 1 ? [...found][0] : null;
  const fail = error => ({ amount:null, currency:normalizedCurrency, error });
  if (currency != null && !explicit || found.size > 1) return fail('AMBIGUOUS_CURRENCY');
  // Bare dollar and yen signs deliberately provide no ISO currency.
  text = text.replace(/[$¥￥]/g, '').trim().replace(/[\u00a0\u202f]/g, ' ').replace(/[’]/g, "'");
  if (!/^\d[\d., '\t]*$/.test(text)) return fail('INVALID_AMOUNT');
  const spaces = /[ '\t]/.test(text);
  if (spaces) {
    if (!/^\d{1,3}(?:[ '\t]\d{3})+(?:[.,]\d{1,6})?$/.test(text)) return fail('INVALID_AMOUNT');
    text = text.replace(/[ '\t]/g, '');
  }
  const dots = (text.match(/\./g) || []).length; const commas = (text.match(/,/g) || []).length;
  let integer; let fraction = '';
  if (dots && commas) {
    const decimal = text.lastIndexOf('.') > text.lastIndexOf(',') ? '.' : ',';
    const group = decimal === '.' ? ',' : '.';
    const parts = text.split(decimal);
    if (parts.length !== 2 || !/^\d{1,6}$/.test(parts[1]) || !new RegExp(`^\\d{1,3}(?:\\${group}\\d{3})+$`).test(parts[0])) return fail('INVALID_AMOUNT');
    integer = parts[0].split(group).join(''); fraction = parts[1];
  } else if (dots || commas) {
    const separator = dots ? '.' : ','; const parts = text.split(separator);
    if (parts.length > 2) {
      if (!/^\d{1,3}$/.test(parts[0]) || parts.slice(1).some(part => !/^\d{3}$/.test(part))) return fail('INVALID_AMOUNT');
      integer = parts.join('');
    } else {
      [integer, fraction] = parts;
      if (!/^\d+$/.test(integer) || !/^\d{1,6}$/.test(fraction)) return fail('INVALID_AMOUNT');
      if (!spaces && fraction.length === 3 && (!machine || separator === ',')) return fail('AMBIGUOUS_NUMBER');
    }
  } else integer = text;
  integer = integer.replace(/^0+(?=\d)/, '');
  fraction = fraction.replace(/0+$/, '').padEnd(2, '0');
  return { amount:`${integer}.${fraction}`, currency:normalizedCurrency, error:null };
}

module.exports = { normalizePrice, currencyCode };
