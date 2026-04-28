const rawProducts = require('./products.json');

const MARKUP_RATE = 0.14;

/**
 * Parse productDetails rich_text_field value into plain text
 */
function parseProductDetails(productDetails) {
  if (!productDetails || !productDetails.value) return null;
  try {
    const ast = JSON.parse(productDetails.value);
    const lines = [];
    function walk(node) {
      if (!node) return;
      if (node.type === 'text') {
        lines.push(node.value || '');
      }
      if (node.children) node.children.forEach(walk);
    }
    walk(ast);
    return lines.join(' ').replace(/\s+/g, ' ').trim();
  } catch {
    return null;
  }
}

/**
 * Extract material info from productDetails or description
 */
function extractMaterial(product) {
  const details = parseProductDetails(product.productDetails);
  if (details) {
    const match = details.match(/Material[:\s]+([^\.]+)/i);
    if (match) return match[1].trim();
  }
  const desc = product.description || '';
  const match = desc.match(/(?:crafted from|made (?:from|with|of)|fabric[:\s]+)([^\.]+)/i);
  if (match) return match[1].trim();
  return null;
}

/**
 * Compute markup breakdown for transparent pricing
 */
function computeMarkup(finalPrice) {
  const price = parseFloat(finalPrice);
  if (!price || price <= 0) return null;
  const baseCost = Math.round(price / (1 + MARKUP_RATE));
  const markupAmount = Math.round(price - baseCost);
  return {
    baseCost,
    markupPercent: 14,
    markupAmount,
    finalPrice: Math.round(price),
    currency: 'INR',
    note: 'We apply a flat 14% markup on all products for transparency.',
  };
}

/**
 * Derive body/use-case keywords from title, description, and image descriptions
 */
function deriveKeywords(product) {
  const text = [
    product.title || '',
    product.description || '',
    ...(product.imageDescriptions || []).map((d) => d.richDescription || ''),
    parseProductDetails(product.productDetails) || '',
  ]
    .join(' ')
    .toLowerCase();

  const keywords = [];

  // Activity keywords
  const activityMap = {
    yoga: ['yoga', 'namaste', 'pilates'],
    gym: ['gym', 'training', 'workout', 'fitness', 'athletic'],
    running: ['running', 'run ', 'jogging'],
    casual: ['casual', 'everyday', 'lounge', 'athleisure', 'leisure'],
    swimming: ['swim', 'water'],
    hiking: ['hike', 'hiking', 'outdoor', 'trail'],
  };
  for (const [activity, triggers] of Object.entries(activityMap)) {
    if (triggers.some((t) => text.includes(t))) keywords.push(activity);
  }

  // Body/fit keywords
  const fitMap = {
    flare: ['flare', 'flared', 'wide leg', 'wide-leg', 'bell bottom'],
    legging: ['legging', 'tight fit', 'fitted', 'compression'],
    looseFit: ['loose', 'relaxed', 'baggy', 'oversized', 'wide'],
    highWaist: ['high waist', 'high-waist', 'high rise'],
    vNeck: ['v-neck', 'v neck', 'vneck', 'v-front'],
    squareNeck: ['square collar', 'square neck', 'scallop'],
    offShoulder: ['off-shoulder', 'off shoulder'],
    croptop: ['crop', 'cropped'],
    longSleeve: ['long sleeve', 'long-sleeve'],
    set: ['set', 'two-piece', '2-piece', 'three-piece', '3-piece'],
    shorts: ['short', 'shorts'],
    jacket: ['jacket', 'hoodie', 'sweatshirt', 'zip'],
    sweatpant: ['sweatpant', 'jogger', 'trackpant'],
    bag: ['bag', 'tote', 'backpack', 'sling', 'handbag', 'crescent'],
    sunglass: ['sunglass', 'eyewear', 'polarized', 'uv'],
    top: ['top', 'bra', 'blouse'],
  };
  for (const [fit, triggers] of Object.entries(fitMap)) {
    if (triggers.some((t) => text.includes(t))) keywords.push(fit);
  }

  // Material keywords
  const matMap = {
    nylon: ['nylon'],
    spandex: ['spandex', 'elastane'],
    cotton: ['cotton'],
    polyester: ['polyester'],
    seamless: ['seamless'],
    stretch: ['stretch', 'four-way', '4-way'],
    quickDry: ['quick-dry', 'quick dry', 'sweat-wick', 'wicking'],
    breathable: ['breathable'],
    softFabric: ['soft', 'smooth', 'modal'],
  };
  for (const [mat, triggers] of Object.entries(matMap)) {
    if (triggers.some((t) => text.includes(t))) keywords.push(mat);
  }

  return [...new Set(keywords)];
}

