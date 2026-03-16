const mongoose = require('mongoose');

const sanitizeMongoMessage = function(message) {
  if (!message) {
    return 'Unknown MongoDB error';
  }

  return message.replace(/mongodb(\+srv)?:\/\/[^@]+@/gi, 'mongodb$1://<credentials>@');
};

const connectionToTheDatabase = async function(req, res, next) {
  try {
    const databaseConnection = await mongoose.connect(process.env.DATABASE_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('MongoDB connected');
    return databaseConnection;
  } catch (err) {
    const sanitizedError = {
      name: err.name,
      code: typeof err.code === 'undefined' ? null : err.code,
      message: sanitizeMongoMessage(err.message)
    };

    console.log('MongoDB connection failed');
    console.log(sanitizedError);
    return null;
  }
};

module.exports = connectionToTheDatabase;
