#!/usr/bin/env node
/**
 * Idempotently provisions the voice side of the system on Vapi:
 *   1. creates or updates the assistant (prompt, tools, voice, webhook URL)
 *   2. creates a free Vapi U.S. phone number (or reuses ours) bound to it
 *
 * Usage:
 *   VAPI_API_KEY=... PUBLIC_BASE_URL=https://your-app.example.com npm run setup:vapi
 * Optional: VAPI_WEBHOOK_SECRET, VAPI_PHONE_AREA_CODE, CLINIC_NAME, CLINIC_TIMEZONE,
 *           VAPI_MODEL_PROVIDER / VAPI_MODEL, VAPI_VOICE_PROVIDER / VAPI_VOICE_ID / VAPI_VOICE_MODEL
 */
import { config } from '../src/config.js';
import { buildAssistantConfig } from '../src/voice/assistant.js';

const API = 'https://api.vapi.ai';
const { VAPI_API_KEY, PUBLIC_BASE_URL } = process.env;
const NUMBER_NAME = 'Patient Intake Line';

if (!VAPI_API_KEY || !PUBLIC_BASE_URL) {
  console.error('VAPI_API_KEY and PUBLIC_BASE_URL are required.');
  process.exit(1);
}

async function vapi(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${VAPI_API_KEY}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return data;
}

const env = process.env;
const assistantConfig = buildAssistantConfig({
  publicBaseUrl: PUBLIC_BASE_URL,
  webhookSecret: config.vapiWebhookSecret,
  clinicName: config.clinicName,
  timezone: config.clinicTimezone,
  ...(env.VAPI_MODEL ? { model: { provider: env.VAPI_MODEL_PROVIDER || 'openai', model: env.VAPI_MODEL } } : {}),
  ...(env.VAPI_VOICE_ID ? {
    voice: {
      provider: env.VAPI_VOICE_PROVIDER || '11labs',
      voiceId: env.VAPI_VOICE_ID,
      ...(env.VAPI_VOICE_MODEL ? { model: env.VAPI_VOICE_MODEL } : {}),
    },
  } : {}),
});

const assistants = await vapi('GET', '/assistant?limit=100');
const existing = assistants.find((a) => a.name === assistantConfig.name);
const assistant = existing
  ? await vapi('PATCH', `/assistant/${existing.id}`, assistantConfig)
  : await vapi('POST', '/assistant', assistantConfig);
console.log(`${existing ? 'Updated' : 'Created'} assistant ${assistant.id}`);

const numbers = await vapi('GET', '/phone-number?limit=100');
let phone = numbers.find((n) => n.name === NUMBER_NAME || n.assistantId === assistant.id);
if (phone) {
  phone = await vapi('PATCH', `/phone-number/${phone.id}`, { assistantId: assistant.id });
} else {
  // Free Vapi numbers need an area code and availability varies, so try a few.
  const areaCodes = env.VAPI_PHONE_AREA_CODE
    ? [env.VAPI_PHONE_AREA_CODE]
    : ['415', '628', '510', '346', '737', '512', '646', '929', '470', '321', '531', '930'];
  for (const numberDesiredAreaCode of areaCodes) {
    try {
      phone = await vapi('POST', '/phone-number', {
        provider: 'vapi', name: NUMBER_NAME, assistantId: assistant.id, numberDesiredAreaCode,
      });
      break;
    } catch (err) {
      console.warn(`Area code ${numberDesiredAreaCode} unavailable: ${err.message}`);
    }
  }
  if (!phone) throw new Error('Could not provision a phone number in any tried area code.');
}

// Free Vapi numbers can take a moment to activate.
for (let i = 0; i < 20 && !phone.number; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  phone = await vapi('GET', `/phone-number/${phone.id}`);
}

console.log(`Phone number ${phone.id}: ${phone.number ?? '(still provisioning)'} status=${phone.status ?? 'n/a'}`);
console.log(`Webhook: ${assistantConfig.server.url}`);
