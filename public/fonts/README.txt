Barlow Condensed (600, 700, 800) and Inter (variable, 400-800), downloaded from Google Fonts
as woff2, "latin" and "latin-ext" subsets. Both are licensed under the SIL Open Font License 1.1
(https://openfontlicense.org), which allows using and redistributing them with a website.
The @font-face rules are at the top of public/css/tokens.css; head.ejs preloads three of them.

inter-400-800-rupee.woff2 (1.2 KB) is only the rupee sign (U+20B9), cut out of inter-400-800-latin-ext.woff2 with
fontTools (pyftsubset --unicodes=U+20B9 --flavor=woff2 --layout-features='*' --no-hinting). It stops every page with a
price from downloading the whole 84 KB latin-ext file for one character; tokens.css leaves U+20B9 out of latin-ext.
