import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestApp, validPatient } from './helpers.js';

let app;
let db;
before(async () => { ({ app, db } = await createTestApp()); });

/** Sends a Vapi-shaped tool-calls webhook and returns the parsed tool result. */
async function callTool(name, args, callId = 'call-1') {
  const res = await request(app).post('/vapi/webhook').set('x-vapi-secret', 'test-secret').send({
    message: {
      type: 'tool-calls',
      call: { id: callId, customer: { number: '+15125550100' } },
      toolCallList: [{ id: 'tc-1', type: 'function', function: { name, arguments: args } }],
    },
  }).expect(200);
  assert.equal(res.body.results[0].toolCallId, 'tc-1');
  return JSON.parse(res.body.results[0].result);
}

test('rejects webhooks without the shared secret', async () => {
  await request(app).post('/vapi/webhook').send({ message: { type: 'status-update' } }).expect(401);
});

test('register_patient saves and links the call', async () => {
  const result = await callTool('register_patient', validPatient(), 'call-register');
  assert.equal(result.status, 'saved');
  assert.equal(result.first_name, 'Maria');
  const { rows } = await db.query('SELECT patient_id, outcome, collected_data FROM calls WHERE call_id = $1', ['call-register']);
  assert.equal(rows[0].patient_id, result.patient_id);
  assert.equal(rows[0].outcome, 'registered');
  assert.equal(rows[0].collected_data.first_name, 'Maria');
});

test('register_patient returns field-specific errors for re-prompting', async () => {
  const result = await callTool('register_patient', { ...validPatient(), phone_number: '555' });
  assert.equal(result.status, 'invalid');
  assert.equal(result.errors[0].field, 'phone_number');
});

test('tool arguments may arrive as a JSON string', async () => {
  const result = await callTool('find_patient_by_phone', JSON.stringify({ phone_number: '512 555 0100' }));
  assert.equal(result.status, 'found');
  assert.deepEqual(Object.keys(result.matches[0]).sort(), ['first_name', 'last_name', 'patient_id']);
});

test('find_patient_by_phone reports no match', async () => {
  assert.equal((await callTool('find_patient_by_phone', { phone_number: '9175550000' })).status, 'not_found');
});

test('update_patient requires a matching date of birth', async () => {
  const { matches } = await callTool('find_patient_by_phone', { phone_number: '5125550100' });
  const id = matches[0].patient_id;
  const denied = await callTool('update_patient', { patient_id: id, date_of_birth_verification: '01/01/1980', updates: { city: 'Dallas' } });
  assert.equal(denied.status, 'verification_failed');
  const ok = await callTool('update_patient', { patient_id: id, date_of_birth_verification: '7/4/1990', updates: { city: 'Dallas' } });
  assert.equal(ok.status, 'saved');
  const res = await request(app).get(`/patients/${id}`).expect(200);
  assert.equal(res.body.data.city, 'Dallas');
});

test('database failures produce a graceful "error" result, not silence', async () => {
  const { app: broken, db: brokenDb } = await createTestApp();
  await brokenDb.exec('DROP TABLE appointments; DROP TABLE calls; DROP TABLE patients;');
  const res = await request(broken).post('/vapi/webhook').set('x-vapi-secret', 'test-secret').send({
    message: { type: 'tool-calls', call: { id: 'x' }, toolCallList: [{ id: 't', function: { name: 'register_patient', arguments: validPatient() } }] },
  }).expect(200);
  assert.equal(JSON.parse(res.body.results[0].result).status, 'error');
});

test('appointments can be listed and booked', async () => {
  const { matches } = await callTool('find_patient_by_phone', { phone_number: '5125550100' });
  const slots = await callTool('get_appointment_slots', {});
  assert.equal(slots.status, 'ok');
  assert.ok(slots.slots.length > 0);
  const booked = await callTool('book_appointment', { patient_id: matches[0].patient_id, slot_start: slots.slots[0].slot_start });
  assert.equal(booked.status, 'booked');
  const again = await callTool('book_appointment', { patient_id: matches[0].patient_id, slot_start: slots.slots[0].slot_start });
  assert.equal(again.status, 'invalid');
});

test('end-of-call-report stores the transcript and marks dropped calls incomplete', async () => {
  await request(app).post('/vapi/webhook').set('x-vapi-secret', 'test-secret').send({
    message: {
      type: 'end-of-call-report', call: { id: 'call-dropped', customer: { number: '+15125550111' } },
      endedReason: 'customer-ended-call', artifact: { transcript: 'AI: Hi\nUser: Hello' },
      analysis: { summary: 'Caller hung up after greeting.' },
    },
  }).expect(200);
  const { rows } = await db.query('SELECT * FROM calls WHERE call_id = $1', ['call-dropped']);
  assert.equal(rows[0].outcome, 'incomplete');
  assert.equal(rows[0].transcript, 'AI: Hi\nUser: Hello');

  await request(app).post('/vapi/webhook').set('x-vapi-secret', 'test-secret').send({
    message: { type: 'end-of-call-report', call: { id: 'call-register' }, endedReason: 'assistant-ended-call', artifact: { transcript: 't' } },
  }).expect(200);
  const { rows: reg } = await db.query('SELECT outcome FROM calls WHERE call_id = $1', ['call-register']);
  assert.equal(reg[0].outcome, 'registered');
});

test('get_current_time returns clinic time, honours a requested timezone, and survives bad input', async () => {
  const clinic = await callTool('get_current_time', {});
  assert.equal(clinic.status, 'ok');
  assert.equal(clinic.timezone, 'America/New_York');
  assert.match(clinic.time, /^\d{1,2}:\d{2}\s?[AP]M$/);
  assert.match(clinic.timezone_name, /Eastern/);
  const la = await callTool('get_current_time', { timezone: 'America/Los_Angeles' });
  assert.match(la.timezone_name, /Pacific/);
  const bogus = await callTool('get_current_time', { timezone: 'Mars/Olympus' });
  assert.equal(bogus.timezone, 'America/New_York');
  assert.ok(bogus.note);
});