/**
 * Body-shape matching rules — no embeddings needed, pure keyword logic
 */
const bodyMatchRules = [
  {
    bodySignals: ['pear', 'pear-shaped', 'wider hips', 'wider hip', 'big hips', 'larger hips', 'hip heavy', 'bottom heavy'],
    fitPreferences: ['highWaist', 'flare', 'looseFit'],
    avoidFits: ['legging'],
    tip: 'High-waist and flare cuts balance wider hips beautifully by drawing the eye upward.',
  },
  {
    bodySignals: ['broad shoulder', 'wide shoulder', 'inverted triangle', 'large shoulder'],
    fitPreferences: ['looseFit', 'vNeck', 'flare'],
    avoidFits: ['offShoulder', 'squareNeck'],
    tip: 'V-necks and flare bottoms soften broad shoulders and create a balanced silhouette.',
  },
  {
    bodySignals: ['apple', 'apple-shaped', 'midsection', 'tummy', 'belly', 'loose around middle'],
    fitPreferences: ['looseFit', 'highWaist', 'longSleeve'],
    avoidFits: ['croptop'],
    tip: 'High-waist bottoms and relaxed tops gently define your waist without clinging.',
  },
  {
    bodySignals: ['hourglass', 'curvy', 'defined waist', 'well proportioned'],
    fitPreferences: ['highWaist', 'legging', 'set', 'flare'],
    avoidFits: [],
    tip: 'Most silhouettes suit you — high-waist and fitted styles highlight your natural shape.',
  },
  {
    bodySignals: ['petite', 'short', 'small frame', 'tiny'],
    fitPreferences: ['croptop', 'highWaist', 'legging'],
    avoidFits: ['looseFit', 'sweatpant'],
    tip: 'High-waist styles and cropped tops create the illusion of longer legs.',
  },
  {
    bodySignals: ['tall', 'long legs', 'long torso', 'lean'],
    fitPreferences: ['flare', 'looseFit', 'set', 'longSleeve'],
    avoidFits: [],
    tip: 'Flare and wide-leg styles beautifully complement long legs.',
  },
  {
    bodySignals: ['plus size', 'plus-size', 'larger frame', 'big', 'full figure'],
    fitPreferences: ['looseFit', 'highWaist', 'flare', 'set'],
    avoidFits: ['legging'],
    tip: 'Relaxed, high-waist fits and flare pants offer comfort and a confident silhouette.',
  },
];

/**
 * Score a product for relevance given detected body signals and activity needs
 */
function scoreProduct(product, detectedBodySignals, activityNeeds) {
  let score = 0;
  const kw = product.keywords;

  // Match body shape preferences
  for (const rule of bodyMatchRules) {
    const matched = rule.bodySignals.some((s) =>
      detectedBodySignals.some((d) => d.includes(s) || s.includes(d))
    );
    if (matched) {
      rule.fitPreferences.forEach((pref) => {
        if (kw.includes(pref)) score += 3;
      });
      rule.avoidFits.forEach((avoid) => {
        if (kw.includes(avoid)) score -= 2;
      });
    }
  }

  // Match activity needs
  activityNeeds.forEach((need) => {
    if (kw.includes(need)) score += 2;
  });

  return score;
}

/**
 * Process the raw catalog into a clean, enriched format
 */
