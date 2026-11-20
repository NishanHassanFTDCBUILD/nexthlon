// Continue with Facebook (see services/facebookSignInService.js and controllers/socialSignInController.js).
const {socialSignIn} = require('./socialSignInController');

module.exports = socialSignIn(
  'facebook',
  require('../services/facebookSignInService'),
);
