'use strict';

// Text + vision models verified against official catalogs on 17 October 2026.
// Access depends on the provider account. Keep custom IDs available for updates.
const MODEL_CATALOG = Object.freeze({
  openai: [
    { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol · balanced' },
    { id: 'gpt-6-astra', name: 'GPT-6 Astra · advanced reasoning' },
    { id: 'gpt-6-luna', name: 'GPT-6 Luna · fast and economical' },
    { id: 'chat-latest', name: 'ChatGPT · latest Instant' }
  ],
  anthropic: [
    { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5 · balanced' },
    { id: 'claude-opus-5-5', name: 'Claude Opus 5.5 · advanced' },
    { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5 · fast' },
    { id: 'claude-fable-5-1', name: 'Claude Fable 5.1 · deep reasoning' }
  ],
  gemini: [
    { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash · balanced' },
    { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro · preview' },
    { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite · economical' },
    { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash' },
    { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite' },
    { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash · preview' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro · legacy access' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash · legacy access' }
  ]
});
const PROVIDERS = Object.freeze(['anthropic', 'gemini', 'openai']);
const PROVIDER_NAMES = Object.freeze({ anthropic: 'Claude', gemini: 'Gemini', openai: 'OpenAI / ChatGPT' });
module.exports = { MODEL_CATALOG, PROVIDERS, PROVIDER_NAMES };
