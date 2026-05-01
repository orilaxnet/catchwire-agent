/**
 * LLM Router — selects provider, handles retry with self-correction, and fallback
 */

import type { LLMConfig, LLMProvider } from '../types/index.ts';
import { logger } from '../utils/logger.ts';

// Extract JSON from LLM response — handles plain JSON, markdown code blocks, and embedded JSON
function extractJSON(raw: string): any {
  const s = raw.trim();
  // Try direct parse first
  try { return JSON.parse(s); } catch {}
  // Strip markdown code fences: ```json ... ``` or ``` ... ```
  const fence = s.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch {} }
  // Extract first {...} block
  const obj = s.match(/(\{[\s\S]+\})/);
  if (obj) { try { return JSON.parse(obj[1]); } catch {} }
  throw new Error(`No valid JSON found in LLM response: ${s.slice(0, 120)}`);
}

export interface LLMOptions {
  maxTokens?:   number;
  temperature?: number;
  system?:      string;
}

export interface LLMProvider_I {
  complete(prompt: string, options?: LLMOptions): Promise<string>;
  isAvailable(): Promise<boolean>;
}

// ─────────────────────────────────────────────────────────────

export class LLMRouter {
  private primaryConfig:  LLMConfig;
  private fallbackConfig?: LLMConfig;

  constructor(config: LLMConfig) {
    this.primaryConfig  = config;
    this.fallbackConfig = config.fallback;
  }

  async complete(prompt: string, options?: LLMOptions): Promise<string> {
    try {
      const provider = this.buildProvider(this.primaryConfig);
      return await provider.complete(prompt, options);
    } catch (primaryError) {
      if (this.fallbackConfig) {
        logger.warn('Primary LLM failed, trying fallback', {
          primary:  this.primaryConfig.provider,
          fallback: this.fallbackConfig.provider,
        });

        const fallback = this.buildProvider(this.fallbackConfig);
        return await fallback.complete(prompt, options);
      }
      throw primaryError;
    }
  }

  async completeWithRetry<T>(
    prompt: string,
    validate: (raw: any) => T,
    maxRetries = 2,
    options?: LLMOptions
  ): Promise<T> {
    let lastError: Error | undefined;
    let currentPrompt = prompt;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const raw = await this.complete(currentPrompt, options);

      try {
        // Try to extract JSON from the raw string before validating
        const parsed = extractJSON(raw);
        return validate(parsed);
      } catch (err) {
        lastError = err as Error;
        logger.debug(`LLM output invalid (attempt ${attempt + 1})`, { error: (err as Error).message });
        currentPrompt = prompt + `\n\n---\nPrevious output:\n${raw}\n\nError: ${lastError.message}\nPlease return valid JSON only, no extra text.`;
      }
    }

    throw new Error(`LLM failed after ${maxRetries + 1} attempts: ${lastError?.message}`);
  }

  async isAvailable(): Promise<boolean> {
    try {
      const provider = this.buildProvider(this.primaryConfig);
      return await provider.isAvailable();
    } catch {
      return false;
    }
  }

  async validateConnection(config: LLMConfig): Promise<boolean> {
    try {
      const provider = this.buildProvider(config);
      return await provider.isAvailable();
    } catch {
      return false;
    }
  }

  private buildProvider(config: LLMConfig): LLMProvider_I {
    switch (config.provider) {
      case 'openai':
        return new OpenAIProvider(config);
      case 'gemini':
        return new GeminiProvider(config);
      case 'claude':
        return new ClaudeProvider(config);
      case 'openrouter':
        return new OpenRouterProvider(config);
      case 'ollama':
        return new OllamaProvider(config);
      case 'custom':
        return new CustomProvider(config);
      case 'grok':
        return new CustomProvider({ ...config, baseUrl: config.baseUrl || 'https://api.x.ai/v1' });
      default:
        throw new Error(`Unknown LLM provider: ${config.provider}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// OpenRouter Provider (single API for all models)
// ─────────────────────────────────────────────────────────────

class OpenRouterProvider implements LLMProvider_I {
  constructor(private config: LLMConfig) {}

  async complete(prompt: string, options?: LLMOptions): Promise<string> {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/email-agent',
        'X-Title': 'Email Agent'
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          ...(options?.system ? [{ role: 'system', content: options.system }] : []),
          { role: 'user', content: prompt }
        ],
        max_tokens:  options?.maxTokens  ?? 2048,
        temperature: options?.temperature ?? 0.3
      })
    });

    if (!response.ok) {
      logger.error('OpenRouter request failed', { status: response.status });
      throw new Error(`LLM request failed (${response.status})`);
    }

    const data = await response.json() as any;
    return data.choices[0]?.message?.content ?? '';
  }

  async isAvailable(): Promise<boolean> {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${this.config.apiKey}` }
      });
      return r.ok;
    } catch {
      return false;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// OpenAI Provider
// ─────────────────────────────────────────────────────────────

class OpenAIProvider implements LLMProvider_I {
  constructor(private config: LLMConfig) {}

  async complete(prompt: string, options?: LLMOptions): Promise<string> {
    const { OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: this.config.apiKey });

    const response = await client.chat.completions.create({
      model: this.config.model || 'gpt-4o-mini',
      messages: [
        ...(options?.system ? [{ role: 'system' as const, content: options.system }] : []),
        { role: 'user' as const, content: prompt }
      ],
      max_tokens:  options?.maxTokens  ?? 2048,
      temperature: options?.temperature ?? 0.3,
      response_format: { type: 'json_object' }  // Force JSON output
    });

    return response.choices[0]?.message?.content ?? '';
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { OpenAI } = await import('openai');
      const client = new OpenAI({ apiKey: this.config.apiKey });
      await client.models.list();
      return true;
    } catch {
      return false;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Google Gemini Provider
// ─────────────────────────────────────────────────────────────

class GeminiProvider implements LLMProvider_I {
  constructor(private config: LLMConfig) {}

  async complete(prompt: string, options?: LLMOptions): Promise<string> {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(this.config.apiKey!);
    const model = genAI.getGenerativeModel({ model: this.config.model || 'gemini-1.5-flash' });

    const fullPrompt = options?.system
      ? `${options.system}\n\n${prompt}`
      : prompt;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
      generationConfig: {
        maxOutputTokens:  options?.maxTokens  ?? 2048,
        temperature:      options?.temperature ?? 0.3,
        responseMimeType: 'application/json',
      },
    } as any);

    return result.response.text();
  }

  async isAvailable(): Promise<boolean> {
    return !!this.config.apiKey;
  }
}

