// Universal AI client adapter with Groq Cloud fallback
// Supports OpenAI API as primary, with automatic Groq Cloud fallback
import dotenv from 'dotenv';
import { log } from './log.js';

dotenv.config();

export const ai = {
  async generateText({
    model = 'gpt-4o-mini',
    system = '',
    prompt = '',
    messages = null,
    maxTokens = 800,
    temperature = 0.7,
  }) {
    const chatMessages = [];
    if (system) {
      chatMessages.push({ role: 'system', content: system });
    }
    if (Array.isArray(messages) && messages.length > 0) {
      for (const m of messages) {
        if (m.role && m.content) {
          chatMessages.push({ role: m.role, content: m.content });
        }
      }
    } else if (prompt) {
      chatMessages.push({ role: 'user', content: prompt });
    }

    const openAiKey = (process.env.OPENAI_API_KEY || '').trim();
    const openAiBase = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const openAiModel = process.env.AI_MODEL || model || 'gpt-4o-mini';

    const groqKey = (process.env.GROQ_CLOUD_API_KEY || process.env.GROQ_API_KEY || '').trim();
    const groqBase = (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, '');
    const groqModel = process.env.GROQ_AI_MODEL || 'llama-3.3-70b-versatile';

    // Helper to call OpenAI-compatible completion endpoint
    const callProvider = async (baseUrl, apiKey, reqModel, providerName) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 35_000);
      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          signal: controller.signal,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: reqModel,
            messages: chatMessages,
            max_tokens: maxTokens,
            temperature,
          }),
        });

        if (!response.ok) {
          const errBody = await response.text().catch(() => '');
          throw new Error(`${providerName} HTTP ${response.status}: ${errBody.slice(0, 300)}`);
        }

        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || '';
        return { text, provider: providerName, model: reqModel };
      } finally {
        clearTimeout(timer);
      }
    };

    // 1. Try OpenAI if key is present
    if (openAiKey) {
      try {
        return await callProvider(openAiBase, openAiKey, openAiModel, 'openai');
      } catch (err) {
        log.warn('ai.openai_failed', { message: err.message });
        if (groqKey) {
          log.info('ai.falling_back_to_groq', { model: groqModel });
          try {
            return await callProvider(groqBase, groqKey, groqModel, 'groq');
          } catch (groqErr) {
            log.error('ai.groq_failed', { message: groqErr.message });
            throw new Error(`Both AI providers failed (OpenAI: ${err.message}; Groq: ${groqErr.message})`);
          }
        }
        throw err;
      }
    }

    // 2. If OpenAI key is missing but Groq is present, call Groq directly
    if (groqKey) {
      try {
        return await callProvider(groqBase, groqKey, groqModel, 'groq');
      } catch (groqErr) {
        log.error('ai.groq_direct_failed', { message: groqErr.message });
        throw groqErr;
      }
    }

    throw new Error('Neither OPENAI_API_KEY nor GROQ_CLOUD_API_KEY is configured.');
  },

  async chat(args) {
    return this.generateText(args);
  },
};
