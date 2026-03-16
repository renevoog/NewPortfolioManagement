const express = require('express');
const app = express();
const router = express.Router();
const controller = require('../controller/controller');
const { ensureAuthenticated } = require('../../config/auth');

router.get('/', controller.new_loginController_GET);
router.get('/login', controller.new_loginController_GET);
router.post('/login', controller.new_loginController_POST);

router.get('/logout', ensureAuthenticated, controller.new_logoutController_GET);

router.get('/register', controller.new_registrationController_GET);
router.post('/register', controller.new_registrationController_POST);

router.get('/home', ensureAuthenticated, controller.new_homeController_GET);
router.post('/add-symbol', ensureAuthenticated, controller.new_addSymbolController_POST);
router.get('/debug/stocks', ensureAuthenticated, controller.new_debugStocksController_GET);

router.get('/health/db', controller.new_dbHealthController_GET);

module.exports = router;
