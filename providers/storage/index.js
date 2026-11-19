// Where uploaded photos live. Two places can hold them at once:
//   current()  the provider new uploads go to, chosen by STORAGE_DRIVER (local or cloudinary);
//   local()    this server's disk (public/uploads). It always exists, because photos uploaded before the
//              switch to cloud storage are still there, and deleting or migrating them must find them.
// A stored photo URL says which one holds it: "/uploads/..." is local, Cloudinary's URL is cloud.
const config = require('../../config/env');
const {createLocalStorage} = require('./local');
const {createCloudinaryStorage} = require('./cloudinary');

let localProvider = null;
let currentProvider = null;

function local() {
  if (!localProvider) localProvider = createLocalStorage();
  return localProvider;
}

function current() {
  if (!currentProvider) {
    const {driver} = config.storage;
    currentProvider =
      driver === 'cloudinary'
        ? createCloudinaryStorage(config.storage)
        : local();
  }
  return currentProvider;
}

// Every provider that can hold one of our photos, for working out which one a URL belongs to.
function backendFor(url) {
  const candidates = [current(), local()];
  return (
    candidates.find((provider) => provider.keyFromUrl(url) !== null) || null
  );
}

// Tests swap in temporary folders or a fake cloud provider, and call reset() afterwards.
function useForTests({local: l, current: c} = {}) {
  if (l) localProvider = l;
  currentProvider = c || l || currentProvider;
}
function reset() {
  localProvider = null;
  currentProvider = null;
}

module.exports = {local, current, backendFor, useForTests, reset};
