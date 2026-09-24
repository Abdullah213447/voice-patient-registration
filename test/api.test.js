import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestApp, validPatient } from './helpers.js';

let app;
before(async () => { ({ app } = await createTestApp()); });

test('POST /patients creates a patient and returns the envelope', async () => {
  const res = await request(app).post('/patients').send(validPatient()).expect(201);
  assert.equal(res.body.error, null);
  assert.match(res.body.data.patient_id, /^[0-9a-f-]{36}$/);
  assert.equal(res.body.data.date_of_birth, '07/04/1990');
  assert.equal(res.body.data.state, 'TX');
  assert.equal(res.headers.location, `/patients/${res.body.data.patient_id}`);
});

test('POST /patients returns 422 with field details for invalid data', async () => {
  const res = await request(app).post('/patients')
    .send({ ...validPatient(), phone_number: '555', date_of_birth: '01/01/2999' }).expect(422);
  assert.equal(res.body.data, null);
  assert.equal(res.body.error.code, 'validation_failed');
  assert.deepEqual(res.body.error.details.map((d) => d.field).sort(), ['date_of_birth', 'phone_number']);
});

test('malformed JSON and non-object bodies are 400', async () => {
  await request(app).post('/patients').set('content-type', 'application/json').send('{"oops"').expect(400);
  await request(app).post('/patients').send([1, 2]).expect(400);
});

test('GET /patients/:id handles bad and unknown ids', async () => {
  await request(app).get('/patients/not-a-uuid').expect(400);
  await request(app).get('/patients/00000000-0000-4000-8000-000000000000').expect(404);
});

test('GET /patients filters by last_name, date_of_birth and phone_number', async () => {
  await request(app).post('/patients').send({ ...validPatient(), last_name: 'Filterson', phone_number: '3125550199' }).expect(201);
  const byName = await request(app).get('/patients?last_name=filterson').expect(200);
  assert.equal(byName.body.data.length, 1);
  assert.equal(byName.body.meta.total, 1);
  const byPhone = await request(app).get('/patients?phone_number=312-555-0199').expect(200);
  assert.equal(byPhone.body.data[0].last_name, 'Filterson');
  const byDob = await request(app).get('/patients?date_of_birth=1990-07-04').expect(200);
  assert.ok(byDob.body.data.length >= 1);
  await request(app).get('/patients?date_of_birth=yesterday').expect(400);
  await request(app).get('/patients?limit=5000').expect(400);
});

test('PUT /patients/:id applies partial updates and bumps updated_at', async () => {
  const { body } = await request(app).post('/patients').send(validPatient()).expect(201);
  const id = body.data.patient_id;
  await new Promise((r) => setTimeout(r, 20));
  const res = await request(app).put(`/patients/${id}`).send({ last_name: 'Davis', address_line_2: null }).expect(200);
  assert.equal(res.body.data.last_name, 'Davis');
  assert.equal(res.body.data.address_line_2, null);
  assert.equal(res.body.data.first_name, 'Maria');
  assert.ok(new Date(res.body.data.updated_at) > new Date(body.data.updated_at));
  await request(app).put(`/patients/${id}`).send({ first_name: '' }).expect(422);
  await request(app).put(`/patients/${id}`).send({}).expect(422);
});

test('DELETE /patients/:id soft-deletes', async () => {
  const { body } = await request(app).post('/patients').send({ ...validPatient(), last_name: 'Gone' }).expect(201);
  const id = body.data.patient_id;
  const del = await request(app).delete(`/patients/${id}`).expect(200);
  assert.ok(del.body.data.deleted_at);
  await request(app).get(`/patients/${id}`).expect(404);
  await request(app).delete(`/patients/${id}`).expect(404);
  const list = await request(app).get('/patients?last_name=Gone').expect(200);
  assert.equal(list.body.data.length, 0);
});

test('unknown routes return the error envelope', async () => {
  const res = await request(app).get('/nope').expect(404);
  assert.equal(res.body.error.code, 'not_found');
});

test('API key is enforced when configured', async () => {
  const { app: locked } = await createTestApp({ apiKey: 'k' });
  await request(locked).get('/patients').expect(401);
  await request(locked).get('/patients').set('x-api-key', 'k').expect(200);
});
