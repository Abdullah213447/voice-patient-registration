import pino from 'pino';
import { config } from './config.js';

// Structured JSON logs to stdout; pipe through `pino-pretty` locally.
export const logger = pino({ level: config.logLevel });
