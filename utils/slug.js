// "TrailFlex 2 — Running Shoes!" becomes "trailflex-2-running-shoes".
function slugify(value) {
  return (
    String(value || '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/g, '') || 'product'
  );
}

module.exports = {slugify};
