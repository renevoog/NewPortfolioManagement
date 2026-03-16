const passport = require('passport');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const connectionToTheDatabase = require('../database/database');
const { getStockRows } = require('../services/stockAggregator');
const { getTrackedSymbols, initializeTrackedAssets, addSymbol, removeSymbol } = require('../services/trackedAssetsService');
const { getFinancialHistory } = require('../services/yahoo/yahooFinancialService');

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
    res.render('home', {
      userName: req.user ? req.user.name : null,
      pageTitle: 'Dashboard'
    });
  } catch (err) {
    return next(err);
  }
};

// GET /api/dashboard-data — returns JSON rows (called by client JS)
exports.new_dashboardDataController_GET = async(req, res, next) => {
  try {
    const userId = req.session.passport.user;

    await initializeTrackedAssets(userId);
    const trackedSymbols = await getTrackedSymbols(userId);
    const rows = await getStockRows(trackedSymbols);

    const { formatEstoniaTime } = require('../services/formatters');
    res.json({ rows: rows, refreshTime: formatEstoniaTime(new Date()) });
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

    // If called via fetch (no redirect expected), return JSON
    if (req.headers['x-requested-with'] === 'fetch') {
      return res.json({ success: true });
    }
    res.redirect('/home');
  } catch (err) {
    console.log('Delete symbol error:', err.message);
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

// GET /api/assets/:symbol/financial-history — lazy-loaded financial detail
exports.new_financialHistoryController_GET = async(req, res, next) => {
  try {
    const symbol = req.params.symbol;
    if (!symbol || !symbol.trim()) {
      return res.status(400).json({ error: 'Symbol is required.' });
    }

    const data = await getFinancialHistory(symbol.trim());
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
