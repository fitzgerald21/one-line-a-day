// Groq Whisper (speech → text) and OpenRouter / DeepInfra (LLM summaries, vision).
import { getSettings } from './store.js';

export const PROVIDERS = {
  openrouter: {
    label: 'OpenRouter',
    chat: 'https://openrouter.ai/api/v1/chat/completions',
    models: 'https://openrouter.ai/api/v1/models',
    keyUrl: 'https://openrouter.ai/keys',
  },
  deepinfra: {
    label: 'DeepInfra',
    chat: 'https://api.deepinfra.com/v1/openai/chat/completions',
    models: 'https://api.deepinfra.com/v1/openai/models',
    keyUrl: 'https://deepinfra.com/dash/api_keys',
  },
};

export const WHISPER_MODELS = [
  ['whisper-large-v3-turbo', 'Whisper large v3 turbo (fast, cheap)'],
  ['whisper-large-v3', 'Whisper large v3 (most accurate)'],
];

// ---- model catalogue -------------------------------------------------------
const MODEL_TTL = 12 * 3600 * 1000;

function fromOpenRouter(m) {
  if (!m.architecture?.output_modalities?.includes('text')) return null;
  const inp = parseFloat(m.pricing?.prompt) * 1e6;
  const out = parseFloat(m.pricing?.completion) * 1e6;
  if (!(inp >= 0) || !(out >= 0)) return null; // router/auto models report -1
  return {
    id: m.id,
    name: m.name || m.id,
    inPrice: inp,
    outPrice: out,
    ctx: m.context_length || 0,
    free: inp === 0 && out === 0,
    vision: !!m.architecture?.input_modalities?.includes('image'),
    reasoning: !!m.supported_parameters?.includes('reasoning'),
    created: m.created || 0,
  };
}
function fromDeepInfra(m) {
  const meta = m.metadata;
  const tags = meta?.tags || [];
  if (!meta || !tags.includes('chat')) return null;
  const inp = meta.pricing?.input_tokens ?? 0;
  const out = meta.pricing?.output_tokens ?? 0;
  return {
    id: m.id,
    name: m.id,
    inPrice: inp,
    outPrice: out,
    ctx: meta.context_length || 0,
    free: inp === 0 && out === 0,
    vision: tags.includes('vision') || tags.includes('vlm'),
    reasoning: tags.includes('reasoning'),
    created: m.created || 0,
  };
}

export async function loadModels(provider, { force = false } = {}) {
  const ck = `olad.models.${provider}`;
  if (!force) {
    try {
      const c = JSON.parse(localStorage.getItem(ck));
      if (c && Date.now() - c.t < MODEL_TTL && c.list?.length) return c.list;
    } catch { /* ignore */ }
  }
  const res = await fetch(PROVIDERS[provider].models);
  if (!res.ok) throw new Error(`Could not load the ${PROVIDERS[provider].label} model list (${res.status}).`);
  const json = await res.json();
  const conv = provider === 'openrouter' ? fromOpenRouter : fromDeepInfra;
  const list = (json.data || []).map(conv).filter(Boolean);
  try { localStorage.setItem(ck, JSON.stringify({ t: Date.now(), list })); } catch { /* quota */ }
  return list;
}

