/**
 * Server-side validation + normalisation for patient demographics.
 *
 * Each field parser takes raw input and either returns a normalised value or
 * throws a FieldError whose message is short and human-readable, because the
 * voice agent reads these messages back to the caller verbatim when it needs
 * to re-prompt for a field.
 */

export const SEX_VALUES = ['Male', 'Female', 'Other', 'Decline to Answer'];

export const US_STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia', PR: 'Puerto Rico', VI: 'U.S. Virgin Islands', GU: 'Guam',
  AS: 'American Samoa', MP: 'Northern Mariana Islands',
  AA: 'Armed Forces Americas', AE: 'Armed Forces Europe', AP: 'Armed Forces Pacific',
};
const STATE_BY_NAME = Object.fromEntries(
  Object.entries(US_STATES).map(([code, name]) => [name.toLowerCase().replace(/\./g, ''), code]),
);
STATE_BY_NAME['washington dc'] = 'DC';
STATE_BY_NAME['washington d c'] = 'DC';

export class FieldError extends Error {}

const fail = (message) => { throw new FieldError(message); };

/** Unicode-normalise, strip control characters, collapse whitespace. */
export function cleanText(raw) {
  if (typeof raw === 'number') raw = String(raw);
  if (typeof raw !== 'string') fail('must be text');
  return raw.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

const NAME_RE = /^\p{L}[\p{L}' .-]*$/u;

function name(max) {
  return (raw) => {
    const s = cleanText(raw).replace(/[‘’`]/g, "'");
    if (!s) fail('is required');
    if (s.length > max) fail(`must be ${max} characters or fewer`);
    if (!NAME_RE.test(s)) fail('may only contain letters, spaces, hyphens, and apostrophes');
    return s;
  };
}

function text(max) {
  return (raw) => {
    const s = cleanText(raw);
    if (s.length > max) fail(`must be ${max} characters or fewer`);
    return s;
  };
}

/** Accepts MM/DD/YYYY, M/D/YYYY, MM-DD-YYYY or ISO YYYY-MM-DD. Returns ISO. */
export function parseDate(raw) {
  const s = cleanText(raw);
  let y, m, d, match;
  if ((match = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/))) [, m, d, y] = match;
  else if ((match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [, y, m, d] = match;
  else fail('must be a date in MM/DD/YYYY format');
  [y, m, d] = [y, m, d].map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    fail('is not a real calendar date');
  }
  return dt.toISOString().slice(0, 10);
}

export function parseDateOfBirth(raw) {
  const iso = parseDate(raw);
  if (iso > new Date().toISOString().slice(0, 10)) fail('cannot be in the future');
  if (iso < '1900-01-01') fail('must be on or after 01/01/1900');
  return iso;
}

export function parsePhone(raw) {
  let digits = cleanText(raw).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) fail(`must be a 10-digit U.S. phone number (received ${digits.length} digits)`);
  if (!/^[2-9]/.test(digits)) fail('has an invalid area code (it cannot start with 0 or 1)');
  return digits;
}

export function parseSex(raw) {
  const s = cleanText(raw).toLowerCase();
  if (['male', 'm', 'man'].includes(s)) return 'Male';
  if (['female', 'f', 'woman'].includes(s)) return 'Female';
  if (['other', 'o', 'non-binary', 'nonbinary', 'intersex'].includes(s)) return 'Other';
  if (/^(decline|declined|decline to answer|prefer not to (say|answer)|no answer|n\/a)$/.test(s)) {
    return 'Decline to Answer';
  }
  return fail(`must be one of: ${SEX_VALUES.join(', ')}`);
}

export function parseState(raw) {
  const s = cleanText(raw).replace(/\./g, '');
  const code = s.toUpperCase();
  if (US_STATES[code]) return code;
  const byName = STATE_BY_NAME[s.toLowerCase()];
  if (byName) return byName;
  return fail('must be a valid 2-letter U.S. state abbreviation');
}

export function parseZip(raw) {
  const s = cleanText(raw).replace(/\s/g, '');
  const match = s.match(/^(\d{5})(?:-?(\d{4}))?$/);
  if (!match) fail('must be a 5-digit ZIP code or ZIP+4');
  return match[2] ? `${match[1]}-${match[2]}` : match[1];
}

export function parseEmail(raw) {
  const s = cleanText(raw).toLowerCase().replace(/\s/g, '');
  if (s.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) fail('must be a valid email address');
  return s;
}

function parseMemberId(raw) {
  const s = cleanText(raw).replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z0-9-]{1,50}$/.test(s)) fail('may only contain letters, numbers, and dashes (max 50)');
  return s;
}

function parseLanguage(raw) {
  const s = cleanText(raw);
  if (!/^\p{L}[\p{L} -]{0,49}$/u.test(s)) fail('must be a language name');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function required(parse, minMessage = 'is required') {
  return (raw) => {
    const v = parse(raw);
    if (v === '') fail(minMessage);
    return v;
  };
}

/** Field registry: order here is the column order used everywhere else. */
export const PATIENT_FIELDS = {
  first_name:              { required: true,  parse: name(50) },
  last_name:               { required: true,  parse: name(50) },
  date_of_birth:           { required: true,  parse: parseDateOfBirth },
  sex:                     { required: true,  parse: parseSex },
  phone_number:            { required: true,  parse: parsePhone },
  email:                   { required: false, parse: parseEmail },
  address_line_1:          { required: true,  parse: required(text(100)) },
  address_line_2:          { required: false, parse: text(100) },
  city:                    { required: true,  parse: required(text(100)) },
  state:                   { required: true,  parse: parseState },
  zip_code:                { required: true,  parse: parseZip },
  insurance_provider:      { required: false, parse: text(100) },
  insurance_member_id:     { required: false, parse: parseMemberId },
  preferred_language:      { required: false, parse: parseLanguage },
  emergency_contact_name:  { required: false, parse: name(100) },
  emergency_contact_phone: { required: false, parse: parsePhone },
};

export const PATIENT_FIELD_NAMES = Object.keys(PATIENT_FIELDS);

// First three digits of a ZIP code -> state. Used to catch "Miami, FL 78654"
// (a Texas ZIP). Ranges are inclusive. Territories and military codes are not
// checked (several share or overlap prefixes).
const ZIP3_RANGES = {
  AL: [[350, 369]], AK: [[995, 999]], AZ: [[850, 865]], AR: [[716, 729]],
  CA: [[900, 961]], CO: [[800, 816]], CT: [[60, 69]], DE: [[197, 199]],
  DC: [[200, 205], [569, 569]], FL: [[320, 349]], GA: [[300, 319], [398, 399]],
  HI: [[967, 968]], ID: [[832, 838]], IL: [[600, 629]], IN: [[460, 479]],
  IA: [[500, 528]], KS: [[660, 679]], KY: [[400, 427]], LA: [[700, 714]],
  ME: [[39, 49]], MD: [[206, 219]], MA: [[10, 27], [55, 55]], MI: [[480, 499]],
  MN: [[550, 567]], MS: [[386, 397]], MO: [[630, 658]], MT: [[590, 599]],
  NE: [[680, 693]], NV: [[889, 898]], NH: [[30, 38]], NJ: [[70, 89]],
  NM: [[870, 884]], NY: [[100, 149], [5, 5], [63, 63]], NC: [[270, 289]],
  ND: [[580, 588]], OH: [[430, 459]], OK: [[730, 749]], OR: [[970, 979]],
  PA: [[150, 196]], RI: [[28, 29]], SC: [[290, 299]], SD: [[570, 577]],
  TN: [[370, 385]], TX: [[750, 799], [885, 885]], UT: [[840, 847]], VT: [[50, 59]],
  VA: [[201, 201], [220, 246]], WA: [[980, 994]], WV: [[247, 268]],
  WI: [[530, 549]], WY: [[820, 831]],
};

export function stateForZip(zip) {
  const prefix = Number(String(zip).slice(0, 3));
  for (const [state, ranges] of Object.entries(ZIP3_RANGES)) {
    if (ranges.some(([lo, hi]) => prefix >= lo && prefix <= hi)) return state;
  }
  return null;
}

/** Null when consistent or not checkable; otherwise a human-readable message. */
export function zipStateMismatch(zip, state) {
  if (!zip || !state || !ZIP3_RANGES[state]) return null;
  const expected = stateForZip(zip);
  if (!expected || expected === state) return null;
  return `zip_code ${zip} belongs to ${US_STATES[expected]}, not ${US_STATES[state]}; please confirm the ZIP code and state`;
}

const isBlank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

/**
 * Validates a create (partial=false) or update (partial=true) payload.
 * Returns `{ value, errors }` where errors is `[{ field, message }]`.
 */
export function validatePatient(input, { partial = false } = {}) {
  const errors = [];
  const value = {};

  for (const key of Object.keys(input)) {
    if (!PATIENT_FIELDS[key]) errors.push({ field: key, message: `${key} is not a recognized field` });
  }

  for (const [field, spec] of Object.entries(PATIENT_FIELDS)) {
    if (!(field in input)) continue;
    const raw = input[field];
    if (isBlank(raw)) {
      if (spec.required) errors.push({ field, message: `${field} ${partial ? 'cannot be cleared' : 'is required'}` });
      else value[field] = null;
      continue;
    }
    try {
      value[field] = spec.parse(raw);
    } catch (err) {
      if (!(err instanceof FieldError)) throw err;
      errors.push({ field, message: `${field} ${err.message}` });
    }
  }

  if (!errors.some((e) => e.field === 'zip_code' || e.field === 'state')) {
    const mismatch = zipStateMismatch(value.zip_code, value.state);
    if (mismatch) errors.push({ field: 'zip_code', message: mismatch });
  }

  if (!partial) {
    for (const [field, spec] of Object.entries(PATIENT_FIELDS)) {
      if (spec.required && !(field in input)) errors.push({ field, message: `${field} is required` });
    }
    if (!value.preferred_language) value.preferred_language = 'English';
  } else if (Object.keys(input).length === 0) {
    errors.push({ field: null, message: 'at least one field must be provided' });
  }

  return { value, errors };
}

/** 'YYYY-MM-DD' -> 'MM/DD/YYYY' (the display format required by the spec). */
export function toUsDate(iso) {
  if (!iso) return iso;
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}
