import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePatient, parsePhone, parseState, parseDateOfBirth, parseZip, parseSex } from '../src/patients/validation.js';
import { validPatient } from './helpers.js';

test('normalises a valid patient', () => {
  const { value, errors } = validatePatient(validPatient());
  assert.deepEqual(errors, []);
  assert.equal(value.date_of_birth, '1990-07-04');
  assert.equal(value.phone_number, '5125550100');
  assert.equal(value.state, 'TX');
  assert.equal(value.email, 'maria@example.com');
  assert.equal(value.preferred_language, 'English');
});

test('reports every missing required field', () => {
  const { errors } = validatePatient({});
  assert.deepEqual(
    errors.map((e) => e.field).sort(),
    ['address_line_1', 'city', 'date_of_birth', 'first_name', 'last_name', 'phone_number', 'sex', 'state', 'zip_code'],
  );
});

test('rejects unknown fields', () => {
  const { errors } = validatePatient({ ...validPatient(), ssn: '123-45-6789' });
  assert.equal(errors[0].field, 'ssn');
});

test('phone numbers', () => {
  assert.equal(parsePhone('+1 (212) 555-7890'), '2125557890');
  assert.throws(() => parsePhone('555'), /10-digit/);
  assert.throws(() => parsePhone('1234567890'), /area code/);
});

test('dates of birth', () => {
  assert.equal(parseDateOfBirth('1/2/2003'), '2003-01-02');
  assert.equal(parseDateOfBirth('2003-01-02'), '2003-01-02');
  assert.throws(() => parseDateOfBirth('02/30/2000'), /real calendar date/);
  assert.throws(() => parseDateOfBirth('01/01/2999'), /future/);
  assert.throws(() => parseDateOfBirth('01/01/1850'), /1900/);
  assert.throws(() => parseDateOfBirth('January 5th'), /MM\/DD\/YYYY/);
});

test('states, zips and sex', () => {
  assert.equal(parseState('New York'), 'NY');
  assert.equal(parseState('d.c.'), 'DC');
  assert.throws(() => parseState('ZZ'), /state/);
  assert.equal(parseZip('787011234'), '78701-1234');
  assert.throws(() => parseZip('7870'), /ZIP/);
  assert.equal(parseSex('prefer not to say'), 'Decline to Answer');
  assert.throws(() => parseSex('unknown'), /must be one of/);
});

test('names allow accents, hyphens and apostrophes but not digits', () => {
  assert.deepEqual(validatePatient({ ...validPatient(), first_name: 'José', last_name: 'García-López' }).errors, []);
  const { errors } = validatePatient({ ...validPatient(), first_name: 'R2D2' });
  assert.equal(errors[0].field, 'first_name');
});
