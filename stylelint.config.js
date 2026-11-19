// Stylelint for Nexthlon: catches CSS mistakes the way ESLint does for JS
// (duplicate selectors, invalid properties or colours, empty rules).
// Formatting is Prettier's job, as for JS.
//
//   npm run lint:css        report problems
//   npm run lint:css:fix    fix what can be fixed safely

module.exports = {
  extends: ['stylelint-config-standard'],
  ignoreFiles: ['node_modules/**', 'public/uploads/**', 'coverage/**'],
  rules: {
    // Flags rule ORDER, not bugs. Reordering hundreds of rules to satisfy it
    // would change the cascade, so the visual result, for no gain.
    'no-descending-specificity': null,

    // Safari and iOS still need -webkit-backdrop-filter, -webkit-mask and
    // -webkit-text-size-adjust; removing them breaks the glass and mask effects.
    'property-no-vendor-prefix': null,

    // `width >= 600px` breaks every media query on iOS older than 16.4, so keep
    // the classic `min-width: 600px` form.
    'media-feature-range-notation': 'prefix',

    // Order status classes come straight from the data: .status-out_for_delivery.
    'selector-class-pattern': [
      '^[a-z][a-z0-9_-]*$',
      {message: 'Class names are lowercase, with - or _ between words'},
    ],

    // `clip` is part of the standard visually-hidden (screen-reader-only) pattern.
    'property-no-deprecated': [true, {ignoreProperties: ['clip']}],
  },
};
