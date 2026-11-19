// Storefront strings in English and Hindi. A missing Hindi string falls back to English, so a page is never blank.
// The language is kept in the nx_lang cookie (set by /lang/en or /lang/hi). Admin pages stay in English.
const STRINGS = {
  en: {
    search_placeholder: 'Search for shoes, footballs, tents and more',
    account: 'Account & Orders',
    wishlist: 'Wishlist',
    cart: 'Cart',
    sign_in: 'Sign in',
    shop: 'Shop',
    help: 'Help',
    company: 'Company',
    compare: 'Compare',
    track_order: 'Track an order',
    find_size: 'Find my shoe size',
    add_to_cart: 'Add to cart',
    switch_language: 'हिन्दी',
  },
  hi: {
    search_placeholder: 'जूते, फ़ुटबॉल, टेंट और बहुत कुछ खोजें',
    account: 'खाता और ऑर्डर',
    wishlist: 'विशलिस्ट',
    cart: 'कार्ट',
    sign_in: 'साइन इन करें',
    shop: 'खरीदारी',
    help: 'सहायता',
    company: 'कंपनी',
    compare: 'तुलना करें',
    track_order: 'ऑर्डर ट्रैक करें',
    find_size: 'मेरा जूता साइज़ जानें',
    add_to_cart: 'कार्ट में डालें',
    switch_language: 'English',
  },
};

const LANGS = ['en', 'hi'];

function langFrom(value) {
  return LANGS.includes(value) ? value : 'en';
}

function translator(lang) {
  const table = STRINGS[langFrom(lang)];
  return (key) => table[key] || STRINGS.en[key] || key;
}

module.exports = {STRINGS, LANGS, langFrom, translator};
