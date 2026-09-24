const CALL_COLUMNS = [
  'patient_id', 'caller_number', 'status', 'outcome', 'ended_reason', 'summary',
  'transcript', 'collected_data', 'started_at', 'ended_at',
];

/**
 * Calls are written piecemeal by different webhook events (status updates,
 * tool calls, end-of-call report) that can arrive in any order, so every write
 * is an upsert that only touches the columns it was given.
 */
export function createCallRepository(db) {
  return {
    async upsert(callId, fields) {
      const cols = CALL_COLUMNS.filter((c) => fields[c] !== undefined);
      const values = cols.map((c) => (c === 'collected_data' ? JSON.stringify(fields[c]) : fields[c]));
      const insertCols = ['call_id', ...cols];
      const placeholders = insertCols.map((_, i) => `$${i + 1}`).join(', ');
      const updates = [...cols.map((c) => `${c} = EXCLUDED.${c}`), 'updated_at = now()'].join(', ');
      await db.query(
        `INSERT INTO calls (${insertCols.join(', ')}) VALUES (${placeholders})
         ON CONFLICT (call_id) DO UPDATE SET ${updates}`,
        [callId, ...values],
      );
    },

    /**
     * Final write for a call. Calls that never reached a successful save are
     * marked 'incomplete' (dropped line, caller hung up) so staff can follow up
     * using the stored transcript.
     */
    async recordEnded(callId, { caller_number, ended_reason, summary, transcript, started_at, ended_at }) {
      await db.query(
        `INSERT INTO calls (call_id, caller_number, status, outcome, ended_reason, summary, transcript, started_at, ended_at)
         VALUES ($1, $2, 'ended', 'incomplete', $3, $4, $5, $6, $7)
         ON CONFLICT (call_id) DO UPDATE SET
           caller_number = COALESCE(calls.caller_number, EXCLUDED.caller_number),
           status        = 'ended',
           outcome       = COALESCE(calls.outcome, 'incomplete'),
           ended_reason  = EXCLUDED.ended_reason,
           summary       = EXCLUDED.summary,
           transcript    = EXCLUDED.transcript,
           started_at    = COALESCE(calls.started_at, EXCLUDED.started_at),
           ended_at      = EXCLUDED.ended_at,
           updated_at    = now()`,
        [callId, caller_number, ended_reason, summary, transcript, started_at, ended_at],
      );
    },

    async listForPatient(patientId) {
      const { rows } = await db.query(
        `SELECT call_id, caller_number, status, outcome, ended_reason, summary, transcript,
                started_at, ended_at, created_at
         FROM calls WHERE patient_id = $1 ORDER BY created_at DESC`,
        [patientId],
      );
      return rows;
    },

    async listRecent(limit = 50) {
      const { rows } = await db.query(
        `SELECT c.call_id, c.patient_id, c.caller_number, c.status, c.outcome, c.ended_reason,
                c.summary, c.transcript, c.collected_data, c.started_at, c.ended_at, c.created_at,
                p.first_name, p.last_name
         FROM calls c LEFT JOIN patients p ON p.patient_id = c.patient_id
         ORDER BY c.created_at DESC LIMIT $1`,
        [limit],
      );
      return rows;
    },
  };
}
