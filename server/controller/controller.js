const passport = require('passport');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const connectionToTheDatabase = require('../database/database');
const { getStockRows } = require('../services/stockAggregator');
const { getTrackedSymbols, getTrackedSymbolMap, initializeTrackedAssets, addSymbol, removeSymbol, shareWatchlist, isAdmin } = require('../services/trackedAssetsService');
const { getFinancialHistory } = require('../services/yahoo/yahooFinancialService');
const { getColumnPreferences, saveColumnPreferences } = require('../services/userPreferencesService');
const { getYahooSymbol } = require('../services/symbolMap');
const { batchQuotes } = require('../services/yahoo/yahooStockService');
const { fetchSharpeHistory } = require('../services/sharpe/sharpeHistoryService');
const { sharpeRatioSimulation } = require('../services/sharpe/sharpeCalculation');

// Resolve tvSymbol -> company name for the Sharpe asset picker. Sources, cheapest
// first: (1) the dashboard's session cache (already has names), (2) a persisted
// per-session name cache, (3) a single batch Yahoo quote for anything still
// unknown. Always best-effort — falls back to the ticker in the view.
async function resolveWatchlistNames(req, watchlist) {
  const tvToName = {};

  const dash = req.session.dashboardCache;
  if (dash && Array.isArray(dash.rows)) {
    dash.rows.forEach((r) => {
      if (r && r.symbol && r.companyName && r.companyName !== '-') {
        tvToName[r.symbol] = r.companyName;
      }
    });
  }

  if (!req.session.sharpeNameCache) req.session.sharpeNameCache = {};
  const nameCache = req.session.sharpeNameCache;
  watchlist.forEach((a) => {
    if (!tvToName[a.tv] && nameCache[a.yahoo]) tvToName[a.tv] = nameCache[a.yahoo];
  });

  const unknown = watchlist.filter((a) => !tvToName[a.tv]);
  if (unknown.length) {
    try {
      const yahooSyms = [...new Set(unknown.map((a) => a.yahoo))];
      const quotes = await batchQuotes(yahooSyms);
      unknown.forEach((a) => {
        const q = quotes[a.yahoo];
        const name = q && (q.longName || q.shortName);
        if (name) {
          tvToName[a.tv] = name;
          nameCache[a.yahoo] = name;
        }
      });
    } catch (err) {
      // Names are optional — the picker falls back to the ticker.
    }
  }

  return tvToName;
}

//Load userModel
const { userModel } = require('../model/models');

exports.new_loginController_GET = async(req, res, next) => {
  try {
    res.render('login', { userName: null, pageTitle: 'Login' });
  } catch (err) {
    return next(err);
  }
};

exports.new_loginController_POST = async(req, res, next) => {
  try {
    passport.authenticate('local', {
      successRedirect: '/home',
      failureRedirect: '/login',
      failureFlash: true
    })(req, res, next);
  } catch (err) {
    return next(err);
  }
};

exports.new_logoutController_GET = async(req, res) => {
  try {
    res.clearCookie('connect.sid');
    req.session.destroy((err) => {
      if (err) {
        throw err;
      }
      res.redirect('/login');
    });
  } catch (err) {
    res.redirect('/home');
  }
};

exports.new_registrationController_GET = async(req, res, next) => {
  try {
    res.render('register', { userName: null, pageTitle: 'Register' });
  } catch (err) {
    return next(err);
  }
};

