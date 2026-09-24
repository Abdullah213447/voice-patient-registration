import { badRequest, notFound, validationFailed } from '../http/errors.js';
import { cleanText, FieldError, parseDate, parsePhone, toUsDate, validatePatient } from './validation.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shape returned to API clients and the voice agent. */
export function serializePatient(row) {
  return {
    patient_id: row.patient_id,
    first_name: row.first_name,
    last_name: row.last_name,
    date_of_birth: toUsDate(row.date_of_birth),
    sex: row.sex,
    phone_number: row.phone_number,
    email: row.email,
    address_line_1: row.address_line_1,
    address_line_2: row.address_line_2,
    city: row.city,
    state: row.state,
    zip_code: row.zip_code,
    insurance_provider: row.insurance_provider,
    insurance_member_id: row.insurance_member_id,
    preferred_language: row.preferred_language,
    emergency_contact_name: row.emergency_contact_name,
    emergency_contact_phone: row.emergency_contact_phone,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at ?? null,
  };
}

export function assertUuid(id) {
  if (!UUID_RE.test(String(id))) throw badRequest('patient_id must be a valid UUID.');
}

/**
 * Database constraints duplicate the app-level rules. If one still fires
 * (e.g. a race or a bypassed validator) report it as a 422, not a 500.
 */
async function withConstraintMapping(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.code === '23514' || err.code === '22001' || err.code === '22007' || err.code === '22008') {
      throw validationFailed([{ field: err.column ?? null, message: err.message }]);
    }
    throw err;
  }
}

function parseQueryParam(name, raw, parse) {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string') throw badRequest(`Query parameter ${name} must be a single value.`);
  try {
    return parse(raw);
  } catch (err) {
    if (err instanceof FieldError) throw badRequest(`Query parameter ${name} ${err.message}.`);
    throw err;
  }
}

function parseIntParam(name, raw, { min, max, fallback }) {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw badRequest(`Query parameter ${name} must be an integer between ${min} and ${max}.`);
  }
  return n;
}

export function createPatientService({ patients }) {
  return {
    async create(input) {
      const { value, errors } = validatePatient(input);
      if (errors.length) throw validationFailed(errors);
      const row = await withConstraintMapping(() => patients.insert(value));
      return serializePatient(row);
    },

    async get(id) {
      assertUuid(id);
      const row = await patients.findById(id);
      if (!row) throw notFound(`No patient with id ${id}.`);
      return serializePatient(row);
    },

    async list(query = {}) {
      const filters = {
        lastName: parseQueryParam('last_name', query.last_name, (v) => cleanText(v).slice(0, 50)),
        dateOfBirth: parseQueryParam('date_of_birth', query.date_of_birth, parseDate),
        phoneNumber: parseQueryParam('phone_number', query.phone_number, parsePhone),
        limit: parseIntParam('limit', query.limit, { min: 1, max: 200, fallback: 50 }),
        offset: parseIntParam('offset', query.offset, { min: 0, max: 1_000_000, fallback: 0 }),
      };
      const { rows, total } = await patients.list(filters);
      return { items: rows.map(serializePatient), total, limit: filters.limit, offset: filters.offset };
    },

    async update(id, input) {
      assertUuid(id);
      const { value, errors } = validatePatient(input, { partial: true });
      if (errors.length) throw validationFailed(errors);
      const row = await withConstraintMapping(() => patients.update(id, value));
      if (!row) throw notFound(`No patient with id ${id}.`);
      return serializePatient(row);
    },

    async remove(id) {
      assertUuid(id);
      const row = await patients.softDelete(id);
      if (!row) throw notFound(`No patient with id ${id}.`);
      return serializePatient(row);
    },

    async findByPhone(phone) {
      const rows = await patients.findByPhone(parsePhone(phone));
      return rows.map(serializePatient);
    },
  };
}
