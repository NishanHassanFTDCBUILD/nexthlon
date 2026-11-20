// Continue with Google (see services/googleSignInService.js and controllers/socialSignInController.js).
const {socialSignIn} = require('./socialSignInController');

module.exports = socialSignIn(
  'google',
  require('../services/googleSignInService'),
);
