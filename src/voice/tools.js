import { SEX_VALUES } from '../patients/validation.js';

/**
 * Function-tool schemas exposed to the LLM. Descriptions are part of the
 * prompt: they tell the model *when* to call each tool, not just what it does.
 */
const patientProperties = {
  first_name: { type: 'string', description: 'Legal first name, correctly spelled.' },
  last_name: { type: 'string', description: 'Legal last name, exactly as the caller spelled it.' },
  date_of_birth: { type: 'string', description: 'Date of birth in MM/DD/YYYY format.' },
  sex: { type: 'string', enum: SEX_VALUES },
  phone_number: { type: 'string', description: '10-digit U.S. phone number, digits only.' },
  email: { type: 'string', description: 'Email address (optional).' },
  address_line_1: { type: 'string', description: 'Street number and name.' },
  address_line_2: { type: 'string', description: 'Apartment, suite, or unit (optional).' },
  city: { type: 'string' },
  state: { type: 'string', description: 'Two-letter U.S. state abbreviation, e.g. TX.' },
  zip_code: { type: 'string', description: '5-digit ZIP or ZIP+4 (12345-6789).' },
  insurance_provider: { type: 'string', description: 'Insurance company name (optional).' },
  insurance_member_id: { type: 'string', description: 'Insurance member/subscriber ID (optional).' },
  preferred_language: { type: 'string', description: 'Preferred language, e.g. English or Spanish.' },
  emergency_contact_name: { type: 'string', description: 'Emergency contact full name (optional).' },
  emergency_contact_phone: { type: 'string', description: 'Emergency contact 10-digit phone (optional).' },
};

export const TOOL_DEFINITIONS = [
  {
    name: 'find_patient_by_phone',
    description:
      'Check whether a patient record already exists for a phone number. Call this as soon as the caller gives a valid 10-digit phone number, before collecting the rest of their details.',
    parameters: {
      type: 'object',
      properties: { phone_number: { type: 'string', description: '10-digit U.S. phone number.' } },
      required: ['phone_number'],
    },
  },
  {
    name: 'register_patient',
    description:
      'Save a NEW patient record. Only call this after reading all details back to the caller and the caller confirming they are correct.',
    parameters: {
      type: 'object',
      properties: patientProperties,
      required: ['first_name', 'last_name', 'date_of_birth', 'sex', 'phone_number', 'address_line_1', 'city', 'state', 'zip_code'],
    },
  },
  {
    name: 'update_patient',
    description:
      "Update an EXISTING patient's record (returning caller). Include only the fields that changed, and only after the caller confirms the changes.",
    parameters: {
      type: 'object',
      properties: {
        patient_id: { type: 'string', description: 'patient_id returned by find_patient_by_phone.' },
        date_of_birth_verification: {
          type: 'string',
          description: 'Date of birth the caller just stated (MM/DD/YYYY), used to verify identity.',
        },
        updates: {
          type: 'object',
          description: 'Only the fields being changed.',
          properties: patientProperties,
        },
      },
      required: ['patient_id', 'date_of_birth_verification', 'updates'],
    },
  },
  {
    name: 'get_appointment_slots',
    description: 'List available first-visit appointment times. Call after a successful registration if the caller wants to book.',
    parameters: {
      type: 'object',
      properties: {
        preferred_date: { type: 'string', description: 'Optional specific day, YYYY-MM-DD.' },
      },
    },
  },
  {
    name: 'book_appointment',
    description: 'Book one of the slots returned by get_appointment_slots for a registered patient.',
    parameters: {
      type: 'object',
      properties: {
        patient_id: { type: 'string' },
        slot_start: { type: 'string', description: 'slot_start value exactly as returned by get_appointment_slots.' },
        reason: { type: 'string', description: 'Short reason for the visit, if the caller gave one.' },
      },
      required: ['patient_id', 'slot_start'],
    },
  },
];
