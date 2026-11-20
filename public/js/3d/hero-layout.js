// CSS-pixel layout keeps every morph target clear of the copy and header.
const bounds = {dumbbell: [4.1, 2.7], logo: [4.9, 1.31], athlete: [4.2, 3.36]};
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * clamp(t, 0, 1);

export function heroQuality(width, height, tier = 'medium') {
  const phone = width <= 720;
  // Phones get almost the laptop's particle count (points are cheap for any phone GPU), so the logo
  // letters read as solid lines of light instead of a gappy speckle. Weak devices stay on 2400.
  const capacity =
    phone && tier !== 'low'
      ? 8000
      : {high: 9000, medium: 5000, low: 2400}[tier] || 5000;
  return {
    capacity,
    count: capacity,
    // Laptops keep the original 26-unit point size at the 7-unit camera; phones get dots big
    // enough to read the logo and runner on a small screen.
    dotPixels: phone ? clamp(1.8 + width * 0.0008, 2.0, 3.0) : 26 / 7,
    // Phones render at up to 2.25x pixels so the dots stay sharp on high-density screens.
    ratio: tier === 'low' ? 1.25 : phone ? 2.25 : 2,
    // Phones: a tighter, brighter dot (bigger sharp core, less soft halo).
    crisp: phone ? 1 : 0,
  };
}

// More breathing room for each complete shape on phones and portrait tablets.
// Desktop timing is unchanged; scrolling remains entirely under user control.
export function heroMorph(progress, compact = false) {
  const start = compact ? 0.1 : 0.08;
  const logoAt = compact ? 0.34 : 0.3;
  const logoUntil = compact ? 0.55 : 0.48;
  const athleteAt = compact ? 0.76 : 0.7;
  if (progress < start) return 0;
  if (progress < logoAt) return (progress - start) / (logoAt - start);
  if (progress < logoUntil) return 1;
  if (progress < athleteAt)
    return 1 + (progress - logoUntil) / (athleteAt - logoUntil);
  return 2;
}

export function heroLayout({
  width,
  height,
  contentTop,
  textRight,
  headerHeight,
  morph = 0,
}) {
  const gutter = clamp(width * 0.035, 16, 48);
  const split = width >= 1000 || (width >= 560 && height < 600);
  const top = Math.max(16, headerHeight + 20);
  const rect = split
    ? {
        left: Math.max(textRight + 28, width * 0.47),
        right: width - gutter,
        top,
        bottom: height - 72,
      }
    : {
        left: gutter,
        right: width - gutter,
        top,
        bottom: Math.max(top + 48, contentTop - 24),
      };
  const distance = 7;
  const unitsPerPixel = (2 * distance * Math.tan(Math.PI / 8)) / height;
  // Laptops and phones: the logo and the runner fill more of their space than the dumbbell does.
  const fill =
    width >= 1000
      ? lerp(0.83, 0.93, morph)
      : width <= 720
        ? lerp(0.83, 0.96, morph)
        : 0.83;
  const fit = ([w, h]) =>
    Math.max(
      0.01,
      Math.min(
        ((rect.right - rect.left) * fill * unitsPerPixel) / w,
        ((rect.bottom - rect.top) * fill * unitsPerPixel) / h,
        1.4,
      ),
    );
  const from = morph <= 1 ? bounds.dumbbell : bounds.logo;
  const to = morph <= 1 ? bounds.logo : bounds.athlete;
  const blend = morph <= 1 ? morph : morph - 1;
  const scale = fit(from.map((value, axis) => lerp(value, to[axis], blend)));
  return {
    rect,
    scale,
    distance,
    x: ((rect.left + rect.right) / 2 - width / 2) * unitsPerPixel,
    y: 0.35 + (height / 2 - (rect.top + rect.bottom) / 2) * unitsPerPixel,
  };
}
