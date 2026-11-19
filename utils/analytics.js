// Visitor analytics (D2). Optional, and off unless the store owner sets it up:
//   ANALYTICS_PROVIDER=ga4        ANALYTICS_ID=G-XXXXXXXXXX
//   ANALYTICS_PROVIDER=plausible  ANALYTICS_ID=nexthlon.in   (PLAUSIBLE_HOST for a self-hosted copy)
// Even when set up, nothing is loaded until the visitor says yes in the cookie banner
// (public/js/consent.js). The Content Security Policy only lets in the hosts the chosen provider needs.

const PROVIDERS = ['ga4', 'plausible'];
const GA4_ID = /^G-[A-Z0-9]{4,20}$/;
const DOMAIN = /^(?=.{3,253}$)([a-z0-9-]+\.)*[a-z0-9-]+$/i;

function readAnalytics(env = process.env) {
  const text = (name) => String(env[name] ?? '').trim();
  const provider = text('ANALYTICS_PROVIDER').toLowerCase();
  const id = text('ANALYTICS_ID');
  let host =
    text('PLAUSIBLE_HOST').replace(/\/+$/, '') || 'https://plausible.io';
  try {
    host = new URL(host).origin;
  } catch {
    host = 'https://plausible.io';
  }
  const valid =
    (provider === 'ga4' && GA4_ID.test(id)) ||
    (provider === 'plausible' && DOMAIN.test(id));
  return {
    enabled: valid,
    provider: valid ? provider : '',
    id: valid ? id : '',
    host: provider === 'plausible' ? host : '',
  };
}

// Problems for config/schema.js: wrong values stop the server from starting rather than failing silently.
function analyticsProblems(env = process.env) {
  const text = (name) => String(env[name] ?? '').trim();
  const provider = text('ANALYTICS_PROVIDER').toLowerCase();
  const id = text('ANALYTICS_ID');
  if (!provider) return [];
  if (!PROVIDERS.includes(provider))
    return [
      [
        'ANALYTICS_PROVIDER',
        `"${provider}" must be ga4 or plausible (or leave it empty for no analytics).`,
      ],
    ];
  if (!id)
    return [
      ['ANALYTICS_ID', `is needed when ANALYTICS_PROVIDER is ${provider}.`],
    ];
  if (provider === 'ga4' && !GA4_ID.test(id))
    return [
      [
        'ANALYTICS_ID',
        'is not a GA4 measurement ID. It looks like G-XXXXXXXXXX.',
      ],
    ];
  if (provider === 'plausible' && !DOMAIN.test(id))
    return [
      [
        'ANALYTICS_ID',
        "should be the site's domain as added in Plausible, e.g. nexthlon.in.",
      ],
    ];
  return [];
}

// Extra Content Security Policy hosts for the chosen provider (none when analytics is off).
function cspHosts(analytics) {
  if (!analytics || !analytics.enabled)
    return {script: [], connect: [], img: []};
  if (analytics.provider === 'ga4') {
    return {
      script: ['https://www.googletagmanager.com'],
      connect: [
        'https://*.google-analytics.com',
        'https://*.analytics.google.com',
        'https://www.googletagmanager.com',
      ],
      img: [
        'https://*.google-analytics.com',
        'https://www.googletagmanager.com',
      ],
    };
  }
  return {script: [analytics.host], connect: [analytics.host], img: []};
}

module.exports = {readAnalytics, analyticsProblems, cspHosts, PROVIDERS};

// Meta (Facebook) Pixel (E4-era roadmap item): only a numeric pixel id, and only loaded after consent.
function readMetaPixel(env = process.env) {
  const id = String(env.META_PIXEL_ID ?? '').trim();
  return {
    enabled: /^[0-9]{8,20}$/.test(id),
    id: /^[0-9]{8,20}$/.test(id) ? id : '',
  };
}
module.exports.readMetaPixel = readMetaPixel;
module.exports.metaHosts = (pixel) =>
  pixel && pixel.enabled
    ? {
        script: ['https://connect.facebook.net'],
        connect: ['https://www.facebook.com'],
        img: ['https://www.facebook.com'],
      }
    : {script: [], connect: [], img: []};
