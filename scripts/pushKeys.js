// Prints a new pair of VAPID keys for push notifications (E5). Put them in your host's settings as
// VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, once. Changing them later makes every saved subscription stop working.
const webpush = require('web-push');
const {publicKey, privateKey} = webpush.generateVAPIDKeys();
console.log(
  `VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}\nVAPID_SUBJECT=mailto:support@your-domain.in`,
);
