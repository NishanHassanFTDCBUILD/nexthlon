const productService = require("./productService");

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Deals of the day end at midnight in India (IST has no daylight saving, so a fixed offset is exact).
function dealEndsAt(now = new Date()) {
  const istNow = now.getTime() + IST_OFFSET_MS;
  const nextIstMidnight = Math.floor(istNow / DAY_MS) * DAY_MS + DAY_MS;
  return new Date(nextIstMidnight - IST_OFFSET_MS);
}

// Short lines for the hero carousel, by sport. Sports without a line get the general one.
const SPORT_LINES = {
  Running: { title: "Run further, recover faster", text: "Cushioned trainers, trail shoes and race-day kit." },
  Football: { title: "Own every match day", text: "Match balls, boots and training gear for the season." },
  Fitness: { title: "Train at home, train hard", text: "Dumbbells, mats and bands to build your routine." },
  Cricket: { title: "Built for the long innings", text: "Bats, balls and protective gear for every format." },
  Cycling: { title: "Ride every road", text: "Helmets, lights and kit for commutes and long rides." },
  Outdoor: { title: "Made for the outdoors", text: "Gear that handles weather, dust and distance." },
  Swimming: { title: "Make every lap count", text: "Goggles, caps and swimwear for pool and open water." },
  Tennis: { title: "Serve with confidence", text: "Rackets, balls and court shoes for every level." },
  Hiking: { title: "Find your next summit", text: "Packs, poles and boots for day hikes and treks." },
  Camping: { title: "Sleep under the stars", text: "Tents, sleeping bags and camp kitchen essentials." }
};
const GENERAL_LINE = { title: "Gear for your next move", text: "Performance sports gear, picked for athletes who use it." };

// Builds up to 4 slides from live data: the top deal first, then the sports with the most products.
function buildHeroSlides({ deals = [], categories = [] } = {}) {
  const slides = [];
  if (deals.length && deals[0].discountPercent > 0) {
    slides.push({
      kicker: "Deals of the day",
      title: `Up to ${deals[0].discountPercent}% off top gear`,
      text: "Fresh savings every day, while stock lasts. Prices end at midnight.",
      cta: "Shop today's deals",
      href: "/products?sort=discount",
      image: deals[0].image
    });
  }
  [...categories]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, 4 - slides.length)
    .forEach(category => {
      const line = SPORT_LINES[category.name] || GENERAL_LINE;
      slides.push({
        kicker: `${category.name} · from ₹${Number(category.fromPrice || 0).toLocaleString("en-IN")}`,
        title: line.title,
        text: line.text,
        cta: `Shop ${category.name}`,
        href: `/products?category=${encodeURIComponent(category.name)}`,
        image: category.image
      });
    });
  if (!slides.length) {
    slides.push({ kicker: "Nexthlon", ...GENERAL_LINE, cta: "Browse all gear", href: "/products", image: "" });
  }
  return slides;
}

async function getHomePage(now = new Date()) {
  const sections = await productService.getHomeSections();
  return { ...sections, slides: buildHeroSlides(sections), dealEndsAt: dealEndsAt(now) };
}

module.exports = { dealEndsAt, buildHeroSlides, getHomePage };
