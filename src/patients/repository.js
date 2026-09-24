import { PATIENT_FIELD_NAMES } from './validation.js';

// Column names below come only from the PATIENT_FIELD_NAMES whitelist, never
// from user input, so interpolating them into SQL is safe. Values are always
// bound parameters.

export function createPatientRepository(db) {
  return {
    async insert(fields) {
      const cols = PATIENT_FIELD_NAMES.filter((c) => fields[c] !== undefined);
      const params = cols.map((c) => fields[c]);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      const { rows } = await db.query(
        `INSERT INTO patients (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
        params,
      );
      return rows[0];
    },

    async findById(id) {
      const { rows } = await db.query(
        'SELECT * FROM patients WHERE patient_id = $1 AND deleted_at IS NULL',
        [id],
      );
      return rows[0] ?? null;
    },

    async findByPhone(phoneNumber) {
      const { rows } = await db.query(
        `SELECT * FROM patients WHERE phone_number = $1 AND deleted_at IS NULL
         ORDER BY updated_at DESC`,
        [phoneNumber],
      );
      return rows;
    },

    async list({ lastName, dateOfBirth, phoneNumber, limit, offset }) {
      const where = ['deleted_at IS NULL'];
      const params = [];
      const add = (sql, value) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };
      if (lastName) add('lower(last_name) = lower(?)', lastName);
      if (dateOfBirth) add('date_of_birth = ?', dateOfBirth);
      if (phoneNumber) add('phone_number = ?', phoneNumber);
      const whereSql = where.join(' AND ');

      const { rows: countRows } = await db.query(
        `SELECT count(*)::int AS total FROM patients WHERE ${whereSql}`,
        params,
      );
      const { rows } = await db.query(
        `SELECT * FROM patients WHERE ${whereSql}
         ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      return { rows, total: countRows[0].total };
    },

    async update(id, fields) {
      const cols = PATIENT_FIELD_NAMES.filter((c) => fields[c] !== undefined);
      const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
      const { rows } = await db.query(
        `UPDATE patients SET ${sets} WHERE patient_id = $1 AND deleted_at IS NULL RETURNING *`,
        [id, ...cols.map((c) => fields[c])],
      );
      return rows[0] ?? null;
    },

    async softDelete(id) {
      const { rows } = await db.query(
        `UPDATE patients SET deleted_at = now() WHERE patient_id = $1 AND deleted_at IS NULL RETURNING *`,
        [id],
      );
      return rows[0] ?? null;
    },
  };
}
