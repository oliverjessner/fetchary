'use strict';

const { Fetchary } = require('./fetchary');
const errors = require('./errors');
const { parseInterval } = require('./intervals');
const { extract, extractFavicon, extractProfilePicture } = require('./extract');

async function createFetchary(options = {}) {
  return new Fetchary(options);
}

exports.createFetchary = createFetchary;
exports.Fetchary = Fetchary;
exports.parseInterval = parseInterval;
exports.extract = extract;
exports.extractFavicon = extractFavicon;
exports.extractProfilePicture = extractProfilePicture;
exports.FetcharyError = errors.FetcharyError;
exports.FetcharyFetchError = errors.FetcharyFetchError;
exports.FetcharyBrowserError = errors.FetcharyBrowserError;
exports.FetcharyNotFoundError = errors.FetcharyNotFoundError;
exports.FetcharyIntervalError = errors.FetcharyIntervalError;
exports.FetcharyStorageError = errors.FetcharyStorageError;
exports.FetcharyValidationError = errors.FetcharyValidationError;
exports.FetcharyRunnerError = errors.FetcharyRunnerError;
