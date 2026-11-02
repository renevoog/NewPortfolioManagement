const { getAssets, addAsset, removeAsset } = require('../services/watchlistService');
const { getWatchlistRows } = require('../services/yahoo/watchlistQuoteService');
const { formatEstoniaTime } = require('../services/formatters');

exports.view = (req, res) => res.render('watchlist', {
  userName: req.user.name,
  pageTitle: 'Watchlist',
  activeTab: 'watchlist'
});

exports.list = async (req, res) => {
  try {
    const assets = await getAssets(req.session.passport.user);
    const rows = await getWatchlistRows(assets);
    res.set('Cache-Control', 'no-store');
    res.json({ rows, refreshTime: formatEstoniaTime(new Date()) });
  } catch (err) {
    res.status(500).json({ error: 'Could not load your watchlist. Please try again.' });
  }
};

exports.add = async (req, res) => {
  try {
    const result = await addAsset(req.session.passport.user, req.body.symbol);
    res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: 'Could not save this favourite. Please try again.' });
  }
};

exports.remove = async (req, res) => {
  try {
    const result = await removeAsset(req.session.passport.user, req.params.symbol);
    res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: 'Could not remove this favourite. Please try again.' });
  }
};
