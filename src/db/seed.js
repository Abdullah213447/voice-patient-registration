import { logger } from '../logger.js';

// Two fictional demo patients so the API and dashboard aren't empty on first boot.
const DEMO_PATIENTS = [
  {
    first_name: 'Jane', last_name: 'Doe', date_of_birth: '1985-04-12', sex: 'Female',
    phone_number: '5125550142', email: 'jane.doe@example.com',
    address_line_1: '1200 Barton Springs Rd', address_line_2: 'Apt 4B',
    city: 'Austin', state: 'TX', zip_code: '78704',
    insurance_provider: 'Blue Cross Blue Shield', insurance_member_id: 'XYZ123456789',
    preferred_language: 'English',
    emergency_contact_name: 'John Doe', emergency_contact_phone: '5125550199',
  },
  {
    first_name: 'Carlos', last_name: 'Rivera', date_of_birth: '1972-11-03', sex: 'Male',
    phone_number: '3055550187', address_line_1: '88 Ocean Dr',
    city: 'Miami', state: 'FL', zip_code: '33139-1234', preferred_language: 'Spanish',
  },
];

export async function seedIfEmpty(db) {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM patients');
  if (rows[0].n > 0) return;
  for (const p of DEMO_PATIENTS) {
    const cols = Object.keys(p);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    await db.query(`INSERT INTO patients (${cols.join(', ')}) VALUES (${placeholders})`, Object.values(p));
  }
  logger.info({ count: DEMO_PATIENTS.length }, 'seeded demo patients');
}
