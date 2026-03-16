const crypto = require('crypto');

const BASE_URL = 'https://public-api.etoro.com/api/v1';

const getAuthHeaders = () => {
  const apiKey = process.env.eToroPublic;
  const userKey = process.env.eToroSecret;

  if (!apiKey || !userKey) {
    const err = new Error('Missing eToro API credentials in environment');
    err.code = 'ETORO_AUTH_MISSING';
    throw err;
  }

  return {
    'x-api-key': apiKey,
    'x-user-key': userKey
  };
};

const encodeQueryValue = (value) => {
  return encodeURIComponent(String(value)).replace(/%2C/gi, ',');
};

const buildQueryString = (query) => {
  if (!query || typeof query !== 'object') {
    return '';
  }

  const parts = [];

  Object.keys(query).forEach((key) => {
    const rawValue = query[key];
    if (rawValue === undefined || rawValue === null || rawValue === '') {
      return;
    }

    const value = Array.isArray(rawValue) ? rawValue.join(',') : rawValue;
    parts.push(`${encodeURIComponent(key)}=${encodeQueryValue(value)}`);
  });

  if (!parts.length) {
    return '';
  }

  return `?${parts.join('&')}`;
};

const sanitizeErrorMessage = (message) => {
  if (!message) {
    return 'Unknown eToro error';
  }

  return message
    .replace(/mongodb(\+srv)?:\/\/[^@]+@/gi, 'mongodb$1://<credentials>@')
    .replace(/x-api-key[^,\\n]*/gi, 'x-api-key=<redacted>')
    .replace(/x-user-key[^,\\n]*/gi, 'x-user-key=<redacted>');
};

const parseBody = async (response) => {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    return text;
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const etoroGet = async (path, query = {}, retries = 2) => {
  const url = `${BASE_URL}${path}${buildQueryString(query)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      ...getAuthHeaders(),
      'x-request-id': crypto.randomUUID()
    }
  });

  // Retry on 429 (rate limit) with exponential backoff
  if (response.status === 429 && retries > 0) {
    const delay = (3 - retries) * 2000; // 2s, 4s
    await sleep(delay);
    return etoroGet(path, query, retries - 1);
  }

  const body = await parseBody(response);

  if (!response.ok) {
    const err = new Error(`eToro request failed (${response.status})`);
    err.code = 'ETORO_HTTP_ERROR';
    err.status = response.status;
    err.details = typeof body === 'string'
      ? sanitizeErrorMessage(body).slice(0, 300)
      : body;
    throw err;
  }

  return body;
};

exports.etoroGet = etoroGet;
