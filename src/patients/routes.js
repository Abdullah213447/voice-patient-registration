import { Router } from 'express';
import { badRequest } from '../http/errors.js';
import { sendData } from '../http/envelope.js';
import { assertUuid } from './service.js';

function requireObjectBody(req) {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('Request body must be a JSON object (Content-Type: application/json).');
  }
  return body;
}

export function patientRoutes({ patientService, callRepository, appointmentService }) {
  const router = Router();

  router.get('/', async (req, res) => {
    const { items, total, limit, offset } = await patientService.list(req.query);
    sendData(res, items, 200, { total, limit, offset });
  });

  router.post('/', async (req, res) => {
    const patient = await patientService.create(requireObjectBody(req));
    res.location(`/patients/${patient.patient_id}`);
    sendData(res, patient, 201);
  });

  router.get('/:id', async (req, res) => {
    sendData(res, await patientService.get(req.params.id));
  });

  router.put('/:id', async (req, res) => {
    sendData(res, await patientService.update(req.params.id, requireObjectBody(req)));
  });

  router.delete('/:id', async (req, res) => {
    sendData(res, await patientService.remove(req.params.id));
  });

  // Read-only sub-resources used by the dashboard.
  router.get('/:id/calls', async (req, res) => {
    assertUuid(req.params.id);
    await patientService.get(req.params.id);
    sendData(res, await callRepository.listForPatient(req.params.id));
  });

  router.get('/:id/appointments', async (req, res) => {
    assertUuid(req.params.id);
    await patientService.get(req.params.id);
    sendData(res, await appointmentService.listForPatient(req.params.id));
  });

  return router;
}
