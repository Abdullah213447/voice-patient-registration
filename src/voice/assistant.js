import { TOOL_DEFINITIONS } from './tools.js';
import { buildFirstMessage, buildSystemPrompt } from './prompt.js';

/**
 * Full Vapi assistant definition, kept in code so it is versioned and
 * reviewable. `npm run setup:vapi` pushes it to Vapi.
 *
 * Stack choices (all billed through Vapi, no extra vendor keys needed):
 * - Deepgram nova-3 "multi": fast streaming STT that handles English/Spanish code-switching.
 * - OpenAI GPT-4.1: strong instruction following + reliable tool calls at low latency.
 * - ElevenLabs turbo v2.5: natural voice, multilingual, low time-to-first-byte.
 */
export function buildAssistantConfig({
  name = 'Patient Intake - Voice Registration',
  publicBaseUrl,
  webhookSecret,
  clinicName,
  timezone,
  agentName = 'Maya',
  model = { provider: 'openai', model: 'gpt-4.1' },
  voice = { provider: '11labs', voiceId: 'EXAVITQu4vr4xnSDxMaL', model: 'eleven_turbo_v2_5' },
}) {
  const server = {
    url: `${publicBaseUrl.replace(/\/$/, '')}/vapi/webhook`,
    timeoutSeconds: 20,
    ...(webhookSecret ? { headers: { 'x-vapi-secret': webhookSecret } } : {}),
  };

  return {
    name,
    firstMessage: buildFirstMessage({ clinicName, agentName }),
    firstMessageMode: 'assistant-speaks-first',
    model: {
      ...model,
      temperature: 0.4,
      messages: [{ role: 'system', content: buildSystemPrompt({ clinicName, agentName, timezone }) }],
      tools: [
        ...TOOL_DEFINITIONS.map((fn) => ({ type: 'function', function: fn, server })),
        { type: 'endCall' },
      ],
    },
    voice,
    transcriber: { provider: 'deepgram', model: 'nova-3', language: 'multi', smartFormat: true },
    server,
    serverMessages: ['status-update', 'end-of-call-report'],
    backgroundDenoisingEnabled: true,
    silenceTimeoutSeconds: 45,
    maxDurationSeconds: 900,
    messagePlan: {
      idleMessages: ['Are you still there?', 'Take your time, I\'m still here.'],
      idleTimeoutSeconds: 10,
      idleMessageMaxSpokenCount: 2,
    },
    endCallMessage: 'Thanks for calling. Take care!',
    analysisPlan: {
      summaryPlan: {
        enabled: true,
        messages: [
          {
            role: 'system',
            content:
              'Summarize this patient intake call in 2-3 sentences for front-desk staff: whether registration completed, any changes made, any appointment booked, and any follow-up needed.',
          },
          { role: 'user', content: 'Here is the transcript:\n\n{{transcript}}\n\n' },
        ],
      },
    },
  };
}
