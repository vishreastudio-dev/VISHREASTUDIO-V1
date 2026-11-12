import { ai } from '../../lib/ai.js';
import { db } from '../../lib/db.js';
import { AppError } from '../../lib/http.js';
import { text } from '../../lib/validate.js';
import { log } from '../../lib/log.js';

export const access = 'admin';
export const methods = ['GET', 'POST', 'PUT', 'DELETE'];
export const rateLimitPerUser = { windowMs: 60 * 60_000, max: 120 };

const CONTENT_TYPES = [
  'product_description',
  'instagram_caption',
  'social_media',
  'campaign_announcement',
  'homepage_banner',
  'seo_metadata',
  'product_faq',
  'customer_reply',
];

const PROMPT_TEMPLATES = {
  product_description: ({ product, tone, length, language, campaign }) => `
Task: Write a compelling luxury fashion product description in ${language || 'English'}.
Tone: ${tone || 'Editorial, sophisticated, understated luxury'}.
Length: ${length || 'Medium (2 paragraphs)'}.
${campaign ? `Campaign/Collection Theme: ${campaign}` : ''}

Verified Product Details:
- Name: ${product.name}
- Category: ${product.category || 'Luxury Fashion'}
- Price: ₹${product.price_inr}
- Material/Fabric: ${product.material || 'Premium textile (no unverified fabric claims)'}
- Color: ${product.color || 'Unspecified'}
- Color Season: ${product.colour_season || 'All Season'}
- Occasion: ${product.occasion || 'Versatile'}
- One of One: ${product.is_one_of_one ? 'Yes (Unique individual piece)' : 'No'}
- Measurements: Bust ${product.bust_cm || '-'}cm, Waist ${product.waist_cm || '-'}cm, Hip ${product.hip_cm || '-'}cm, Length ${product.length_cm || '-'}cm
- Existing Description: ${product.description || 'None provided'}

Strict Rules:
- Rely strictly on the verified details above. Do not invent fabric composition, certifications, or quality claims not stated.
- Emphasize fit, silhouette, craftsmanship, and styling suggestions.
- Return clean editorial copy ready for publishing.
`,

  instagram_caption: ({ product, tone, length, language, campaign }) => `
Task: Write an Instagram caption and hashtags for Vishrea Studio in ${language || 'English'}.
Tone: ${tone || 'Alluring, chic, modern luxury'}.
Length: ${length || 'Concise with hook, body, and call to action'}.
${campaign ? `Campaign Context: ${campaign}` : ''}

${product ? `Featured Piece: ${product.name} (₹${product.price_inr}, ${product.color || ''} ${product.category || ''})` : 'Theme: Vishrea Studio luxury editorial brand post'}

Include:
1. Striking hook
2. Engaging caption body
3. Call to action ("Tap link in bio to shop" or "Available now at vishreastudio.com")
4. 6-10 curated hashtags (e.g. #VishreaStudio #SlowFashionIndia #LuxuryEveryday #OneOfOne)
`,

  social_media: ({ product, tone, platform, length, language, campaign }) => `
Task: Write social media copy for ${platform || 'Pinterest / LinkedIn / Threads'} in ${language || 'English'}.
Tone: ${tone || 'Engaging, aspirational, brand-aligned'}.
${campaign ? `Campaign Theme: ${campaign}` : ''}
${product ? `Piece: ${product.name}, ${product.category || ''}, ₹${product.price_inr}` : ''}

Deliver formatted copy suitable for ${platform || 'multi-platform publication'}.
`,

  campaign_announcement: ({ tone, length, language, campaign, notes }) => `
Task: Create a luxury collection/campaign announcement in ${language || 'English'}.
Tone: ${tone || 'Dramatic, poetic, couture-inspired'}.
Campaign Name/Theme: ${campaign || 'New Seasonal Edit'}
Key Notes/Elements: ${notes || 'Exclusive limited pieces, handcrafted finishes, architectural tailoring'}

Output structure:
1. Campaign Title / Catchphrase
2. Editorial Announcement Statement (suitable for newsletter, press release, or homepage feature)
3. Key Highlights
`,

  homepage_banner: ({ product, tone, campaign }) => `
Task: Write copy for a high-impact homepage carousel banner in English.
Tone: ${tone || 'Minimalist luxury, evocative'}.
${campaign ? `Campaign: ${campaign}` : ''}
${product ? `Featured Piece: ${product.name}` : ''}

Provide 3 distinct options, each containing:
- Headline (max 8 words)
- Subheadline (max 16 words)
- Primary CTA Button Label (e.g. "Discover The Edit", "Explore Pieces")
`,

  seo_metadata: ({ product, campaign }) => `
Task: Generate high-performing SEO Title, Meta Description, and Search Keywords for Vishrea Studio.
${product ? `Product: ${product.name} (${product.category || ''}, ₹${product.price_inr}, ${product.material || ''})` : `Page/Campaign: ${campaign || 'Vishrea Studio Luxury Fashion'}`}

Output format:
- SEO Title (max 60 characters, brand-appended)
- Meta Description (140-155 characters, click-worthy, natural)
- Focus Keywords (5-8 comma-separated terms)
`,

  product_faq: ({ product }) => `
Task: Generate 4 practical, customer-assuring FAQs for this garment.
Product: ${product.name}
Category: ${product.category || 'Apparel'}
Material: ${product.material || 'Care as delicate'}
Price: ₹${product.price_inr}

Address:
1. Fit & sizing guidance
2. Fabric care & wash instructions
3. Styling / occasion suitability
4. Exchange policy note (Vishrea offers hassle-free exchanges)
`,

  customer_reply: ({ inquiry, customerName, product }) => `
Task: Draft a courteous, warm, and professional response to a customer fashion inquiry.
Customer Name: ${customerName || 'Valued Client'}
Inquiry: "${inquiry || 'Looking for sizing recommendations and delivery timeline.'}"
${product ? `Referenced Piece: ${product.name} (₹${product.price_inr})` : ''}

Tone: Polite, attentive, brand-representative of luxury studio hospitality.
Direct the customer clearly without overpromising unverified delivery dates.
`,
};

