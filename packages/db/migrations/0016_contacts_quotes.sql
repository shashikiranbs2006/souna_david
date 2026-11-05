-- 0016 Contacts and quotes (David edition).
--
-- Customers do not configure in this edition: the reseller types a contact in, builds the
-- configuration for them in the admin and sends a quote. A contact is a person or organisation
-- without an account (so no verified e-mail, no login); it is separate from `customers`.
--
--   * contacts: person, organisation, e-mail, mobile, notes. One reseller, tenant RLS.
--   * quotes: numbered per reseller (Q-1024, Q-1025, ...), several versions per number, each
--     version for one contact and one configuration, with a quantity, a comment and extra lines
--     (delivery, installation, ...). Money is in the reseller currency, minor units.

CREATE TABLE contacts (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_id         uuid        NOT NULL REFERENCES resellers (id),
  person_name         text        NOT NULL CHECK (length(btrim(person_name)) BETWEEN 1 AND 200),
  organisation        text        CHECK (length(organisation) <= 200),
  email               text        CHECK (length(email) <= 254 AND email ~ '^[^@\s]+@[^@\s]+$'),
  mobile              text        CHECK (length(mobile) <= 40),
  notes               text        CHECK (length(notes) <= 4000),
  created_by_staff_id uuid        REFERENCES staff_users (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contacts_id_reseller_key UNIQUE (id, reseller_id)
);
CREATE INDEX contacts_reseller_created_idx ON contacts (reseller_id, created_at DESC);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE quotes (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_id         uuid        NOT NULL REFERENCES resellers (id),
  number              integer     NOT NULL CHECK (number >= 1024),
  version             integer     NOT NULL DEFAULT 1 CHECK (version >= 1),
  contact_id          uuid        NOT NULL,
  configuration_id    uuid        NOT NULL,
  quantity            integer     NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 99),
  comment             text        CHECK (length(comment) <= 4000),
  status              text        NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED')),
  created_by_staff_id uuid        REFERENCES staff_users (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quotes_id_reseller_key UNIQUE (id, reseller_id),
  CONSTRAINT quotes_number_version_key UNIQUE (reseller_id, number, version),
  CONSTRAINT quotes_contact_fk FOREIGN KEY (contact_id, reseller_id) REFERENCES contacts (id, reseller_id),
  CONSTRAINT quotes_configuration_fk FOREIGN KEY (configuration_id, reseller_id) REFERENCES configurations (id, reseller_id)
);
CREATE INDEX quotes_contact_idx ON quotes (contact_id, created_at DESC);
CREATE INDEX quotes_reseller_created_idx ON quotes (reseller_id, created_at DESC);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON quotes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE quote_lines (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_id  uuid    NOT NULL,
  quote_id     uuid    NOT NULL,
  position     integer NOT NULL CHECK (position >= 0),
  label        text    NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 200),
  amount_minor bigint  NOT NULL,
  CONSTRAINT quote_lines_quote_fk FOREIGN KEY (quote_id, reseller_id) REFERENCES quotes (id, reseller_id) ON DELETE CASCADE,
  CONSTRAINT quote_lines_position_key UNIQUE (quote_id, position)
);

-- Tenant isolation: own rows only.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contacts', 'quotes', 'quote_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_all ON %I FOR ALL TO app_tenant USING (reseller_id = (SELECT app_reseller_id())) WITH CHECK (reseller_id = (SELECT app_reseller_id()))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_tenant', t);
  END LOOP;
END $$;
