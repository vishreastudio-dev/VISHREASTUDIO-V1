import { ai } from '../lib/ai.js';
import { db } from '../lib/db.js';
import { AppError } from '../lib/http.js';
import { text } from '../lib/validate.js';
import { normalizeProduct, VARIANT_SUMMARY_SQL } from '../lib/catalogue.js';
import { POLICIES } from '../vishrea-react/src/content/policies.js';
export { POLICIES };
import { log } from '../lib/log.js';

export const access = 'public';
export const methods = ['GET', 'POST'];
export const rateLimitPerUser = { windowMs: 15 * 60_000, max: 40 };

// Fetch all verified in-stock studio pieces in real-time
async function getAllStudioProducts() {
  const query = `
    SELECT p.id, p.name, p.slug, p.description, p.image_url, p.images, p.badge, p.material, p.color, p.occasion,
           p.price_inr, p.featured, p.is_one_of_one, p.created_at,
           c.name as category, c.slug as category_slug, vs.*
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      ${VARIANT_SUMMARY_SQL}
     WHERE p.is_active = true AND p.archived_at IS NULL AND vs.variant_count > 0 AND vs.in_stock = true
     ORDER BY p.featured DESC, p.created_at DESC
  `;
  try {
    const r = await db.query(query);
    return r.rows.map(normalizeProduct);
  } catch (err) {
    log.error('style_assistant.getAllStudioProducts_failed', { message: err.message });
    return [];
  }
}

