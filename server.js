//Required values
const express = require('express');
const app = express();
const connectionToTheDatabase = require('./server/database/database');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const flash = require('connect-flash');
const session = require('express-session');
const passport = require('passport');
const MongoDBSession = require('connect-mongodb-session')(session);

//Passport config
require('./config/passport')(passport);

//Control if the environment is production or dev
if (process.env.NODE_ENV !== 'production') {
  const dotenv = require('dotenv');
  dotenv.config({ path: 'config.env' });
}

//Connection to the database
connectionToTheDatabase();

//make the server to use body-parser
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

//Sessionstore
const sessionStore = new MongoDBSession({
  uri: process.env.DATABASE_URI,
  collection: 'cryptoSessions'
});

//Set Cookie Parsers, Sessions
app.use(cookieParser(process.env.cookieParserKey));
app.use(session({
  secret: process.env.cookieParserKey,
  cookie: { maxAge: 1000 * 60 * 60 * 24 },
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  unset: 'destroy'
}));

//Passport middleware
app.use(passport.initialize());
app.use(passport.session());

//Connect flash
app.use(flash());
app.use((req, res, next) => {
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  res.locals.error = req.flash('error');
  next();
});

//Setting the view-engine as EJS
app.set('view engine', 'ejs');

//Using public files
app.use(express.static('public'));

//Router
const Router = require('./server/routes/router');
app.use('/', Router);

//Running of the server
var PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Connection successfully established http://localhost:${PORT}`);
});