// Authorised operational and financial data retrieval for admin conversational assistant
async function getOperationalSummary() {
  const [productsCount, lowStock, orderStats, memberStats, memRevStats, recentOrders] = await Promise.all([
    db.query(`SELECT count(*)::int as total, count(*) FILTER (WHERE is_active)::int as active FROM products WHERE archived_at IS NULL`),
    db.query(`SELECT p.name, v.size_label, v.stock_quantity FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.stock_quantity <= 2 AND v.is_active LIMIT 5`),
    db.query(`
      SELECT
        count(*)::int as total_all,
        count(*) FILTER (WHERE payment_status = 'paid')::int as paid_all,
        count(*) FILTER (WHERE payment_status = 'paid' AND COALESCE(paid_at, created_at) >= date_trunc('month', now()))::int as paid_month,
        count(*) FILTER (WHERE payment_status = 'pending' OR status = 'pending_payment')::int as pending,
        count(*) FILTER (WHERE payment_status IN ('expired', 'cancelled', 'failed'))::int as unpaid_or_expired,
        COALESCE(SUM(total) FILTER (WHERE payment_status = 'paid' AND COALESCE(paid_at, created_at) >= date_trunc('month', now())), 0)::numeric(12,2) as revenue_month,
        COALESCE(SUM(total) FILTER (WHERE payment_status = 'paid'), 0)::numeric(12,2) as revenue_all
      FROM orders
    `),
    db.query(`SELECT count(*)::int as total, count(*) FILTER (WHERE status = 'active')::int as active FROM memberships`),
    db.query(`
      SELECT
        count(*) FILTER (WHERE status = 'paid')::int as payments_all,
        count(*) FILTER (WHERE status = 'paid' AND COALESCE(paid_at, attempted_at) >= date_trunc('month', now()))::int as payments_month,
        COALESCE(SUM(amount) FILTER (WHERE status = 'paid' AND COALESCE(paid_at, attempted_at) >= date_trunc('month', now())), 0)::numeric(12,2) as revenue_month,
        COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0)::numeric(12,2) as revenue_all
      FROM membership_payments
    `),
    db.query(`SELECT id, status, payment_status, total, created_at FROM orders ORDER BY created_at DESC LIMIT 5`),
  ]);

  const orderData = orderStats.rows[0] || {};
  const memRevData = memRevStats.rows[0] || {};

  const monthOrderRevenue = Number(orderData.revenue_month || 0);
  const monthMembershipRevenue = Number(memRevData.revenue_month || 0);
  const monthTotalEarnings = monthOrderRevenue + monthMembershipRevenue;

  const allOrderRevenue = Number(orderData.revenue_all || 0);
  const allMembershipRevenue = Number(memRevData.revenue_all || 0);
  const allTimeTotalEarnings = allOrderRevenue + allMembershipRevenue;

  const monthPaidOrders = Number(orderData.paid_month || 0);
  const monthAov = monthPaidOrders > 0 ? Math.round(monthOrderRevenue / monthPaidOrders) : 0;

  return {
    catalogue: {
      total_products: productsCount.rows[0]?.total || 0,
      active_products: productsCount.rows[0]?.active || 0,
      low_stock_samples: lowStock.rows,
    },
    orders: {
      total_orders: orderData.total_all || 0,
      paid_orders_all: orderData.paid_all || 0,
      paid_orders_month: monthPaidOrders,
      pending_orders: orderData.pending || 0,
      unpaid_or_expired: orderData.unpaid_or_expired || 0,
      recent: recentOrders.rows,
    },
    memberships: {
      total: memberStats.rows[0]?.total || 0,
      active: memberStats.rows[0]?.active || 0,
    },
    finance: {
      month_total_earnings: monthTotalEarnings,
      month_order_revenue: monthOrderRevenue,
      month_membership_revenue: monthMembershipRevenue,
      month_paid_orders: monthPaidOrders,
      month_paid_memberships: Number(memRevData.payments_month || 0),
      month_aov: monthAov,
      all_time_total_earnings: allTimeTotalEarnings,
      all_time_order_revenue: allOrderRevenue,
      all_time_membership_revenue: allMembershipRevenue,
      all_time_paid_orders: Number(orderData.paid_all || 0),
      all_time_paid_memberships: Number(memRevData.payments_all || 0),
    },
  };
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

export default async function aiStudio(req, res) {
  const method = req.method;
  const rawAction = String(req.query?.action || req.body?.action || (method === 'POST' ? 'generate' : 'drafts')).trim().toLowerCase().replace(/-/g, '_');
  const action = rawAction === 'chat' ? 'copilot' : rawAction === 'versions' ? 'draft_history' : rawAction;

  // GET /api/admin/ai-studio?action=drafts
  if (method === 'GET' && action === 'drafts') {
    const contentType = req.query?.content_type;
    const status = req.query?.status;
    let query = `
      SELECT d.*, p.name as product_name, p.slug as product_slug
        FROM ai_content_drafts d
        LEFT JOIN products p ON p.id = d.product_id
       WHERE 1=1
    `;
    const params = [];
    if (contentType) {
      params.push(contentType);
      query += ` AND d.content_type = $${params.length}`;
    }
    if (status) {
      params.push(status);
      query += ` AND d.status = $${params.length}`;
    }
    query += ` ORDER BY d.updated_at DESC LIMIT 50`;
    const r = await db.query(query, params);
    return res.json({ drafts: r.rows });
  }

  // GET /api/admin/ai-studio?action=draft_history&draft_id=...
  if (method === 'GET' && (action === 'draft_history' || action === 'history')) {
    const draftId = req.query?.draft_id || req.query?.id;
    if (!draftId) throw new AppError(400, 'draft_id_required', 'Draft ID is required');
    const r = await db.query(
      `SELECT * FROM ai_content_versions WHERE draft_id = $1 ORDER BY version DESC`,
      [draftId]
    );
    return res.json({ versions: r.rows });
  }

  // POST /api/admin/ai-studio?action=generate
  if (method === 'POST' && action === 'generate') {
    const b = req.body || {};
    const tool = b.tool || 'product_description';
    if (!CONTENT_TYPES.includes(tool)) {
      throw new AppError(400, 'invalid_tool', `Valid tools: ${CONTENT_TYPES.join(', ')}`);
    }

    let product = null;
    if (b.product_id) {
      const pRes = await db.query(
        `SELECT p.*, c.name as category, c.slug as category_slug
           FROM products p
           LEFT JOIN categories c ON c.id = p.category_id
          WHERE p.id = $1 LIMIT 1`,
        [b.product_id]
      );
      if (pRes.rows[0]) {
        product = pRes.rows[0];
      }
    }

    const generator = PROMPT_TEMPLATES[tool];
    if (!generator) {
      throw new AppError(400, 'unsupported_tool', `Tool ${tool} is not supported.`);
    }

    const prompt = generator({
      product,
      tone: b.tone,
      platform: b.platform,
      length: b.length,
      language: b.language,
      campaign: b.campaign,
      inquiry: b.inquiry,
      customerName: b.customer_name,
      notes: b.notes,
    });

    try {
      const result = await ai.generateText({
        system: 'You are the Vishrea AI Studio content engine. You craft exquisite, grounded, verified fashion editorial copy for Vishrea Studio. Never invent unverified technical attributes or fabric compositions. Maintain brand voice: sophisticated, contemporary, mindful Indian luxury. STRICT NO-STARS RULE: Strictly do NOT use markdown bold asterisks or stars (never use **word** or *word*). Present copy in clean, direct text.',
        prompt,
        maxTokens: 1000,
        temperature: 0.7,
      });

      return res.json({
        ok: true,
        tool,
        generated_content: stripStars(result.text),
        provider: result.provider || 'primary',
        product_used: product ? { id: product.id, name: product.name, slug: product.slug } : null,
        approval_required: true,
      });
    } catch (err) {
      log.error('ai_studio.generate_failed', { message: err.message });
      throw new AppError(502, 'ai_unavailable', `AI generation service error: ${err.message}. If OpenAI quota is low, configure GROQ_CLOUD_API_KEY in .env.`);
    }
  }

  // POST /api/admin/ai-studio?action=copilot (or chat)
  if (method === 'POST' && (action === 'copilot' || action === 'chat')) {
    const messages = req.body?.messages || req.body?.history || [];
    const userPrompt = req.body?.message || '';

    // Fetch operational and financial context to ground answers
    const ops = await getOperationalSummary();
    const systemPrompt = `You are the Vishrea AI Studio Assistant, an intelligent operational, creative, and financial co-pilot for Vishrea Studio administrators.
You assist with answering questions about store revenue and earnings, drafting content, analyzing catalogue inventory, and summarizing authorized operational metrics.

Deterministic Grounded Operational & Financial Snapshot:
1. Current Month Earnings (Rule-Based Verified Calculations):
- Total Studio Earnings This Month: ₹${ops.finance.month_total_earnings.toLocaleString('en-IN')}
- Store Order Revenue: ₹${ops.finance.month_order_revenue.toLocaleString('en-IN')} (from ${ops.finance.month_paid_orders} paid orders)
- Walkin Wardrobe Membership Revenue: ₹${ops.finance.month_membership_revenue.toLocaleString('en-IN')} (from ${ops.finance.month_paid_memberships} paid mandate charges)
- Average Order Value (AOV): ₹${ops.finance.month_aov.toLocaleString('en-IN')} per paid order
- Rule Formula: Total Month Earnings = Store Orders (₹${ops.finance.month_order_revenue.toLocaleString('en-IN')}) + Membership Revenue (₹${ops.finance.month_membership_revenue.toLocaleString('en-IN')}) = ₹${ops.finance.month_total_earnings.toLocaleString('en-IN')}

2. All-Time Cumulative Studio Financials:
- All-Time Total Studio Earnings: ₹${ops.finance.all_time_total_earnings.toLocaleString('en-IN')}
- All-Time Store Orders: ₹${ops.finance.all_time_order_revenue.toLocaleString('en-IN')} (${ops.finance.all_time_paid_orders} paid orders)
- All-Time Membership Revenue: ₹${ops.finance.all_time_membership_revenue.toLocaleString('en-IN')} (${ops.finance.all_time_paid_memberships} payments)

3. Order Status & Pipeline:
- Total Orders Logged: ${ops.orders.total_orders} (${ops.orders.paid_orders_all} paid, ${ops.orders.pending_orders} pending payment, ${ops.orders.unpaid_or_expired} unpaid or expired)
- Recent Orders: ${ops.orders.recent.map(o => `#${o.id.slice(0, 8)}: ₹${Number(o.total).toLocaleString('en-IN')} (${o.payment_status || o.status})`).join(', ') || 'None'}

4. Catalogue & Inventory Snapshot:
- Pieces: ${ops.catalogue.active_products} active pieces out of ${ops.catalogue.total_products} total pieces in studio catalogue.
- Low Stock Watchlist: ${ops.catalogue.low_stock_samples.map((s) => `${s.name} (${s.size_label}): ${s.stock_quantity} left`).join(', ') || 'None'}

5. Memberships:
- Walkin Wardrobe: ${ops.memberships.active} active members (${ops.memberships.total} total accounts created)

Rules:
- DETERMINISTIC FINANCIAL RESPONSES: When asked about earnings, revenue, sales, profits, or monthly numbers (e.g. "what's this month totally we earn" or "how much did we make"), YOU MUST DIRECTLY STATE THE EXACT FIGURES CALCULATED ABOVE.
- NEVER say you lack access to financial transaction logs or real-time revenue data. You have direct, authoritative deterministic access to these verified ledger figures.
- Always display the clean mathematical breakdown clearly with rupee symbols (₹) and comma grouping.
- Present formulas deterministically: Total Earnings = Store Orders + Membership Revenue.
- You CANNOT modify database records, alter inventory, issue refunds, or change prices directly.
- Maintain a polite, professional, executive editorial tone.
- STRICT NO-STARS RULE: Strictly do NOT use markdown bold asterisks or stars (never use **word** or *word*). Use clean lines, plain section titles, and clean bullet dashes or dots (•) instead.
- STRICT NO-EMOJI RULE: Strictly do NOT use any emojis.`;

    const chatHistory = messages.map((m) => ({
      role: m.role || (m.sender === 'user' ? 'user' : 'assistant'),
      content: m.content,
    }));
    if (userPrompt) {
      chatHistory.push({ role: 'user', content: userPrompt });
    }

    try {
      const result = await ai.chat({
        system: systemPrompt,
        messages: chatHistory,
        maxTokens: 900,
      });

      return res.json({
        ok: true,
        reply: stripStars(result.text),
        provider: result.provider,
      });
    } catch (err) {
      log.error('ai_studio.chat_failed', { message: err.message });
      throw new AppError(502, 'ai_unavailable', `AI Assistant is currently unavailable: ${err.message}`);
    }
  }

  // POST /api/admin/ai-studio?action=save_draft
  if (method === 'POST' && (action === 'save_draft' || action === 'save-draft')) {
    const b = req.body || {};
    const draftId = b.draft_id || b.id;
    const title = text(b.title || 'Untitled Draft', { max: 200, field: 'title' });
    const content = text(b.content, { max: 10_000, field: 'content', required: true });
    const contentType = text(b.content_type || 'product_description', { max: 80, field: 'content_type' });
    const productId = b.product_id || null;
    const inputContext = b.input_context || {};

    if (draftId) {
      // Update existing draft and increment version
      const existing = await db.query(`SELECT * FROM ai_content_drafts WHERE id = $1`, [draftId]);
      if (!existing.rows[0]) throw new AppError(404, 'not_found', 'Draft not found');

      const nextVersion = existing.rows[0].version + 1;
      const updated = await db.query(
        `UPDATE ai_content_drafts
            SET content = $1, title = $2, version = $3, updated_at = now()
          WHERE id = $4
          RETURNING *`,
        [content, title, nextVersion, draftId]
      );

      // Record version history
      await db.query(
        `INSERT INTO ai_content_versions (draft_id, version, content, notes)
         VALUES ($1, $2, $3, $4)`,
        [draftId, nextVersion, content, b.version_notes || 'Updated draft']
      );

      return res.json({ ok: true, draft: updated.rows[0] });
    }

    // Create new draft
    const inserted = await db.query(
      `INSERT INTO ai_content_drafts (admin_user_id, product_id, content_type, title, content, input_context, status, version)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft', 1)
       RETURNING *`,
      [req.user.id, productId, contentType, title, content, JSON.stringify(inputContext)]
    );

    const draft = inserted.rows[0];
    await db.query(
      `INSERT INTO ai_content_versions (draft_id, version, content, notes)
       VALUES ($1, 1, $2, 'Initial draft')`,
      [draft.id, content]
    );

    return res.json({ ok: true, draft });
  }

  // POST or PUT /api/admin/ai-studio?action=approve
  if ((method === 'POST' || method === 'PUT') && action === 'approve') {
    const draftId = req.body?.draft_id || req.body?.id;
    if (!draftId) throw new AppError(400, 'draft_id_required', 'Draft ID required');
    const updated = await db.query(
      `UPDATE ai_content_drafts
          SET status = 'approved', updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [draftId]
    );
    if (!updated.rows[0]) throw new AppError(404, 'not_found', 'Draft not found');
    return res.json({ ok: true, draft: updated.rows[0] });
  }

  // POST /api/admin/ai-studio?action=publish
  // Publishes approved content to the respective store section with explicit admin confirmation
  if (method === 'POST' && action === 'publish') {
    const draftId = req.body?.draft_id || req.body?.id;
    if (!draftId) throw new AppError(400, 'draft_id_required', 'Draft ID required');

    const draftRes = await db.query(`SELECT * FROM ai_content_drafts WHERE id = $1`, [draftId]);
    const draft = draftRes.rows[0];
    if (!draft) throw new AppError(404, 'not_found', 'Draft not found');

    if (draft.status !== 'approved' && !req.body?.force) {
      throw new AppError(400, 'approval_required', 'Content must be approved by an administrator before publishing.');
    }

    // Product description publication
    if (draft.content_type === 'product_description' && draft.product_id) {
      await db.query(
        `UPDATE products SET description = $1, updated_at = now() WHERE id = $2`,
        [draft.content, draft.product_id]
      );
      await db.query(`UPDATE ai_content_drafts SET status = 'published', updated_at = now() WHERE id = $1`, [draftId]);
      log.info('ai_studio.published_product_description', { product_id: draft.product_id, admin: req.user.id });
      return res.json({ ok: true, message: 'Product description published successfully to the live catalogue!' });
    }

    // Default publication mark
    await db.query(`UPDATE ai_content_drafts SET status = 'published', updated_at = now() WHERE id = $1`, [draftId]);
    return res.json({ ok: true, message: `Draft marked as published.` });
  }

  // DELETE /api/admin/ai-studio?action=delete
  if (method === 'DELETE' || (method === 'POST' && action === 'delete')) {
    const draftId = req.query?.draft_id || req.query?.id || req.body?.draft_id || req.body?.id;
    if (!draftId) throw new AppError(400, 'draft_id_required', 'Draft ID required');
    await db.query(`DELETE FROM ai_content_drafts WHERE id = $1`, [draftId]);
    return res.json({ ok: true, message: 'Draft deleted.' });
  }

  throw new AppError(400, 'invalid_action', `Unsupported action: ${action}`);
}

