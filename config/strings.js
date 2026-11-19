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
    free_delivery: 'Free delivery',
    out_of_stock: 'Out of stock',
    in_stock: 'In stock',
    only_left: 'Only {n} left',
    your_cart: 'Your cart',
    cart_empty: 'Your cart is empty',
    delivery_fee: 'Delivery fee',
    grand_total: 'Grand total',
    checkout: 'Proceed to checkout',
    continue_shopping: 'Continue shopping',
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
    free_delivery: 'मुफ़्त डिलीवरी',
    out_of_stock: 'स्टॉक खत्म',
    in_stock: 'स्टॉक में है',
    only_left: 'सिर्फ़ {n} बचे हैं',
    your_cart: 'आपका कार्ट',
    cart_empty: 'आपका कार्ट खाली है',
    delivery_fee: 'डिलीवरी शुल्क',
    grand_total: 'कुल योग',
    checkout: 'चेकआउट करें',
    continue_shopping: 'खरीदारी जारी रखें',
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
