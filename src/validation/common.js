'use strict';

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isStringOrNull(value) {
  return value === null || typeof value === 'string';
}

function isSnowflakeOrNull(value) {
  return value === null || /^\d{17,20}$/.test(String(value));
}

function isIsoDateOrNull(value) {
  if (value === null) return true;
  if (typeof value !== 'string') return false;
  return !Number.isNaN(Date.parse(value));
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function hasNoDuplicates(values) {
  return Array.isArray(values) && new Set(values.map(String)).size === values.length;
}

function requireObject(errors, value, path) {
  if (!isObject(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }

  return true;
}

function requireArray(errors, value, path) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return false;
  }

  return true;
}

function requireOneOf(errors, value, allowed, path) {
  if (!allowed.includes(value)) {
    errors.push(`${path} must be one of: ${allowed.join(', ')}`);
  }
}

function requireNonNegativeInteger(errors, value, path) {
  if (!isNonNegativeInteger(value)) {
    errors.push(`${path} must be a non-negative integer`);
  }
}

function requireSnowflakeOrNull(errors, value, path) {
  if (!isSnowflakeOrNull(value)) {
    errors.push(`${path} must be a Discord snowflake string or null`);
  }
}

function requireIsoDateOrNull(errors, value, path) {
  if (!isIsoDateOrNull(value)) {
    errors.push(`${path} must be an ISO date string or null`);
  }
}

module.exports = {
  hasNoDuplicates,
  isIsoDateOrNull,
  isNonNegativeInteger,
  isObject,
  isSnowflakeOrNull,
  isStringOrNull,
  requireArray,
  requireIsoDateOrNull,
  requireNonNegativeInteger,
  requireObject,
  requireOneOf,
  requireSnowflakeOrNull,
};
