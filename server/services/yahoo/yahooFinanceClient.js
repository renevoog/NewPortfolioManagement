// Direct Yahoo Finance HTTP client
// yahoo-finance2 v2.14 has crumb/429 issues, so we use direct API calls.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

let _crumb = null;
let _cookie = null;

// Get a crumb+cookie pair from Yahoo
const initCrumb = async () => {
  if (_crumb && _cookie) return;

  try {
    // Step 1: Get consent cookie
    const consentRes = await fetch('https://fc.yahoo.com', {
      headers: { 'User-Agent': UA },
      redirect: 'manual'
    });
    const setCookies = consentRes.headers.getSetCookie ? consentRes.headers.getSetCookie() : [];
    let cookieStr = setCookies.map((c) => c.split(';')[0]).join('; ');

    // Step 2: Get crumb
    const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: {
        'User-Agent': UA,
        'Cookie': cookieStr
      }
    });

    if (crumbRes.ok) {
      _crumb = await crumbRes.text();
      _cookie = cookieStr;
    }
  } catch (err) {
    console.log('Yahoo crumb init failed:', err.message);
  }
};

// Batch quote: fetch quote data for multiple symbols
const quote = async (symbols) => {
  const symArr = Array.isArray(symbols) ? symbols : [symbols];
  if (!symArr.length) return [];

  await initCrumb();

  const symStr = symArr.join(',');
  const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symStr)}&crumb=${encodeURIComponent(_crumb || '')}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Cookie': _cookie || ''
    }
  });

  if (!res.ok) {
    // Reset crumb on auth failure
    if (res.status === 401 || res.status === 403) {
      _crumb = null;
      _cookie = null;
    }
    throw new Error(`Yahoo quote failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const results = data && data.quoteResponse && data.quoteResponse.result
    ? data.quoteResponse.result
    : [];

  if (Array.isArray(symbols)) return results;
  return results[0] || null;
};

// Quote summary for a single symbol (analyst data, etc.)
const quoteSummary = async (symbol, opts) => {
  await initCrumb();

  const modules = (opts && opts.modules) ? opts.modules.join(',') : 'financialData';
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&crumb=${encodeURIComponent(_crumb || '')}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Cookie': _cookie || ''
    }
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      _crumb = null;
      _cookie = null;
    }
    throw new Error(`Yahoo quoteSummary failed: ${res.status}`);
  }

  const data = await res.json();
  const results = data && data.quoteSummary && data.quoteSummary.result;
  return (results && results[0]) || {};
};

// Fetch insights for a symbol (sigDevs, recommendation, etc.)
const insights = async (symbol) => {
  await initCrumb();

  const url = `https://query2.finance.yahoo.com/ws/insights/v3/finance/insights?symbol=${encodeURIComponent(symbol)}&lang=en-US&reportsCount=0&crumb=${encodeURIComponent(_crumb || '')}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Cookie': _cookie || ''
    }
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      _crumb = null;
      _cookie = null;
    }
    throw new Error(`Yahoo insights failed: ${res.status}`);
  }

  const data = await res.json();
  return (data && data.finance && data.finance.result) || {};
};

// Search for a symbol
const search = async (query) => {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=5&newsCount=0`;

  const res = await fetch(url, {
    headers: { 'User-Agent': UA }
  });

  if (!res.ok) {
    throw new Error(`Yahoo search failed: ${res.status}`);
  }

  return res.json();
};

exports.quote = quote;
exports.quoteSummary = quoteSummary;
exports.insights = insights;
exports.search = search;
