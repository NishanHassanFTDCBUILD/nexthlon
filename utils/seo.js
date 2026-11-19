// Search engines and link previews (D1): absolute addresses, which pages stay out of Google, and the
// structured data (schema.org JSON-LD) that lets Google show price, stock and stars in results.
// Pure helpers; middleware/seo.js sets the per-request defaults and the pages add their own.
const config = require('../config/env');
const {STORE} = require('../config/store');

// The site's public address: SITE_URL when set (production), otherwise the address the request came to.
function siteOrigin(req) {
  if (config.siteUrl) return config.siteUrl;
  return req ? `${req.protocol}://${req.get('host')}` : '';
}

// "/products/x" -> "https://nexthlon.in/products/x". Full addresses (photos on Unsplash or a bucket) stay as they are.
function absoluteUrl(origin, url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
}

// Pages that belong to one person, or that only exist to get somewhere, are kept out of search results.
const PRIVATE_PAGES =
  /^\/(account|cart|checkout|orders|wallet|wishlist|profile|login|signup|forgot-password|reset-password|verify-email|lists)(\/|$)/;
function isPrivatePage(path) {
  return PRIVATE_PAGES.test(path);
}

// A product's stock as schema.org wants it.
const availabilityOf = (product) =>
  product.stock > 0
    ? 'https://schema.org/InStock'
    : 'https://schema.org/OutOfStock';
const rupees = (paise) => (paise / 100).toFixed(2);

// schema.org Product, with its offer, rating and the store's return policy.
function productData(product, {url, image, images = []}) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    image: [image, ...images]
      .filter(Boolean)
      .filter((value, index, all) => all.indexOf(value) === index)
      .slice(0, 6),
    description: (product.description || product.name).slice(0, 500),
    sku: String(product._id),
    brand: {'@type': 'Brand', name: product.brand || STORE.brandName},
    offers: {
      '@type': 'Offer',
      url,
      priceCurrency: 'INR',
      price: rupees(product.price),
      availability: availabilityOf(product),
      itemCondition: 'https://schema.org/NewCondition',
      seller: {'@type': 'Organization', name: STORE.brandName},
      shippingDetails: {
        '@type': 'OfferShippingDetails',
        shippingDestination: {'@type': 'DefinedRegion', addressCountry: 'IN'},
        shippingRate: {
          '@type': 'MonetaryAmount',
          currency: 'INR',
          value:
            product.price >= STORE.freeDeliveryMin
              ? '0'
              : rupees(STORE.deliveryFee),
        },
      },
      hasMerchantReturnPolicy: {
        '@type': 'MerchantReturnPolicy',
        applicableCountry: 'IN',
        returnPolicyCategory:
          'https://schema.org/MerchantReturnFiniteReturnWindow',
        merchantReturnDays: STORE.returnDays,
        returnMethod: 'https://schema.org/ReturnByMail',
        returnFees: 'https://schema.org/FreeReturn',
      },
    },
  };
  if (product.countryOfOrigin) data.countryOfOrigin = product.countryOfOrigin;
  if (product.ratingCount > 0) {
    data.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Number(product.ratingAverage || 0).toFixed(1),
      reviewCount: product.ratingCount,
      bestRating: '5',
      worstRating: '1',
    };
  }
  // Sizes and colours: Google reads them as the product's variants.
  const sizes = [
    ...new Set((product.variants || []).map((v) => v.size).filter(Boolean)),
  ];
  const colours = [
    ...new Set((product.variants || []).map((v) => v.colour).filter(Boolean)),
  ];
  if (sizes.length) data.size = sizes.join(', ');
  if (colours.length) data.color = colours.join(', ');
  return data;
}

// The "Home > Running > TrailFlex 2" trail under a result.
function breadcrumbData(origin, crumbs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(origin, crumb.url),
    })),
  };
}

// The store itself, and the search box Google may show under the home page result.
function storeData(origin) {
  const contact = /^\[/.test(STORE.supportEmail)
    ? null
    : {
        '@type': 'ContactPoint',
        contactType: 'customer service',
        email: STORE.supportEmail,
        telephone: STORE.supportPhone,
        areaServed: 'IN',
        availableLanguage: ['en', 'hi', 'ml'],
      };
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'OnlineStore',
      name: STORE.brandName,
      url: `${origin}/`,
      logo: `${origin}/img/og-default.png`,
      ...(/^\[/.test(STORE.legalName) ? {} : {legalName: STORE.legalName}),
      ...(contact ? {contactPoint: contact} : {}),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: STORE.brandName,
      url: `${origin}/`,
      potentialAction: {
        '@type': 'SearchAction',
        target: `${origin}/products?q={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
    },
  ];
}

// JSON for a <script type="application/ld+json"> block: "<" escaped so no text can close the tag.
const jsonLdText = (data) => JSON.stringify(data).replace(/</g, '\\u003c');

module.exports = {
  siteOrigin,
  absoluteUrl,
  isPrivatePage,
  productData,
  breadcrumbData,
  storeData,
  jsonLdText,
  availabilityOf,
};