// Real-time semantic matching based on user query intent, occasions, colors, and budgets
function matchProductsRealtime(allProducts, message) {
  if (!Array.isArray(allProducts) || allProducts.length === 0) return [];
  const text = String(message || '').toLowerCase();

  // If query is strictly non-shopping (order tracking, shipping, return policies, contact)
  const isPurePolicyOrOrder = /^\s*(where is my order|order status|track order|shipping policy|return policy|exchange policy|refund|how much is membership|contact|phone|email)\s*$/i.test(text);
  if (isPurePolicyOrOrder) {
    return [];
  }

  // Parse budget / max price
  let maxPrice = null;
  const budgetMatch = text.match(/(?:under|below|budget|within|less than|up to|cheaper than)\s*(?:₹|rs\.?|inr)?\s*([0-9]+(?:,[0-9]+)?)/i);
  if (budgetMatch) {
    maxPrice = Number(budgetMatch[1].replace(/,/g, ''));
  }

  // Category and occasion keywords
  const eveningKeywords = ['evening', 'dinner', 'cocktail', 'party', 'date', 'gala', 'after hours', 'celebration', 'night out', 'night'];
  const winterWarmthKeywords = ['sweater', 'sweaters', 'winter', 'warm', 'warmth', 'knit', 'knitwear', 'cardigan', 'cardigans', 'cozy', 'cold'];
  const topKeywords = ['top', 'tops', 'crop', 'crop top', 'blouse', 'shirt'];
  const coordKeywords = ['coord', 'coords', 'set', 'sets', 'matching', 'two piece'];
  const pantKeywords = ['pant', 'pants', 'trouser', 'trousers', 'bottom', 'bottoms', 'wide leg'];
  const dressKeywords = ['dress', 'dresses', 'gown', 'slip dress', 'column dress'];
  const shrugKeywords = ['shrug', 'shrugs', 'coat', 'longline', 'outerwear'];

  // Color mapping
  const colorMap = {
    yellow: ['yellow', 'mustard'],
    mustard: ['yellow', 'mustard'],
    blue: ['blue', 'navy'],
    wine: ['wine', 'burgundy', 'maroon', 'red'],
    burgundy: ['wine', 'burgundy', 'maroon', 'red'],
    black: ['black', 'dark'],
    charcoal: ['charcoal', 'grey', 'gray', 'dark'],
    oat: ['oat', 'beige', 'neutral', 'sand', 'tan'],
    stone: ['stone', 'grey', 'gray', 'neutral'],
    ivory: ['ivory', 'white', 'cream', 'off-white'],
    pearl: ['pearl', 'white', 'cream'],
  };

  const isWarmPalette = /warm|autumn|earth|fall|golden|sunset/i.test(text);
  const isCoolPalette = /cool|winter|ocean|ice|slate/i.test(text);

  // Score each product in live catalogue
  const scored = allProducts.map((p) => {
    let score = 0;
    const nameLower = (p.name || '').toLowerCase();
    const catLower = (p.category || '').toLowerCase();
    const colLower = (p.color || '').toLowerCase();
    const descLower = (p.description || '').toLowerCase();
    const matLower = (p.material || '').toLowerCase();

    // 1. Budget filter
    if (maxPrice !== null) {
      if (p.price_inr <= maxPrice) {
        score += 35;
      } else {
        score -= 60; // heavily penalize exceeding user budget
      }
    }

    // 2. Specific color matches
    for (const [key, synonyms] of Object.entries(colorMap)) {
      if (synonyms.some((syn) => text.includes(syn))) {
        if (synonyms.some((syn) => colLower.includes(syn))) {
          score += 40;
        }
      }
    }

    // 3. Palette intent
    if (isWarmPalette) {
      if (/mustard|yellow|oat|stone|wine|burgundy|ivory|gold/i.test(colLower)) score += 30;
      else if (/blue|charcoal|black/i.test(colLower)) score -= 15;
    }
    if (isCoolPalette) {
      if (/blue|pearl|charcoal|black|ink/i.test(colLower)) score += 30;
      else if (/mustard|yellow|oat/i.test(colLower)) score -= 15;
    }

    // 4. Occasions & Specific Category Intents
    // Evening / Dinner
    if (eveningKeywords.some((k) => text.includes(k))) {
      if (/party dresses|dresses/i.test(catLower) || /wine|after hours|slip/i.test(nameLower)) {
        score += 45;
      } else if (/long coats|shrug/i.test(catLower)) {
        score += 20; // good layering for evening
      } else if (/tops|crop tops|sweaters/i.test(catLower)) {
        score -= 30; // casual tops don't belong in evening dinner
      }
    }

    // Winter / Warmth / Sweaters
    if (winterWarmthKeywords.some((k) => text.includes(k))) {
      if (/sweaters|cardigans/i.test(catLower) || /knit|warmth|bunny/i.test(nameLower)) {
        score += 50;
      } else if (/crop tops|slip dress/i.test(nameLower) || /party dresses/i.test(catLower)) {
        score -= 30;
      }
    }

    // Tops
    if (topKeywords.some((k) => text.includes(k))) {
      if (/tops|crop tops/i.test(catLower)) {
        score += 45;
      }
    }

    // Coord sets
    if (coordKeywords.some((k) => text.includes(k))) {
      if (/coord/i.test(catLower) || /coord/i.test(nameLower)) {
        score += 50;
      }
    }

    // Pants / Trousers
    if (pantKeywords.some((k) => text.includes(k))) {
      if (/pant/i.test(catLower) || /pant|trouser/i.test(nameLower)) {
        score += 50;
      }
    }

    // Dresses
    if (dressKeywords.some((k) => text.includes(k)) && !eveningKeywords.some((k) => text.includes(k))) {
      if (/dresses/i.test(catLower)) {
        score += 40;
      }
    }

    // Shrugs / Coats
    if (shrugKeywords.some((k) => text.includes(k))) {
      if (/long coats|shrug/i.test(catLower) || /shrug/i.test(nameLower)) {
        score += 50;
      }
    }

    // Exact word occurrences in Name or Description
    const words = text.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
    for (const w of words) {
      if (nameLower.includes(w)) score += 20;
      else if (descLower.includes(w)) score += 10;
      else if (matLower.includes(w)) score += 10;
    }

    return { product: p, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // If top items have a positive score, return those
  const positive = scored.filter((s) => s.score > 15);
  if (positive.length > 0) {
    return positive.slice(0, 4).map((s) => s.product);
  }

  // If general styling question without specific matches, return curated diverse mix
  if (/style|styling|wear|look|recommend|outfit|pieces|collection|what's new|whats new|new/i.test(text)) {
    return allProducts.slice(0, 4);
  }

  return [];
}

// Fetch authenticated customer's own verified orders and membership
async function getCustomerContext(userId) {
  if (!userId) return null;
  const [ordersRes, membershipRes] = await Promise.all([
    db.query(
      `SELECT id, status, payment_status, total, created_at, shipping_fee,
              (SELECT count(*)::int FROM order_items WHERE order_id = orders.id) as items_count
         FROM orders
        WHERE auth_user_id = $1
        ORDER BY created_at DESC LIMIT 3`,
      [userId]
    ),
    db.query(
      `SELECT status, monthly_price, credits_balance, renewal_at
         FROM memberships
        WHERE auth_user_id = $1 LIMIT 1`,
      [userId]
    ),
  ]);

  return {
    recent_orders: ordersRes.rows.map((o) => ({
      order_id: o.id.slice(0, 8).toUpperCase(),
      full_id: o.id,
      status: o.status,
      payment_status: o.payment_status,
      total_inr: o.total,
      date: new Date(o.created_at).toLocaleDateString('en-IN'),
    })),
    membership: membershipRes.rows[0]
      ? {
          status: membershipRes.rows[0].status,
          credits_balance: membershipRes.rows[0].credits_balance,
          monthly_price: membershipRes.rows[0].monthly_price,
          renewal_at: membershipRes.rows[0].renewal_at ? new Date(membershipRes.rows[0].renewal_at).toLocaleDateString('en-IN') : null,
        }
      : null,
  };
}

// Extract search criteria from query text
function extractCriteria(message) {
  const lower = message.toLowerCase();
  const criteria = {
    category: null,
    occasion: null,
    color: null,
    maxPrice: null,
    inStockOnly: true,
  };

  // Categories
  const categories = ['dress', 'dresses', 'top', 'tops', 'pant', 'pants', 'skirt', 'skirts', 'coord', 'cardigan', 'shrug', 'sweater'];
  for (const cat of categories) {
    if (lower.includes(cat)) {
      if (cat.startsWith('dress')) criteria.category = 'dresses';
      else if (cat.startsWith('top')) criteria.category = 'tops';
      else if (cat.startsWith('pant')) criteria.category = 'pants';
      else if (cat.startsWith('skirt')) criteria.category = 'skirts';
      else if (cat.startsWith('coord')) criteria.category = 'coord-sets';
      else if (cat.startsWith('cardigan')) criteria.category = 'cardigans';
      else if (cat.startsWith('shrug')) criteria.category = 'long-coats-shrugs';
      else if (cat.startsWith('sweater')) criteria.category = 'sweaters';
      break;
    }
  }

  // Occasions
  const occasions = ['dinner', 'party', 'brunch', 'evening', 'cocktail', 'casual', 'editorial', 'work', 'date'];
  for (const occ of occasions) {
    if (lower.includes(occ)) {
      criteria.occasion = occ;
      break;
    }
  }

  // Colors
  const colors = ['black', 'wine', 'burgundy', 'white', 'ivory', 'stone', 'charcoal', 'pearl', 'oat', 'red', 'blue', 'green', 'gold'];
  for (const col of colors) {
    if (lower.includes(col)) {
      criteria.color = col;
      break;
    }
  }

  // Budget
  const budgetMatch = lower.match(/(?:under|below|budget|within|less than|up to)\s*(?:₹|rs\.?|inr)?\s*([0-9]+(?:,[0-9]+)?)/i);
  if (budgetMatch) {
    criteria.maxPrice = Number(budgetMatch[1].replace(/,/g, ''));
  }

  return criteria;
}

// Clean markdown bold asterisks and star bullets from AI text
function stripStars(text) {
  if (!text) return '';
  return String(text)
    .replace(/\*\*\*(.*?)\*\*\*/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, '$1')
    .replace(/^(\s*)\*\s+/gm, '$1• ')
    .replace(/\*\*/g, '');
}

export default async function styleAssistant(req, res) {
  const message = text(req.body?.message, { max: 1000, field: 'message', required: true });
  const conversationHistory = Array.isArray(req.body?.history) ? req.body.history.slice(-6) : [];

  // 1. Gather customer session context if signed in
  const user = req.user;
  const customerContext = user ? await getCustomerContext(user.id) : null;

  // 2. Fetch all real active in-stock pieces from the studio inventory in real-time
  const allStudioProducts = await getAllStudioProducts();

  // 3. Real-time semantic matching based on query reality
  const realtimeMatched = matchProductsRealtime(allStudioProducts, message);

  // 4. Grounded Policies & Store Knowledge Summary
  const policyKnowledge = `
Verified Vishrea Studio Policies:
- Brand Concept: Mindful Indian luxury studio. Each piece is one-of-one or limited edition, designed for effortless elegance and timeless silhouettes.
- Walkin Wardrobe Membership: ₹1,799/month. Members receive 4 credits every month to pick and wear studio pieces. Credits rollover for 90 days. Members enjoy 48-hour early access to new drops and free shipping. Cancel anytime.
- Shipping: Free delivery across India on orders above ₹1,999; flat ₹99 below that. Dispatched from our Bengaluru studio within 48-72 hours. Standard transit 3-5 working days.
- Exchanges & Returns: Hassle-free 7-day exchange window for size and fit alterations. Because pieces are curated 1-of-1, cash refunds apply only when replacement is unavailable.
- Contact & Support: Email care@vishreastudio.com or WhatsApp support. Studio located in Indiranagar, Bengaluru.
`;

  // 5. Build dynamic catalogue inventory for the AI prompt
  const inventorySnapshot = allStudioProducts.map((p) =>
    `- ${p.name} [slug: ${p.slug}] (₹${p.price_inr}): Category: ${p.category || 'Atelier'}, Material: ${p.material || 'Studio fabric'}, Color: ${p.color || 'Curated tone'}. Description: ${p.description || ''}`
  ).join('\n');

  // 6. Construct AI prompt
  const systemPrompt = `You are the Vishrea Style Concierge, an elegant, warm, and highly discerning luxury personal fashion advisor for Vishrea Studio.
You speak with effortless poise, refined fashion sensibility, and attentive hospitality.

Brand Identity: Contemporary slow fashion, architectural cuts, bespoke finishes, and flattering palettes.

Customer Context:
${user ? `Customer is signed in as: ${user.name || user.email}` : 'Customer is a guest browsing the storefront.'}
${customerContext ? `Customer Account Snapshot:
- Recent Orders: ${JSON.stringify(customerContext.recent_orders)}
- Membership: ${customerContext.membership ? `${customerContext.membership.status} (${customerContext.membership.credits_balance} credits)` : 'No active membership'}
` : ''}

${policyKnowledge}

Live Available Studio Pieces in Stock:
${inventorySnapshot || 'No inventory currently loaded.'}

Strict Rules:
1. Grounded Recommendations: Recommend ONLY real pieces from the list above that directly match the customer's query (e.g. evening gowns for dinners, knits/sweaters for warmth, specific colors for requested palettes).
2. Dynamic Recommendation Tag: At the very end of your response on a new line, always output:
RECOMMENDED_PIECES: [slug1, slug2]
Rules:
- Include 1 to 4 exact slugs from the Live Available Studio Pieces that directly answer the customer's query.
- If the customer asks a pure policy question (shipping, returns, exchange, order status, contact), output: RECOMMENDED_PIECES: []
- Never invent fictional slugs or prices.
3. NEVER say "I cannot list items in this chat" — interactive visual product cards are displayed right below your message.
4. If customer asks about policies or account, answer accurately based on the Verified Policies above.
5. STRICT NO-STARS RULE: Strictly do NOT use markdown bold asterisks or stars (never use **word** or *word*). Write plain, natural text with standard punctuation.`;

  const chatMessages = conversationHistory.map((m) => ({
    role: m.sender === 'user' ? 'user' : 'assistant',
    content: m.content,
  }));
  chatMessages.push({ role: 'user', content: message });

  const formatProduct = (p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    price_inr: p.price_inr,
    image_url: p.image_url || (Array.isArray(p.images) && p.images[0]) || null,
    category: p.category,
    badge: p.badge,
    available: p.available !== false,
    color: p.color || null,
    material: p.material || null,
  });

  try {
    const aiResult = await ai.chat({
      system: systemPrompt,
      messages: chatMessages,
      maxTokens: 750,
      temperature: 0.65,
    });

    let rawReply = aiResult.text || '';
    let aiSlugs = [];
    const slugMatch = rawReply.match(/RECOMMENDED_PIECES:\s*\[(.*?)\]/i);
    if (slugMatch) {
      aiSlugs = slugMatch[1]
        .split(',')
        .map((s) => s.trim().replace(/['"\[\]]/g, ''))
        .filter(Boolean);
    }

    // Clean AI reply so customer does not see the technical recommendation tag
    const cleanReply = stripStars(
      rawReply.replace(/RECOMMENDED_PIECES:\s*\[.*?\]/gi, '').trim()
    );

    // Dynamic product selection: AI slugs matched to live inventory
    let finalProducts = [];
    if (aiSlugs.length > 0) {
      const slugMap = new Map(allStudioProducts.map((p) => [p.slug, p]));
      finalProducts = aiSlugs.map((s) => slugMap.get(s)).filter(Boolean);
    }

    // If AI did not output slugs or if empty and query is not a policy question, use our real-time semantic matcher
    const isPurePolicy = /^\s*(where is my order|order status|track order|shipping policy|return policy|exchange policy|refund|contact|phone|email)\s*$/i.test(message);
    if (finalProducts.length === 0 && !isPurePolicy) {
      finalProducts = realtimeMatched;
    }

    return res.json({
      ok: true,
      reply: cleanReply,
      products: finalProducts.slice(0, 4).map(formatProduct),
      provider: aiResult.provider,
    });
  } catch (err) {
    log.error('style_assistant.error', { message: err.message });

    // Graceful fallback response when AI is temporarily unavailable
    let fallbackReply = "I'm delighted you're exploring Vishrea Studio. You can explore our collection on the catalogue page, or reach out directly to care@vishreastudio.com for personalized concierge styling.";
    if (realtimeMatched.length > 0) {
      fallbackReply = `Here are curated pieces from our studio collection that directly suit your query:`;
    }

    return res.json({
      ok: true,
      reply: fallbackReply,
      products: realtimeMatched.slice(0, 4).map(formatProduct),
      fallback: true,
    });
  }
}