// ─────────────────────────────────────────────────────────────
// Anthropic Claude Provider
// ─────────────────────────────────────────────────────────────

class ClaudeProvider implements LLMProvider_I {
  constructor(private config: LLMConfig) {}

  async complete(prompt: string, options?: LLMOptions): Promise<string> {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: this.config.apiKey });

    const response = await client.messages.create({
      model: this.config.model || 'claude-haiku-4-5-20251001',
      max_tokens: options?.maxTokens ?? 2048,
      ...(options?.system ? { system: options.system } : {}),
      messages: [{ role: 'user', content: prompt }]
    });

    return (response.content[0] as any).text ?? '';
  }

  async isAvailable(): Promise<boolean> {
    return !!this.config.apiKey;
  }
}

// ─────────────────────────────────────────────────────────────
// Ollama (Local) Provider
// ─────────────────────────────────────────────────────────────

class OllamaProvider implements LLMProvider_I {
  private baseUrl: string;

  constructor(private config: LLMConfig) {
    this.baseUrl = config.baseUrl || 'http://localhost:11434';
  }

  async complete(prompt: string, options?: LLMOptions): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:  this.config.model || 'llama3.2',
        prompt: options?.system ? `${options.system}\n\n${prompt}` : prompt,
        stream: false,
        options: {
          temperature: options?.temperature ?? 0.3,
          num_predict: options?.maxTokens  ?? 2048
        },
        format: 'json'
      })
    });

    if (!response.ok) throw new Error(`Ollama error: ${response.status}`);

    const data = await response.json() as any;
    return data.response ?? '';
  }

  async isAvailable(): Promise<boolean> {
    try {
      const r = await fetch(`${this.baseUrl}/api/tags`);
      return r.ok;
    } catch {
      return false;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Custom (OpenAI-compatible) Provider
// ─────────────────────────────────────────────────────────────

class CustomProvider implements LLMProvider_I {
  constructor(private config: LLMConfig) {}

  async complete(prompt: string, options?: LLMOptions): Promise<string> {
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey ? { 'Authorization': `Bearer ${this.config.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          ...(options?.system ? [{ role: 'system', content: options.system }] : []),
          { role: 'user', content: prompt }
        ],
        max_tokens:       options?.maxTokens  ?? 2048,
        temperature:      options?.temperature ?? 0.3,
        response_format:  { type: 'json_object' },
      })
    });

    if (!response.ok) {
      logger.error('Custom LLM request failed', { status: response.status });
      throw new Error(`LLM request failed (${response.status})`);
    }

    const data = await response.json() as any;
    return data.choices[0]?.message?.content ?? '';
  }

  async isAvailable(): Promise<boolean> {
    try {
      const r = await fetch(`${this.config.baseUrl}/models`);
      return r.ok;
    } catch {
      return false;
    }
  }
}
