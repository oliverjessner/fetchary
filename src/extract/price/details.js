'use strict';

const { FetcharyValidationError } = require('../../errors');
const { field, scalar, clean } = require('./common');
const { normalizePrice } = require('./normalize');

function normalizePriceContext(options = {}) {
  let country = null; let language = null;
  if (options.country !== undefined) {
    if (typeof options.country !== 'string' || !/^[A-Za-z]{2}$/.test(options.country)) throw new FetcharyValidationError('country must be a two-letter country code');
    country = options.country.toUpperCase();
  }
  if (options.language !== undefined) {
    if (typeof options.language !== 'string' || !options.language.trim()) throw new FetcharyValidationError('language must be a valid language tag');
    try { [language] = Intl.getCanonicalLocales(options.language); } catch { throw new FetcharyValidationError('language must be a valid language tag'); }
    if (!language) throw new FetcharyValidationError('language must be a valid language tag');
  }
  return { country, language };
}

function texts(value) {
  return [...new Set([value].flat().map(value => clean(scalar(value) ?? scalar(field(value, 'name')) ?? scalar(field(value, 'value')))).filter(Boolean))].sort();
}

function productVariant(object) {
  const variant = Object.fromEntries(['size', 'color', 'material', 'model'].map(name => [name, texts(field(object, name))]));
  variant.configuration = [];
  for (const property of [field(object, 'additionalProperty')].flat()) {
    if (!property || typeof property !== 'object') continue;
    const name = clean(scalar(field(property, 'name')))?.toLowerCase();
    const mapped = { size:'size', größe:'size', color:'color', colour:'color', farbe:'color', material:'material', model:'model', modell:'model', configuration:'configuration', execution:'configuration', ausführung:'configuration', finish:'configuration', style:'configuration' }[name];
    if (mapped) variant[mapped].push(...texts(field(property, 'value')));
  }
  for (const name of Object.keys(variant)) variant[name] = [...new Set(variant[name])].sort();
  return Object.values(variant).some(values => values.length) ? variant : undefined;
}

function domVariant(element) {
  const object = {};
  for (const name of ['size', 'color', 'material', 'model']) {
    const value = element?.getAttribute(`data-${name}`);
    if (value) object[name] = value;
  }
  const configuration = element?.getAttribute('data-configuration') || element?.getAttribute('data-style') || element?.getAttribute('data-finish');
  if (configuration) object.additionalProperty = { name:'configuration', value:configuration };
  return productVariant(object);
}

function shippingDetails(value, currency, resolve = () => undefined) {
  const dereference = value => resolve(value)?.object || value;
  const string = value => clean(scalar(value));
  const quantity = value => {
    const object = dereference(value);
    if (!object || typeof object !== 'object') return null;
    const number = value => { const text = string(value); return text && /^\d+(?:\.\d+)?$/.test(text) ? text : null; };
    const exact = number(field(object, 'value'));
    const result = { min:number(field(object, 'minValue')) ?? exact, max:number(field(object, 'maxValue')) ?? exact,
      unit:string(field(object, 'unitCode')) || string(field(object, 'unitText')) };
    return Object.values(result).some(value => value !== null) ? result : null;
  };
  return [value].flat().filter(value => value != null).slice(0, 64).map(value => {
    const detail = dereference(value);
    const rate = dereference(field(detail, 'shippingRate'));
    const rawAmount = scalar(field(rate, 'value')) ?? scalar(rate);
    const normalized = rawAmount == null ? null : normalizePrice(rawAmount, scalar(field(rate, 'currency')) || currency, true);
    const cost = normalized && !normalized.error ? { amount:normalized.amount, currency:normalized.currency } : null;
    const regions = [field(detail, 'shippingDestination')].flat().filter(Boolean).slice(0, 64).flatMap(value => {
      const region = dereference(value);
      const countries = [field(region, 'addressCountry')].flat().filter(value => value != null);
      return (countries.length ? countries : [null]).map(value => {
        const country = string(value) || string(field(dereference(value), 'identifier')) || string(field(dereference(value), 'name'));
        return { country:country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : country,
          region:string(field(region, 'addressRegion')), postalCode:string(field(region, 'postalCode')) };
      });
    });
    const time = dereference(field(detail, 'deliveryTime'));
    const handling = quantity(field(time, 'handlingTime')); const transit = quantity(field(time, 'transitTime'));
    return { cost, regions, deliveryTime:handling || transit ? { handling, transit } : null };
  });
}

module.exports = { normalizePriceContext, productVariant, domVariant, shippingDetails };
