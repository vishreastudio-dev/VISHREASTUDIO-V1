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

// Search catalogue with intent filters safely
async function searchProducts({ q, category, occasion, color, maxPrice, inStockOnly = true }) {
  const where = ['p.is_active = true', 'p.archived_at IS NULL', 'vs.variant_count > 0'];
  const params = [];

  if (category) {
    params.push(category.toLowerCase());
    where.push(`(lower(c.slug) = $${params.length} OR lower(c.name) LIKE '%' || $${params.length} || '%')`);
  }

  if (occasion) {
    params.push(occasion.toLowerCase());
    where.push(`lower(coalesce(p.occasion, '')) LIKE '%' || $${params.length} || '%'`);
  }

  if (color) {
    params.push(color.toLowerCase());
    where.push(`lower(coalesce(p.color, '')) LIKE '%' || $${params.length} || '%'`);
  }

  if (maxPrice && !isNaN(Number(maxPrice))) {
    params.push(Number(maxPrice));
    where.push(`vs.min_price <= $${params.length}`);
  }

  if (inStockOnly) {
    where.push('vs.in_stock = true');
  }

  if (q) {
    params.push(q.toLowerCase());
    where.push(`(lower(p.name) LIKE '%' || $${params.length} || '%' OR lower(coalesce(p.description, '')) LIKE '%' || $${params.length} || '%')`);
  }

  const query = `
    SELECT p.id, p.name, p.slug, p.description, p.image_url, p.images, p.badge, p.material, p.color, p.occasion,
           p.price_inr, p.featured, p.is_one_of_one, p.created_at,
           c.name as category, c.slug as category_slug, vs.*
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      ${VARIANT_SUMMARY_SQL}
     WHERE ${where.join(' AND ')}
     ORDER BY p.featured DESC, vs.in_stock DESC, p.created_at DESC
     LIMIT 6
  `;

  const r = await db.query(query, params);
  return r.rows.map(normalizeProduct);
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

  // 2. Extract potential fashion discovery criteria and search catalogue
  const criteria = extractCriteria(message);
  const isPurePolicyOrOrder = /^\s*(where is my order|order status|track order|shipping policy|return policy|exchange policy|refund|how much is membership|contact|phone|email)\s*$/i.test(message);
  const isShoppingQuery = !isPurePolicyOrOrder || Boolean(
    criteria.category ||
    criteria.occasion ||
    criteria.color ||
    criteria.maxPrice ||
    /dress|outfit|recommend|style|wear|collection|look|inventory|stock|show|pic|image|photo|available|browse|piece|coord|top|pant|new|latest|arrival|araival|display|drop|item|catalog|trending|curat/i.test(message)
  );

  let matchedProducts = [];
  if (isShoppingQuery) {
    matchedProducts = await searchProducts({
      category: criteria.category,
      occasion: criteria.occasion,
      color: criteria.color,
      maxPrice: criteria.maxPrice,
    });

    // If specific filters (e.g. strict maxPrice or specific color) yielded nothing, fall back to the category
    if (matchedProducts.length === 0 && criteria.category) {
      matchedProducts = await searchProducts({ category: criteria.category });
    }

    // If still nothing or general inventory inquiry ("whats new", "display latest new"), return live pieces
    if (matchedProducts.length === 0) {
      matchedProducts = await searchProducts({ inStockOnly: true });
    }
  }

  // 3. Grounded Policies & Store Knowledge Summary
  const policyKnowledge = `
Verified Vishrea Studio Policies:
- Brand Concept: Mindful Indian luxury studio. Each piece is one-of-one or limited edition, designed for effortless elegance and timeless silhouettes.
- Walkin Wardrobe Membership: ₹1,799/month. Members receive 4 credits every month to pick and wear studio pieces. Credits rollover for 90 days. Members enjoy 48-hour early access to new drops and free shipping. Cancel anytime.
- Shipping: Free delivery across India on orders above ₹1,999; flat ₹99 below that. Dispatched from our Bengaluru studio within 48-72 hours. Standard transit 3-5 working days.
- Exchanges & Returns: Hassle-free 7-day exchange window for size and fit alterations. Because pieces are curated 1-of-1, cash refunds apply only when replacement is unavailable.
- Contact & Support: Email care@vishreastudio.com or WhatsApp support. Studio located in Indiranagar, Bengaluru.
`;

  // 4. Construct AI prompt
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

Available Real Pieces in Live Studio Stock:
${matchedProducts.length > 0 ? matchedProducts.map((p) => `- ${p.name} (₹${p.price_inr}): ${p.material || ''}, ${p.color || ''}, ${p.badge || 'Available'}. Slug: ${p.slug}`).join('\n') : 'No exact catalogue matches found.'}

Strict Rules:
1. When real pieces are listed in 'Available Real Pieces in Live Studio Stock' above, enthusiastically introduce and describe them! Explicitly encourage the customer to tap the interactive visual product cards displayed right below your message in this chat.
2. NEVER say "I cannot list items in this chat" or "we do not maintain a feed in this chat" — because our interactive visual cards ARE rendered right here in this chat window!
3. ONLY recommend genuine pieces listed in the section above. Never invent fake products or altered prices.
4. If the user asks about an order or account and is NOT signed in, gently invite them to sign in at /login so you can pull up their details.
5. If customer asks about policies (membership, shipping, returns), answer accurately based on the Verified Policies above. Never guess or contradict store rules.
6. NEVER ask for bank details, credit card numbers, or passwords.
7. Keep replies concise, stylish, and conversational (2-3 paragraphs max).
8. STRICT NO-STARS RULE: Strictly do NOT use markdown bold asterisks or stars (never use **word** or *word*). Write plain, natural text with standard punctuation.`;

  const chatMessages = conversationHistory.map((m) => ({
    role: m.sender === 'user' ? 'user' : 'assistant',
    content: m.content,
  }));
  chatMessages.push({ role: 'user', content: message });

  try {
    const aiResult = await ai.chat({
      system: systemPrompt,
      messages: chatMessages,
      maxTokens: 750,
      temperature: 0.65,
    });

    // Prepare products payload for rich display cards in the frontend
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

    const recommendedProducts = matchedProducts.slice(0, 4).map(formatProduct);

    return res.json({
      ok: true,
      reply: stripStars(aiResult.text),
      products: recommendedProducts,
      provider: aiResult.provider,
    });
  } catch (err) {
    log.error('style_assistant.error', { message: err.message });
    // Graceful fallback response when AI is temporarily unavailable
    let fallbackReply = "I'm delighted you're exploring Vishrea Studio. You can explore our collection on the catalogue page, or reach out directly to care@vishreastudio.com for personalized concierge styling.";
    if (isShoppingQuery && matchedProducts.length > 0) {
      fallbackReply = `Here are curated pieces from our current studio collection that suit your look:`;
    }

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

    return res.json({
      ok: true,
      reply: fallbackReply,
      products: matchedProducts.slice(0, 4).map(formatProduct),
      fallback: true,
    });
  }
}