exports.new_registrationController_POST = async(req, res, next) => {
  const { name, email, password, password2 } = req.body;
  let errors = [];

  if (!name || !email || !password || !password2) {
    errors.push({ msg: 'Please fill all fields!' });
  }

  if (password !== password2) {
    errors.push({ msg: 'Passwords do not match' });
  }

  if (password.length < 6) {
    errors.push({ msg: 'Password length must be at least 6 characters' });
  }

  if (errors.length > 0) {
    res.render('register', {
      errors: errors,
      name: name,
      email: email,
      userName: null,
      pageTitle: 'Register'
    });
  } else {
    userModel.findOne({ email: email })
      .then((user) => {
        if (user) {
          errors.push({ msg: 'Email is already registered' });
          res.render('register', {
            errors: errors,
            name: name,
            email: email,
            password: password,
            password2: password2,
            userName: null,
            pageTitle: 'Register'
          });
        } else {
          const newUser = new userModel({
            name: name,
            email: email,
            password: password
          });

          //Hash password
          bcrypt.genSalt(12, (err, salt) => {
            bcrypt.hash(newUser.password, salt, (err, hash) => {
              if (err) {
                throw err;
              }

              //set password to hashed password
              newUser.password = hash;

              newUser.save()
                .then((user) => {
                  req.flash('success_msg', 'You are now registered and can log in');
                  res.redirect('/login');
                })
                .catch((err) => {
                  return next(err);
                });
            });
          });
        }
      });
  }
};

// GET /home — renders the shell instantly (spinner visible), data loaded via AJAX
exports.new_homeController_GET = async(req, res, next) => {
  try {
    const userId = req.session.passport.user;
    const admin = await isAdmin(userId);
    const savedColumns = await getColumnPreferences(userId);
    res.render('home', {
      userName: req.user ? req.user.name : null,
      pageTitle: 'Dashboard',
      isAdmin: admin,
      savedColumns: savedColumns,
      activeTab: 'dashboard'
    });
  } catch (err) {
    return next(err);
  }
};

// Session-based dashboard cache (avoids re-fetching on every page load within same session)
const DASHBOARD_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

// GET /api/dashboard-data — returns JSON rows (called by client JS)
exports.new_dashboardDataController_GET = async(req, res, next) => {
  try {
    const userId = req.session.passport.user;

    await initializeTrackedAssets(userId);
    const trackedSymbols = await getTrackedSymbols(userId);
    const dbSymbolMap = await getTrackedSymbolMap(userId);

    // Check session cache
    const sessionCache = req.session.dashboardCache;
    const now = Date.now();
    if (sessionCache && sessionCache.ts && (now - sessionCache.ts) < DASHBOARD_CACHE_TTL) {
      const cachedSymbols = sessionCache.symbols || [];
      if (JSON.stringify(cachedSymbols) === JSON.stringify(trackedSymbols)) {
        return res.json({ rows: sessionCache.rows, refreshTime: sessionCache.refreshTime, cached: true });
      }
    }

    const rows = await getStockRows(trackedSymbols, dbSymbolMap);

    const { formatEstoniaTime } = require('../services/formatters');
    const refreshTime = formatEstoniaTime(new Date());

    // Store in session
    req.session.dashboardCache = {
      rows: rows,
      refreshTime: refreshTime,
      symbols: trackedSymbols,
      ts: now
    };

    res.json({ rows: rows, refreshTime: refreshTime });
  } catch (err) {
    console.log('Dashboard data error:', err.message);
    res.json({ rows: [], error: 'Failed to load dashboard data.', refreshTime: null });
  }
};

// POST: Add a new symbol (returns JSON for fetch, or redirects for form submit)
exports.new_addSymbolController_POST = async(req, res, next) => {
  try {
    const userId = req.session.passport.user;
    const { symbol } = req.body;

    const result = await addSymbol(userId, symbol);

    // Invalidate session cache
    if (result.success) delete req.session.dashboardCache;

    if (req.headers['x-requested-with'] === 'fetch') {
      return res.json(result);
    }

    // Fallback: form submit — redirect with error in query if failed
    if (!result.success) {
      return res.redirect('/home?error=' + encodeURIComponent(result.error));
    }
    res.redirect('/home');
  } catch (err) {
    console.log('Add symbol error:', err.message);
    return next(err);
  }
};

