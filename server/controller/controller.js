const passport = require('passport');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const connectionToTheDatabase = require('../database/database');
const { getStockRows } = require('../services/stockAggregator');
const { getTrackedSymbols, initializeTrackedAssets, addSymbol } = require('../services/trackedAssetsService');

//Load userModel
const { userModel } = require('../model/models');

exports.new_loginController_GET = async(req, res, next) => {
  try {
    res.render('login');
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
    res.render('register');
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
      email: email
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
            password2: password2
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

exports.new_homeController_GET = async(req, res, next) => {
  try {
    const userId = req.session.passport.user;

    // Initialize tracked assets for this user (seeds initial list on first visit)
    await initializeTrackedAssets(userId);

    // Get the user's tracked symbols
    const trackedSymbols = await getTrackedSymbols(userId);

    // Fetch all stock data
    const rows = await getStockRows(trackedSymbols);

    res.render('home', {
      rows: rows,
      error: null
    });
  } catch (err) {
    console.log('Dashboard error:', err.message);
    res.render('home', {
      rows: [],
      error: 'Failed to load dashboard data. Please refresh.'
    });
  }
};

// POST: Add a new symbol
exports.new_addSymbolController_POST = async(req, res, next) => {
  try {
    const userId = req.session.passport.user;
    const { symbol } = req.body;

    const result = await addSymbol(userId, symbol);

    if (!result.success) {
      // Re-render dashboard with error
      const trackedSymbols = await getTrackedSymbols(userId);
      const rows = await getStockRows(trackedSymbols);

      return res.render('home', {
        rows: rows,
        error: result.error
      });
    }

    res.redirect('/home');
  } catch (err) {
    console.log('Add symbol error:', err.message);
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
