// A short, readable device name from a User-Agent header. Used by the sign-in history and by the
// "Logged-in devices" list, so both describe a device the same way. Nothing else from the header
// is kept: we store "Chrome on Windows", never the full string.
function browserName(userAgent = '') {
  const ua = String(userAgent);
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : /node|undici|curl|postman/i.test(ua)
              ? 'App or script'
              : 'Unknown browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} on ${os}` : browser;
}

module.exports = {browserName};