// POST: Delete a symbol (supports both fetch and form submit)
exports.new_deleteSymbolController_POST = async(req, res, next) => {
  try {
    const userId = req.session.passport.user;
    const { symbol } = req.body;
    await removeSymbol(userId, symbol);

    // Invalidate session cache
    delete req.session.dashboardCache;

    // If called via fetch (no redirect expected), return JSON
    if (req.headers['x-requested-with'] === 'fetch') {
      return res.json({ success: true });
    }
    res.redirect('/home');
  } catch (err) {
    console.log('Delete symbol error:', err.message);
    if (req.headers['x-requested-with'] === 'fetch') {
      return res.json({ success: false, error: 'Failed to delete symbol.' });
    }
    return next(err);
  }
};

// API: Debug route - returns full JSON rows
exports.new_debugStocksController_GET = async(req, res, next) => {
  try {
    const userId = req.session.passport.user;
    await initializeTrackedAssets(userId);
    const trackedSymbols = await getTrackedSymbols(userId);
    const rows = await getStockRows(trackedSymbols);
    res.json({ count: rows.length, rows: rows });
  } catch (err) {
    console.log('Debug error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

// Session cache TTL for financial detail
const DETAIL_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// GET /api/assets/:symbol/financial-history — lazy-loaded financial detail
exports.new_financialHistoryController_GET = async(req, res, next) => {
  try {
    const symbol = req.params.symbol;
    if (!symbol || !symbol.trim()) {
      return res.status(400).json({ error: 'Symbol is required.' });
    }

    const sym = symbol.trim();

    // Check session cache
    if (!req.session.detailCache) req.session.detailCache = {};
    const cached = req.session.detailCache[sym];
    if (cached && cached.ts && (Date.now() - cached.ts) < DETAIL_CACHE_TTL) {
      return res.json(cached.data);
    }

    const data = await getFinancialHistory(sym);

    // Store in session
    req.session.detailCache[sym] = { data: data, ts: Date.now() };

    res.json(data);
  } catch (err) {
    console.log('Financial history error for', req.params.symbol + ':', err.message);

    // 404 typically means ETF/index/fund — no income statements available
    const is404 = err.message && err.message.indexOf('404') !== -1;
    const msg = is404
      ? 'No financial history available for this asset.'
      : 'Failed to load financial history.';

    res.status(is404 ? 200 : 500).json({
      symbol: req.params.symbol,
      source: 'yahoo',
      availability: { quarterly: false, yearly: false },
      quarterly: { periods: [] },
      yearly: { periods: [] },
      analystSummary: { available: false },
      error: msg
    });
  }
};

// POST /api/share-watchlist — admin shares watchlist to another user
exports.new_shareWatchlistController_POST = async(req, res, next) => {
  try {
    const userId = req.session.passport.user;
    const { email } = req.body;

    if (!email || !email.trim()) {
      return res.json({ success: false, error: 'Email is required.' });
    }

    const result = await shareWatchlist(userId, email.trim());
    return res.json(result);
  } catch (err) {
    console.log('Share watchlist error:', err.message);
    return res.json({ success: false, error: 'Failed to share watchlist.' });
  }
};

// POST /api/column-preferences — persist the user's visible/hidden columns
exports.new_saveColumnPreferencesController_POST = async(req, res, next) => {
  try {
    const userId = req.session.passport.user;
    const hidden = req.body && req.body.hidden;
    const saved = await saveColumnPreferences(userId, hidden);
    return res.json({ success: true, hidden: saved });
  } catch (err) {
    console.log('Save column preferences error:', err.message);
    return res.json({ success: false, error: 'Failed to save column preferences.' });
  }
};

// GET /sharpe — renders the Sharpe-ratio simulation page. The user's tracked
// symbols (with their Yahoo mappings) are passed so the view can render the
// watchlist selector server-side.
exports.new_sharpeViewController_GET = async(req, res, next) => {
  try {
    const userId = req.session.passport.user;
    const admin = await isAdmin(userId);

    await initializeTrackedAssets(userId);
    const trackedSymbols = await getTrackedSymbols(userId);
    const dbSymbolMap = await getTrackedSymbolMap(userId);

    // { tv, yahoo } for each tracked asset — yahoo falls back to the static
    // map, then to the symbol itself so nothing is ever unselectable.
    const watchlist = trackedSymbols.map((tv) => ({
      tv: tv,
      yahoo: dbSymbolMap[tv] || getYahooSymbol(tv) || tv
    }));

    // Attach human-readable company names for the picker (best-effort).
    const nameMap = await resolveWatchlistNames(req, watchlist);
    watchlist.forEach((a) => { a.name = nameMap[a.tv] || a.tv; });

    res.render('sharpe', {
      userName: req.user ? req.user.name : null,
      pageTitle: 'Sharpe Ratio',
      isAdmin: admin,
      watchlist: watchlist,
      activeTab: 'sharpe'
    });
  } catch (err) {
    return next(err);
  }
};

// GET /api/sharpe-data — runs the Monte Carlo simulation and returns the
// scatter data (or an errorResponse the client renders in the idle panel).
exports.new_sharpeGraphController_GET = async(req, res, next) => {
  try {
    const assetType = req.query.assetType === 'crypto' ? 'crypto' : 'stocks';
    const numberOfIterations = parseInt(req.query.iterations, 10);
    const startMs = parseInt(req.query.start, 10);
    const endMs = parseInt(req.query.end, 10);

    const yahooAssets = String(req.query.assets || '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    const labels = String(req.query.labels || '')
      .split(',').map((s) => s.trim()).filter(Boolean);

    // Server-side validation (the client validates too, but never trust it).
    // Upper bounds are load-bearing: the simulation is a synchronous O(iterations ·
    // assets²) loop on the single Node thread, and each asset is a sequential Yahoo
    // fetch — leaving them unbounded lets one request hang the whole app.
    const MAX_ASSETS = 30;
    const MAX_ITERATIONS = 100000;

    if (yahooAssets.length < 2) {
      return res.json({ errorResponse: ['Select at least two assets for the simulation.'] });
    }
    if (yahooAssets.length > MAX_ASSETS) {
      return res.json({ errorResponse: [`Too many assets — pick at most ${MAX_ASSETS}.`] });
    }
    if (!numberOfIterations || numberOfIterations < 500) {
      return res.json({ errorResponse: ['Iterations must be at least 500.'] });
    }
    if (numberOfIterations > MAX_ITERATIONS) {
      return res.json({ errorResponse: [`Iterations must be at most ${MAX_ITERATIONS}.`] });
    }
    if (!startMs || !endMs || isNaN(startMs) || isNaN(endMs) || endMs <= startMs) {
      return res.json({ errorResponse: ['Start and end dates are invalid.'] });
    }

    const marketDays = assetType === 'crypto' ? 365 : 252;

    const history = await fetchSharpeHistory(yahooAssets, labels, startMs, endMs, assetType);

    if (history.errorList && history.errorList.length > 0) {
      return res.json({ errorResponse: history.errorList });
    }

    const simulation = sharpeRatioSimulation(
      numberOfIterations,
      marketDays,
      history.listOfAssets,
      history.outputListForRawDataArray
    );

    if (simulation === 0) {
      return res.json({ errorResponse: ['Data integrity check failed — the price series could not be aligned.'] });
    }

    res.json({
      data1: simulation.data1,
      data3: simulation.data3,
      sharpeList: simulation.sharpeList,
      importedHeaderValuesList: simulation.importedHeaderValuesList,
      colorList: simulation.colorList,
      errorResponse: []
    });
  } catch (err) {
    console.log('Sharpe simulation error:', err.message);
    return res.json({ errorResponse: ['The simulation request failed. Check the parameters and try again.'] });
  }
};

exports.new_dbHealthController_GET = async(req, res, next) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      const dbConnection = await connectionToTheDatabase();
      if (!dbConnection) {
        return res.status(503).send({ db: 'fail' });
      }
    }

    return res.status(200).send({ db: 'ok' });
  } catch (err) {
    return next(err);
  }
};
