// Photos on this server's own disk: public/uploads/<key>, served by Express as /uploads/<key>.
// Good for development. In production a container's disk is wiped on every deploy unless a volume is
// mounted, so use Cloudinary there.
const fs = require('fs/promises');
const path = require('path');

const PREFIX = '/uploads/';
const DEFAULT_ROOT = path.join(__dirname, '..', '..', 'public', 'uploads');

function createLocalStorage({root = DEFAULT_ROOT} = {}) {
  // A key is a short path such as "products/<id>-400.webp". Never let one leave the uploads folder.
  const resolve = (key) => {
    const file = path.resolve(root, key);
    if (!file.startsWith(path.resolve(root) + path.sep))
      throw new Error(`Unsafe storage key: ${key}`);
    return file;
  };

  return {
    driver: 'local',
    root,

    async put(key, buffer) {
      const file = resolve(key);
      await fs.mkdir(path.dirname(file), {recursive: true});
      // "wx": random names never collide, so refusing to overwrite catches a bug instead of hiding it.
      await fs.writeFile(file, buffer, {flag: 'wx'});
    },

    async read(key) {
      return fs.readFile(resolve(key));
    },

    // Missing files are fine: deleting twice, or deleting a photo that never had small copies, is normal.
    async remove(keys) {
      await Promise.all(
        keys.map((key) =>
          fs.unlink(resolve(key)).catch((error) => {
            if (error.code !== 'ENOENT') throw error;
          }),
        ),
      );
    },

    publicUrl: (key) => `${PREFIX}${key}`,

    // The key behind one of our URLs, or null when the URL is not ours.
    keyFromUrl(url) {
      return typeof url === 'string' && url.startsWith(PREFIX)
        ? url.slice(PREFIX.length)
        : null;
    },
  };
}

module.exports = {createLocalStorage};
