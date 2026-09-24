-- Idempotent schema: safe to run on every boot.
-- Constraints mirror the application validators so the database is the last
-- line of defence even if a client bypasses the API.

CREATE TABLE IF NOT EXISTS patients (
  patient_id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name              VARCHAR(50)  NOT NULL CHECK (first_name ~ '^[[:alpha:]][[:alpha:]'' .-]*$'),
  last_name               VARCHAR(50)  NOT NULL CHECK (last_name  ~ '^[[:alpha:]][[:alpha:]'' .-]*$'),
  date_of_birth           DATE         NOT NULL CHECK (date_of_birth >= DATE '1900-01-01' AND date_of_birth <= CURRENT_DATE),
  sex                     VARCHAR(20)  NOT NULL CHECK (sex IN ('Male', 'Female', 'Other', 'Decline to Answer')),
  phone_number            CHAR(10)     NOT NULL CHECK (phone_number ~ '^[2-9][0-9]{9}$'),
  email                   VARCHAR(254)          CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  address_line_1          VARCHAR(100) NOT NULL CHECK (length(address_line_1) > 0),
  address_line_2          VARCHAR(100),
  city                    VARCHAR(100) NOT NULL CHECK (length(city) > 0),
  state                   CHAR(2)      NOT NULL CHECK (state ~ '^[A-Z]{2}$'),
  zip_code                VARCHAR(10)  NOT NULL CHECK (zip_code ~ '^[0-9]{5}(-[0-9]{4})?$'),
  insurance_provider      VARCHAR(100),
  insurance_member_id     VARCHAR(50)           CHECK (insurance_member_id ~ '^[A-Z0-9-]+$'),
  preferred_language      VARCHAR(50)  NOT NULL DEFAULT 'English',
  emergency_contact_name  VARCHAR(100),
  emergency_contact_phone CHAR(10)              CHECK (emergency_contact_phone ~ '^[2-9][0-9]{9}$'),
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
  deleted_at              TIMESTAMPTZ
);

-- Lookups used by the API filters and by the voice agent's duplicate check.
-- Partial indexes: soft-deleted rows are never searched.
CREATE INDEX IF NOT EXISTS patients_phone_idx     ON patients (phone_number)      WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS patients_last_name_idx ON patients (lower(last_name))  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS patients_dob_idx       ON patients (date_of_birth)     WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS patients_set_updated_at ON patients;
CREATE TRIGGER patients_set_updated_at
  BEFORE UPDATE ON patients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One row per phone call. Written by Vapi webhooks; linked to the patient the
-- call created or updated. Keeps the transcript even when a call drops before
-- registration completes, so staff can follow up.
CREATE TABLE IF NOT EXISTS calls (
  call_id         TEXT         PRIMARY KEY,
  patient_id      UUID         REFERENCES patients (patient_id),
  caller_number   VARCHAR(20),
  status          VARCHAR(20)  NOT NULL DEFAULT 'in_progress',
  outcome         VARCHAR(30),
  ended_reason    TEXT,
  summary         TEXT,
  transcript      TEXT,
  collected_data  JSONB,
  started_at      TIMESTAMPTZ,
  ended_at        TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calls_patient_idx ON calls (patient_id);

-- Mock scheduling for the bonus challenge: a single provider, hourly slots.
CREATE TABLE IF NOT EXISTS appointments (
  appointment_id UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id     UUID         NOT NULL REFERENCES patients (patient_id),
  starts_at      TIMESTAMPTZ  NOT NULL,
  reason         VARCHAR(200),
  status         VARCHAR(20)  NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS appointments_slot_idx ON appointments (starts_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS appointments_patient_idx ON appointments (patient_id);
