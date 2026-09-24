import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { fileURLToPath } from 'node:url';
import { createPatientRepository } from './patients/repository.js';
import { createPatientService } from './patients/service.js';
import { patientRoutes } from './patients/routes.js';
import { createCallRepository } from './calls/repository.js';
import { createAppointmentService } from './appointments/service.js';
import { vapiRoutes } from './voice/webhook.js';
import { errorHandler, notFoundHandler, sendData } from './http/envelope.js';
import { unauthorized } from './http/errors.js';

/**
 * Builds the Express app. Wiring is explicit (no DI container): the data layer
 * (repositories) feeds the service layer, which is shared by two transports:
 * the REST API and the Vapi voice webhook.
 */
export function createApp({ db, config }) {
  const patientService = createPatientService({ patients: createPatientRepository(db) });
  const callRepository = createCallRepository(db);
  const appointmentService = createAppointmentService({ db, timezone: config.clinicTimezone });

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: { directives: { 'script-src': ["'self'", "'unsafe-inline'"] } },
  }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', async (req, res) => {
    await db.query('SELECT 1');
    sendData(res, { status: 'ok', database: db.kind });
  });

  const requireApiKey = (req, res, next) => {
    if (!config.apiKey || req.get('x-api-key') === config.apiKey) return next();
    return next(unauthorized());
  };
  const apiLimiter = rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false });

  app.use('/patients', apiLimiter, requireApiKey, patientRoutes({ patientService, callRepository, appointmentService }));
  app.get('/calls', apiLimiter, requireApiKey, async (req, res) => {
    sendData(res, await callRepository.listRecent());
  });
  app.use('/vapi', vapiRoutes({ config, patientService, callRepository, appointmentService }));

  // Dashboard (bonus): static page that reads from the API above.
  const publicDir = fileURLToPath(new URL('../public', import.meta.url));
  app.get('/', (req, res) => res.redirect('/dashboard'));
  app.get('/dashboard', (req, res) => res.sendFile('dashboard.html', { root: publicDir }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