export const fmtPrice = (p) => (p === 0 ? 'free' : p < 0.1 ? `$${p.toFixed(3)}` : p < 10 ? `$${p.toFixed(2)}` : `$${p.toFixed(0)}`);
export const fmtCtx = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n || '?'));
/** Rough cost of one summary (~450 tokens in, ~90 out). */
export const summaryCost = (m) => (m.inPrice * 450 + m.outPrice * 90) / 1e6;
export function fmtCost(usd) {
  if (usd === 0) return 'free';
  if (usd < 0.0001) return '< $0.0001';
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(3)}`;
}

// ---- chat ------------------------------------------------------------------
async function errorFrom(res) {
  let msg = `${res.status} ${res.statusText}`;
  try {
    const j = await res.json();
    msg = j.error?.message || j.error || j.message || j.detail || msg;
    if (typeof msg === 'object') msg = JSON.stringify(msg);
  } catch { /* keep default */ }
  return new Error(msg);
}

export async function chat({ provider, model, messages, temperature = 0.3, maxTokens = 600, signal }) {
  const s = getSettings();
  const key = s.keys[provider];
  if (!key) throw new Error(`Add your ${PROVIDERS[provider].label} API key in Settings first.`);
  if (!model) throw new Error('Pick a model in Settings first.');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = location.origin;
    headers['X-Title'] = 'One Line a Day';
  }
  const res = await fetch(PROVIDERS[provider].chat, {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
  });
  if (!res.ok) throw await errorFrom(res);
  const data = await res.json();
  const choice = data.choices?.[0];
  let text = choice?.message?.content;
  if (Array.isArray(text)) text = text.map((p) => p.text || '').join('');
  text = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!text) {
    throw new Error(choice?.finish_reason === 'length'
      ? 'The model ran out of tokens while "thinking". Pick a non-reasoning model in Settings.'
      : 'The model returned an empty answer.');
  }
  return text;
}

export async function summarize(text, { signal } = {}) {
  const { ai } = getSettings();
  const target = Math.max(60, +ai.summaryChars || 200);
  const system = [
    'You condense a person\'s rambling diary notes (typed or dictated, possibly with speech-recognition slips and filler) into the short entry they would write in a "One Line a Day" five-year memory book.',
    'Write in the first person, past tense, in a natural voice that sounds like them. Keep names, places and the specific details or feelings worth remembering; drop filler, repetition and play-by-play.',
    `Aim for about ${target} characters (never more than ${Math.round(target * 1.5)}). Use one to three short sentences, or a compact list separated by semicolons if that reads better.`,
    'Output ONLY the entry text: no quotes, preamble, markdown or emoji. Keep the language of the original.',
    ai.extra?.trim() ? `Extra preferences from the user: ${ai.extra.trim()}` : '',
  ].filter(Boolean).join('\n');
  const out = await chat({
    provider: ai.provider,
    model: ai.model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: text }],
    temperature: 0.3,
    maxTokens: 700,
    signal,
  });
  return out.replace(/^["“]|["”]$/g, '').trim();
}

// ---- speech to text --------------------------------------------------------
export async function transcribe(blob, { signal } = {}) {
  const { keys, whisper } = getSettings();
  if (!keys.groq) throw new Error('Add your Groq API key in Settings first.');
  const type = blob.type || 'audio/webm';
  const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : 'webm';
  const form = new FormData();
  form.append('file', new File([blob], `entry.${ext}`, { type }));
  form.append('model', whisper.model || 'whisper-large-v3-turbo');
  form.append('response_format', 'json');
  form.append('temperature', '0');
  if (whisper.language) form.append('language', whisper.language);
  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${keys.groq}` },
    body: form,
    signal,
  });
  if (!res.ok) throw await errorFrom(res);
  const data = await res.json();
  return String(data.text || '').trim();
}

export async function testGroqKey(key) {
  const res = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw await errorFrom(res);
  return true;
}
export async function testChatKey(provider, key) {
  // OpenRouter exposes a cheap key check; DeepInfra has no public one, so list models with auth.
  const url = provider === 'openrouter' ? 'https://openrouter.ai/api/v1/auth/key' : 'https://api.deepinfra.com/v1/openai/models';
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw await errorFrom(res);
  return true;
}

// ---- photo import (vision) -------------------------------------------------
const IMPORT_PROMPT = `You are transcribing a photo of a "One Line A Day: A Five-Year Memory Book". Each page is headed by a month and day (for example "MARCH 18") and has up to five stacked sections, each marked with a printed "20" whose last two digits are handwritten (for example 2025). Handwritten diary text follows each year mark.

Return ONLY valid JSON in exactly this shape:
{"pages":[{"month":3,"day":18,"entries":[{"year":2025,"text":"..."}]}]}

Rules:
- Include every page visible in the photo, left page first. month is 1-12.
- Include only sections that contain handwriting; skip empty sections.
- Transcribe the handwriting faithfully as written (do not summarize or fix wording). Join wrapped lines into normal sentences.
- If a year or date is unreadable, use null and add a short "note" on that entry or page.`;

export async function readJournalPhoto(dataUrl, { provider, model, signal }) {
  const text = await chat({
    provider,
    model,
    temperature: 0,
    maxTokens: 3000,
    signal,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: IMPORT_PROMPT },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    }],
  });
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('The model did not return JSON. Try another vision model.');
  const json = JSON.parse(text.slice(a, b + 1));
  return Array.isArray(json.pages) ? json.pages : [];
}
