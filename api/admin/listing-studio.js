import { ai } from '../../lib/ai.js';
import { AppError } from '../../lib/http.js';
import { text } from '../../lib/validate.js';

export const access = 'admin';
export const methods = ['POST'];
export const rateLimitPerUser = { windowMs: 60 * 60_000, max: 60 };

const field = (v, max) => (text(v, { max, field: 'input' }) || '').replace(/[\r\n]+/g, ' ');

export default async function listingStudio(req, res) {
  const b = req.body || {};
  const category = text(b.category, { max: 80, field: 'category', required: true });
  const prompt = `Return JSON only with keys: title, description, category, occasion, colour, colour_season, fabric, suggested_price_inr, hsn_code, tags.
Never publish or change inventory. Owner-supplied facts:
category=${category}; occasion=${field(b.occasion, 80)}; colour=${field(b.colour, 80)}; fabric=${field(b.fabric, 120)};
cost_price_inr=${Number(b.cost_price_inr) || 0}; supplier=${field(b.supplier, 120)}; notes=${field(b.notes, 500)}.`;
  try {
    const r = await ai.generateText({
      system: 'You write concise premium Indian fashion e-commerce copy. Use only the owner-supplied facts; never invent material or origin claims.',
      prompt,
      maxTokens: 700,
    });
    const raw = String(r.text || '').replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const data = JSON.parse(raw);
    const suggestion = {
      title: String(data.title || '').slice(0, 160),
      description: String(data.description || '').slice(0, 2000),
      category: String(data.category || category).slice(0, 80),
      occasion: String(data.occasion || '').slice(0, 80),
      colour: String(data.colour || '').slice(0, 60),
      colour_season: String(data.colour_season || '').slice(0, 40),
      fabric: String(data.fabric || '').slice(0, 120),
      suggested_price_inr: Math.max(0, Math.round(Number(data.suggested_price_inr) || 0)),
      hsn_code: String(data.hsn_code || '6204').replace(/[^0-9]/g, '').slice(0, 8) || '6204',
      tags: Array.isArray(data.tags) ? data.tags.slice(0, 10).map((t) => String(t).slice(0, 30)) : [],
    };
    res.json({ suggestion, approval_required: true });
  } catch (err) {
    throw new AppError(502, 'listing_ai_unavailable', 'The AI listing assistant is unavailable. You can enter the listing manually.');
  }
}
