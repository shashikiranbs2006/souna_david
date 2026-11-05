-- 0018 Prepayment invoices (David edition, phase 2).
--
-- A prepayment invoice asks the customer to pay a share (percent) of an accepted quote before
-- delivery. Numbered per reseller (INV-1001, INV-1002, ...). The amount is fixed when the invoice
-- is issued, so later quote edits never change an invoice. No card or bank integration: the
-- reseller marks the invoice paid by hand once the money arrived.

CREATE TABLE invoices (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reseller_id        uuid        NOT NULL REFERENCES resellers (id),
  number             integer     NOT NULL CHECK (number >= 1001),
  quote_id           uuid        NOT NULL,
  contact_id         uuid        NOT NULL,
  percent            integer     NOT NULL CHECK (percent BETWEEN 1 AND 100),
  quote_total_minor  bigint      NOT NULL CHECK (quote_total_minor >= 0),
  amount_minor       bigint      NOT NULL CHECK (amount_minor >= 0),
  status             text        NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED', 'PAID', 'CANCELLED')),
  issued_on          date        NOT NULL,
  due_on             date        NOT NULL,
  paid_at            timestamptz,
  payment_details    text        CHECK (length(payment_details) <= 2000),
  note               text        CHECK (length(note) <= 2000),
  created_by_staff_id uuid       REFERENCES staff_users (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_id_reseller_key UNIQUE (id, reseller_id),
  CONSTRAINT invoices_number_key UNIQUE (reseller_id, number),
  CONSTRAINT invoices_due_after_issue CHECK (due_on >= issued_on),
  CONSTRAINT invoices_paid_state CHECK ((status = 'PAID') = (paid_at IS NOT NULL)),
  CONSTRAINT invoices_quote_fk FOREIGN KEY (quote_id, reseller_id) REFERENCES quotes (id, reseller_id),
  CONSTRAINT invoices_contact_fk FOREIGN KEY (contact_id, reseller_id) REFERENCES contacts (id, reseller_id)
);
CREATE INDEX invoices_reseller_created_idx ON invoices (reseller_id, created_at DESC);
CREATE INDEX invoices_quote_idx ON invoices (quote_id);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_all ON invoices FOR ALL TO app_tenant
  USING (reseller_id = (SELECT app_reseller_id())) WITH CHECK (reseller_id = (SELECT app_reseller_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON invoices TO app_tenant;
