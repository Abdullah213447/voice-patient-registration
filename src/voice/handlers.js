import { AppError } from '../http/errors.js';
import { FieldError, parseDate } from '../patients/validation.js';
import { logger } from '../logger.js';

/**
 * Tool implementations. They call the same service layer as the REST API, so
 * validation and persistence rules are identical for both entry points.
 *
 * Every handler returns a plain object with a `status` the prompt knows how to
 * react to ("saved" / "invalid" / "error" / ...). Handlers never throw: a
 * thrown error would reach the caller as dead air or a generic failure.
 */

const RETRY_DELAY_MS = 300;

/** Retry once on infrastructure errors (DB blip); never on validation errors. */
async function withRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError || err instanceof FieldError) throw err;
    logger.warn({ err }, 'tool call failed, retrying once');
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    return fn();
  }
}

function toToolError(err) {
  if (err instanceof AppError && err.status === 422) {
    return {
      status: 'invalid',
      errors: err.details,
      instruction: 'Ask the caller again for only these fields, confirm the new values, then retry.',
    };
  }
  if (err instanceof AppError && err.status < 500) return { status: 'invalid', message: err.message };
  if (err instanceof FieldError) return { status: 'invalid', message: err.message };
  logger.error({ err }, 'tool call failed');
  return { status: 'error', message: 'The record could not be saved due to a temporary system problem.' };
}

export function createToolHandlers({ patientService, callRepository, appointmentService, clinicTimezone = 'America/New_York' }) {
  // Call-log writes are best effort: a failure there must never break the conversation.
  const recordCall = async (callId, fields) => {
    if (!callId) return;
    try {
      await callRepository.upsert(callId, fields);
    } catch (err) {
      logger.error({ err, callId }, 'failed to record call data');
    }
  };

  return {
    async find_patient_by_phone({ phone_number }) {
      try {
        const matches = await withRetry(() => patientService.findByPhone(phone_number));
        if (!matches.length) return { status: 'not_found' };
        return {
          status: 'found',
          // Only what the agent needs to ask "is this you?". No other PHI is
          // returned to the model, so it cannot leak it to an unverified caller.
          matches: matches.map((p) => ({
            patient_id: p.patient_id, first_name: p.first_name, last_name: p.last_name,
          })),
        };
      } catch (err) {
        if (err instanceof FieldError) return { status: 'invalid', message: `phone_number ${err.message}` };
        // Lookup is a nice-to-have; carry on with a normal registration.
        logger.error({ err }, 'duplicate lookup failed');
        return { status: 'not_found', note: 'Lookup unavailable; continue with a new registration.' };
      }
    },

    async register_patient(args, ctx) {
      logger.info({ callId: ctx.callId, payload: args }, 'voice agent: register_patient payload');
      // Store the payload on the call first so nothing is lost if the save fails.
      await recordCall(ctx.callId, { collected_data: args, caller_number: ctx.callerNumber });
      try {
        const patient = await withRetry(() => patientService.create(args));
        await recordCall(ctx.callId, { patient_id: patient.patient_id, outcome: 'registered' });
        logger.info({ callId: ctx.callId, patientId: patient.patient_id }, 'voice agent: patient registered');
        return { status: 'saved', patient_id: patient.patient_id, first_name: patient.first_name };
      } catch (err) {
        const result = toToolError(err);
        if (result.status === 'error') await recordCall(ctx.callId, { outcome: 'save_failed' });
        return result;
      }
    },

    async update_patient({ patient_id, date_of_birth_verification, updates }, ctx) {
      logger.info({ callId: ctx.callId, patientId: patient_id, updates }, 'voice agent: update_patient payload');
      try {
        const existing = await withRetry(() => patientService.get(patient_id));
        let claimedDob;
        try {
          claimedDob = parseDate(date_of_birth_verification ?? '');
        } catch {
          return { status: 'verification_failed' };
        }
        const [m, d, y] = existing.date_of_birth.split('/');
        if (claimedDob !== `${y}-${m}-${d}`) return { status: 'verification_failed' };

        await recordCall(ctx.callId, { collected_data: updates, caller_number: ctx.callerNumber });
        const patient = await withRetry(() => patientService.update(patient_id, updates ?? {}));
        await recordCall(ctx.callId, { patient_id: patient.patient_id, outcome: 'updated' });
        return { status: 'saved', patient_id: patient.patient_id, first_name: patient.first_name };
      } catch (err) {
        return toToolError(err);
      }
    },

    async get_current_time({ timezone } = {}, ctx, now = new Date()) {
      let zone = clinicTimezone;
      if (timezone) {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: timezone });
          zone = timezone;
        } catch {
          // Unknown zone name from the model: fall back to clinic time and say so.
        }
      }
      const fmt = (opts) => new Intl.DateTimeFormat('en-US', { timeZone: zone, ...opts }).format(now);
      return {
        status: 'ok',
        time: fmt({ hour: 'numeric', minute: '2-digit' }),
        date: fmt({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
        timezone: zone,
        timezone_name: fmt({ timeZoneName: 'long' }).split(', ').pop(),
        ...(timezone && zone !== timezone ? { note: `Unknown timezone "${timezone}"; showing clinic time.` } : {}),
      };
    },

    async get_appointment_slots({ preferred_date } = {}) {
      try {
        const slots = await withRetry(() => appointmentService.availableSlots({ onDate: preferred_date || undefined }));
        if (!slots.length) return { status: 'none_available', note: 'No openings that day; offer to check another day.' };
        return { status: 'ok', slots };
      } catch (err) {
        return toToolError(err);
      }
    },

    async book_appointment({ patient_id, slot_start, reason }, ctx) {
      try {
        const appt = await withRetry(() => appointmentService.book({ patientId: patient_id, slotStart: slot_start, reason }));
        logger.info({ callId: ctx.callId, appointmentId: appt.appointment_id }, 'voice agent: appointment booked');
        return { status: 'booked', when: appt.label };
      } catch (err) {
        return toToolError(err);
      }
    },
  };
}
