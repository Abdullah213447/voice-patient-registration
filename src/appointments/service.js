import { badRequest, notFound } from '../http/errors.js';

/**
 * Mock scheduling (bonus challenge): one provider, one-hour new-patient visits,
 * weekdays 9 AM - 4 PM (last start) in the clinic's timezone. Slots are
 * computed on the fly; only bookings are stored.
 */
const OPEN_HOUR = 9;
const LAST_START_HOUR = 16;
const HOUR_MS = 60 * 60 * 1000;
const WEEKDAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);

export function createAppointmentService({ db, timezone }) {
  const partsFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, weekday: 'short', hour: 'numeric', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const labelFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });

  function localParts(date) {
    const p = Object.fromEntries(partsFmt.formatToParts(date).map(({ type, value }) => [type, value]));
    return { weekday: p.weekday, hour: Number(p.hour), date: `${p.year}-${p.month}-${p.day}` };
  }

  function isBookableSlot(date) {
    if (date.getUTCMinutes() !== 0 || date.getUTCSeconds() !== 0) return false;
    const { weekday, hour } = localParts(date);
    return WEEKDAYS.has(weekday) && hour >= OPEN_HOUR && hour <= LAST_START_HOUR;
  }

  const toSlot = (date) => ({ slot_start: date.toISOString(), label: labelFmt.format(date) });

  return {
    /** Next `count` open slots, starting tomorrow-ish; optionally on a given local date. */
    async availableSlots({ onDate, count = 4, now = new Date() } = {}) {
      const start = new Date(Math.ceil((now.getTime() + 12 * HOUR_MS) / HOUR_MS) * HOUR_MS);
      const end = new Date(start.getTime() + 21 * 24 * HOUR_MS);
      const { rows } = await db.query(
        `SELECT starts_at FROM appointments WHERE status = 'scheduled' AND starts_at BETWEEN $1 AND $2`,
        [start.toISOString(), end.toISOString()],
      );
      const booked = new Set(rows.map((r) => new Date(r.starts_at).toISOString()));

      const slots = [];
      for (let t = start.getTime(); t < end.getTime() && slots.length < count; t += HOUR_MS) {
        const date = new Date(t);
        if (!isBookableSlot(date) || booked.has(date.toISOString())) continue;
        if (onDate && localParts(date).date !== onDate) continue;
        slots.push(toSlot(date));
      }
      return slots;
    },

    async book({ patientId, slotStart, reason }) {
      const date = new Date(slotStart);
      if (Number.isNaN(date.getTime()) || date <= new Date() || !isBookableSlot(date)) {
        throw badRequest('That time is not an available appointment slot.');
      }
      const { rows: patient } = await db.query(
        'SELECT 1 FROM patients WHERE patient_id = $1 AND deleted_at IS NULL', [patientId],
      );
      if (!patient.length) throw notFound('Patient not found.');
      try {
        const { rows } = await db.query(
          `INSERT INTO appointments (patient_id, starts_at, reason) VALUES ($1, $2, $3) RETURNING *`,
          [patientId, date.toISOString(), reason ? String(reason).slice(0, 200) : null],
        );
        return { ...rows[0], label: labelFmt.format(date) };
      } catch (err) {
        if (err.code === '23505') throw badRequest('That slot was just taken. Please pick another time.');
        throw err;
      }
    },

    async listForPatient(patientId) {
      const { rows } = await db.query(
        `SELECT * FROM appointments WHERE patient_id = $1 ORDER BY starts_at`, [patientId],
      );
      return rows.map((r) => ({ ...r, label: labelFmt.format(new Date(r.starts_at)) }));
    },
  };
}
