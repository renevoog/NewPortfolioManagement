const { getRiskData } = require('../services/risk/riskService');
const { promisify } = require('node:util');
const gzip = promisify(require('node:zlib').gzip);

exports.view = (req, res) => res.render('risk', {
  userName: req.user.name,
  pageTitle: 'BTC ja ETH tururisk',
  activeTab: 'risk'
});

exports.data = async (req, res) => {
  const asset = req.query.asset === undefined ? 'BTC' : typeof req.query.asset === 'string' ? req.query.asset.toUpperCase() : null;
  res.set('Cache-Control', 'no-store');
  if (!['BTC', 'ETH'].includes(asset)) return res.status(400).json({ error: 'Vali BTC või ETH.' });
  try {
    const data = await getRiskData(asset);
    // Full historical components are useful for inspection but large on mobile.
    // Use Node's built-in compression rather than adding a middleware package.
    res.vary('Accept-Encoding');
    if (req.acceptsEncodings('gzip')) {
      const body = await gzip(JSON.stringify(data));
      res.set('Content-Encoding', 'gzip').type('application/json').send(body);
    } else res.json(data);
  } catch (error) {
    res.status(503).json({ error: 'Tururiski andmed ei ole praegu kättesaadavad. Proovi mõne hetke pärast uuesti.' });
  }
};