const catalog = rawProducts
  .filter(
    (p) =>
      p.availableForSale &&
      p.title &&
      p.title.trim() !== '' &&
      p.title.toLowerCase() !== 'women' &&
      parseFloat(p.priceRange?.minVariantPrice?.amount) > 0
  )
  .map((p) => {
    const price = parseFloat(p.priceRange.minVariantPrice.amount);
    const colors = p.options?.find((o) => o.name === 'Color')?.values || [];
    const sizes = p.options?.find((o) => o.name === 'Size')?.values || ['One Size'];
    const detailsText = parseProductDetails(p.productDetails);
    const keywords = deriveKeywords(p);

    return {
      id: p.id,
      handle: p.handle,
      title: p.title,
      description: p.description || '',
      price,
      priceDisplay: `₹${Math.round(price)}`,
      currency: 'INR',
      markup: computeMarkup(price),
      material: extractMaterial(p),
      colors,
      sizes,
      availableForSale: p.availableForSale,
      featuredImage: p.featuredImage?.url || null,
      keywords,
      detailsText,
      imageDescriptions: (p.imageDescriptions || []).map((d) => d.richDescription),
      searchText: [
        p.title,
        p.description || '',
        detailsText || '',
        (p.imageDescriptions || []).map((d) => d.richDescription).join(' '),
      ]
        .join(' ')
        .toLowerCase(),
    };
  });

/**
 * Find a product by exact or fuzzy title/handle match
 */
function findProductByName(query) {
  const q = query.toLowerCase().trim();
  // Exact title match
  let match = catalog.find((p) => p.title.toLowerCase() === q);
  if (match) return match;
  // Handle match
  match = catalog.find((p) => p.handle === q.replace(/\s+/g, '-'));
  if (match) return match;
  // Partial title match
  match = catalog.find((p) => p.title.toLowerCase().includes(q) || q.includes(p.title.toLowerCase()));
  if (match) return match;
  return null;
}

/**
 * Detect body shape signals from user message text
 */
function detectBodySignals(text) {
  const t = text.toLowerCase();
  const allSignals = bodyMatchRules.flatMap((r) => r.bodySignals);
  return allSignals.filter((s) => t.includes(s));
}

/**
 * Detect activity needs from user message text
 */
function detectActivityNeeds(text) {
  const t = text.toLowerCase();
  const activities = ['yoga', 'gym', 'running', 'casual', 'swimming', 'hiking', 'pilates', 'lounge', 'workout'];
  return activities.filter((a) => t.includes(a));
}

/**
 * Get top N products sorted by relevance score for vague/body queries
 */
function getRelevantProducts(userText, limit = 4) {
  const bodySignals = detectBodySignals(userText);
  const activityNeeds = detectActivityNeeds(userText);

  const scored = catalog.map((p) => ({
    ...p,
    score: scoreProduct(p, bodySignals, activityNeeds),
  }));

  // Always filter to available products
  const available = scored.filter((p) => p.availableForSale);

  // If we have signals, return scored results
  if (bodySignals.length > 0 || activityNeeds.length > 0) {
    return available
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // Otherwise return a diverse mix
  return available.slice(0, limit);
}

/**
 * Get matching body tip for given signals
 */
function getBodyTip(bodySignals) {
  for (const rule of bodyMatchRules) {
    if (rule.bodySignals.some((s) => bodySignals.some((d) => d.includes(s) || s.includes(d)))) {
      return rule.tip;
    }
  }
  return null;
}

/**
 * Build a compact catalog summary for the system prompt
 * We send only available products with key fields
 */
function buildCatalogSummary() {
  return catalog
    .map((p) => {
      const markup = p.markup;
      return [
        `[${p.title}]`,
        `Price: ${p.priceDisplay} (Base cost: ₹${markup?.baseCost}, Markup 14%: ₹${markup?.markupAmount})`,
        `Material: ${p.material || 'see description'}`,
        `Sizes: ${p.sizes.join(', ')}`,
        `Colors: ${p.colors.join(', ')}`,
        `Fit/Use: ${p.keywords.join(', ')}`,
        `Description: ${p.description.substring(0, 200)}`,
      ].join(' | ');
    })
    .join('\n');
}

module.exports = {
  catalog,
  findProductByName,
  detectBodySignals,
  detectActivityNeeds,
  getRelevantProducts,
  getBodyTip,
  buildCatalogSummary,
  bodyMatchRules,
  MARKUP_RATE,
};
