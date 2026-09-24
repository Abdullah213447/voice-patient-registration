import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { createToolHandlers } from './handlers.js';
import { logger } from '../logger.js';
import { sendError } from '../http/envelope.js';

/**
 * Single webhook endpoint for Vapi server messages:
 *  - tool-calls           -> run our tool handlers, reply with results
 *  - status-update        -> track call lifecycle
 *  - end-of-call-report   -> persist transcript + summary (also for dropped calls)
 * Vapi is the telephony/STT/TTS/LLM runtime; this module is the only place that
 * knows Vapi's payload shapes.
 */

function secretMatches(expected, received) {
  if (!received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseArguments(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function vapiRoutes({ config, patientService, callRepository, appointmentService }) {
  const router = Router();
  const handlers = createToolHandlers({ patientService, callRepository, appointmentService });

  router.use((req, res, next) => {
    if (!config.vapiWebhookSecret || secretMatches(config.vapiWebhookSecret, req.get('x-vapi-secret'))) return next();
    logger.warn({ ip: req.ip }, 'rejected vapi webhook with bad secret');
    return sendError(res, 401, 'unauthorized', 'Invalid webhook secret.');
  });

  router.post('/webhook', async (req, res) => {
    const message = req.body?.message;
    if (!message?.type) return sendError(res, 400, 'bad_request', 'Expected a Vapi server message.');

    const callId = message.call?.id ?? null;
    const callerNumber = message.call?.customer?.number ?? message.customer?.number ?? null;

    switch (message.type) {
      case 'tool-calls': {
        const toolCalls = message.toolCallList ?? message.toolCalls ?? [];
        const results = await Promise.all(toolCalls.map(async (call) => {
          const name = call.function?.name ?? call.name;
          const args = parseArguments(call.function?.arguments ?? call.arguments);
          const handler = handlers[name];
          logger.info({ callId, tool: name, args }, 'tool call');
          const result = handler
            ? await handler(args, { callId, callerNumber })
            : { status: 'error', message: `Unknown tool ${name}` };
          logger.info({ callId, tool: name, result }, 'tool result');
          return { toolCallId: call.id, result: JSON.stringify(result) };
        }));
        return res.json({ results });
      }

      case 'status-update': {
        if (callId && message.status === 'in-progress') {
          await safe(() => callRepository.upsert(callId, {
            status: 'in_progress', caller_number: callerNumber, started_at: new Date().toISOString(),
          }));
        }
        return res.json({ ok: true });
      }

      case 'end-of-call-report': {
        const transcript = message.artifact?.transcript ?? message.transcript ?? null;
        const summary = message.analysis?.summary ?? message.summary ?? null;
        logger.info({ callId, endedReason: message.endedReason, summary, transcript }, 'call ended');
        if (callId) {
          await safe(() => callRepository.recordEnded(callId, {
            caller_number: callerNumber,
            ended_reason: message.endedReason ?? null,
            summary,
            transcript,
            started_at: message.startedAt ?? message.call?.startedAt ?? null,
            ended_at: message.endedAt ?? new Date().toISOString(),
          }));
        }
        return res.json({ ok: true });
      }

      default:
        return res.json({ ok: true });
    }
  });

  return router;
}

async function safe(fn) {
  try {
    await fn();
  } catch (err) {
    logger.error({ err }, 'failed to persist call event');
  }
}
