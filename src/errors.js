'use strict';

class FetcharyError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    if (Error.captureStackTrace) Error.captureStackTrace(this, new.target);
    for (const [key, value] of Object.entries(options)) {
      if (key !== 'cause' && value !== undefined) this[key] = value;
    }
  }
}

class FetcharyFetchError extends FetcharyError {}
class FetcharyNotFoundError extends FetcharyError {}
class FetcharyIntervalError extends FetcharyError {}
class FetcharyStorageError extends FetcharyError {}
class FetcharyValidationError extends FetcharyError {}
class FetcharyRunnerError extends FetcharyError {}

module.exports = {
  FetcharyError,
  FetcharyFetchError,
  FetcharyNotFoundError,
  FetcharyIntervalError,
  FetcharyStorageError,
  FetcharyValidationError,
  FetcharyRunnerError,
};
