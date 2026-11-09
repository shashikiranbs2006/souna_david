-- The David edition has no customer accounts and no requests: visitors configure a sauna and the
-- shop answers with a quote (contacts, quotes, invoices, share links). Drop everything only the
-- customer accounts and the request workflow used, plus the notification outbox, which only
-- carried the request e-mails and the AWS edge tenant sync (offer mails go out directly).

-- Share links created by a customer account go with the accounts.
DELETE FROM share_links WHERE created_by_customer_id IS NOT NULL;

-- Request workflow.
DROP TABLE request_quotes, request_notes, request_status_history, request_status_transitions,
           configuration_requests, request_statuses;
DROP FUNCTION configuration_requests_guard();
DROP FUNCTION configuration_requests_history();
DROP FUNCTION request_notes_guard();
DROP FUNCTION request_quotes_guard();
DROP FUNCTION request_quotes_outbox();

-- Configurations owned by a customer (not by shop staff) are unreachable now. Remove the ones
-- nothing else points at; the immutability triggers guard locked configurations, so they are
-- paused for this one statement.
ALTER TABLE configurations DISABLE TRIGGER USER;
ALTER TABLE configuration_selections DISABLE TRIGGER USER;
ALTER TABLE configuration_room_placements DISABLE TRIGGER USER;
ALTER TABLE configuration_price_snapshots DISABLE TRIGGER USER;
ALTER TABLE configuration_price_snapshot_lines DISABLE TRIGGER USER;
DELETE FROM configurations c
 WHERE c.customer_id IS NOT NULL AND c.created_by_staff_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM quotes q WHERE q.configuration_id = c.id)
   AND NOT EXISTS (SELECT 1 FROM share_links s WHERE s.configuration_id = c.id);
ALTER TABLE configurations ENABLE TRIGGER USER;
ALTER TABLE configuration_selections ENABLE TRIGGER USER;
ALTER TABLE configuration_room_placements ENABLE TRIGGER USER;
ALTER TABLE configuration_price_snapshots ENABLE TRIGGER USER;
ALTER TABLE configuration_price_snapshot_lines ENABLE TRIGGER USER;

-- Outbox, e-mail suppressions (written by the SES feedback worker) and the tenant sync trigger.
DROP TRIGGER resellers_tenant_sync_insert ON resellers;
DROP TRIGGER resellers_tenant_sync_update ON resellers;
DROP FUNCTION resellers_tenant_sync();
DROP TABLE notification_outbox, email_suppressions;

-- Retention no longer has sign-ups or an outbox to clean.
CREATE OR REPLACE FUNCTION run_retention() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_views bigint; v_audit bigint;
BEGIN
  DELETE FROM share_link_views WHERE viewed_at < now() - interval '13 months';
  GET DIAGNOSTICS v_views = ROW_COUNT;
  DELETE FROM audit_events WHERE occurred_at < now() - interval '24 months';
  GET DIAGNOSTICS v_audit = ROW_COUNT;
  RETURN jsonb_build_object('shareLinkViews', v_views, 'auditEvents', v_audit);
END
$$;

-- Share links are always created by shop staff.
ALTER TABLE share_links DROP CONSTRAINT share_links_one_creator;
ALTER TABLE share_links DROP COLUMN created_by_customer_id;
ALTER TABLE share_links ALTER COLUMN created_by_staff_id SET NOT NULL;

-- Configurations lose their owner and clone source. (The unique key on id, reseller_id,
-- customer_id and the foreign keys on these columns go with them.)
CREATE OR REPLACE FUNCTION configurations_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.locked_at IS NOT NULL THEN
      PERFORM raise_rule('CONFIGURATION_LOCKED', 'a locked configuration cannot be deleted');
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.locked_at IS NOT NULL THEN
      -- The snapshot references the configuration, so it cannot exist yet: insert, then lock.
      PERFORM raise_rule('SNAPSHOT_MISSING', 'a configuration is created as a draft and locked afterwards');
    END IF;
    PERFORM assert_reseller_staff(NEW.reseller_id, NEW.created_by_staff_id);
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD.locked_at IS NOT NULL THEN
    -- Covers clearing locked_at too.
    PERFORM raise_rule('CONFIGURATION_LOCKED', 'a locked configuration is immutable');
  END IF;
  IF NEW.reseller_id <> OLD.reseller_id OR NEW.created_at <> OLD.created_at THEN
    PERFORM raise_rule('CONFIGURATION_IMMUTABLE_FIELD', 'reseller and creation time cannot change');
  END IF;
  IF NEW.created_by_staff_id IS DISTINCT FROM OLD.created_by_staff_id THEN
    PERFORM assert_reseller_staff(NEW.reseller_id, NEW.created_by_staff_id);
  END IF;
  IF NEW.locked_at IS NOT NULL THEN
    PERFORM assert_configuration_lockable(NEW.id);
  END IF;
  RETURN NEW;
END
$$;
ALTER TABLE configurations DROP CONSTRAINT configurations_owner;
ALTER TABLE configurations DROP COLUMN customer_id;
ALTER TABLE configurations DROP COLUMN source_configuration_id;

-- Audit rows only know staff actors now.
CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_keys  text[] := string_to_array(TG_ARGV[0], ',');
  v_cols  text[] := string_to_array(TG_ARGV[1], ',');
  v_old   jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  v_new   jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_row   jsonb := coalesce(v_new, v_old);
  v_res   uuid;
BEGIN
  IF TG_ARGV[1] <> '*' THEN
    v_old := (SELECT jsonb_object_agg(key, value) FROM jsonb_each(v_old) WHERE key = ANY (v_cols));
    v_new := (SELECT jsonb_object_agg(key, value) FROM jsonb_each(v_new) WHERE key = ANY (v_cols));
  ELSE
    v_old := v_old - 'created_at' - 'updated_at';
    v_new := v_new - 'created_at' - 'updated_at';
  END IF;
  v_res := CASE WHEN TG_TABLE_NAME = 'resellers' THEN (v_row ->> 'id')::uuid ELSE (v_row ->> 'reseller_id')::uuid END;

  INSERT INTO audit_events (reseller_id, actor_staff_id, action, entity_type, entity_id, details)
  VALUES (
    v_res, app_actor_staff_id(),
    TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME,
    (SELECT string_agg(v_row ->> k, ':' ORDER BY ord) FROM unnest(v_keys) WITH ORDINALITY AS u(k, ord)),
    jsonb_build_object('old', v_old, 'new', v_new));
  RETURN NULL;
END
$$;
ALTER TABLE audit_events DROP COLUMN actor_customer_id;

-- Customer accounts.
DROP TABLE customer_consents, customer_addresses, customers;
DROP FUNCTION anonymise_customer(uuid);
DROP FUNCTION customers_guard();
DROP FUNCTION delete_expired_pending_customers(timestamptz, integer);
DROP FUNCTION search_customer_ids(uuid, text, integer, timestamptz, uuid);
DROP FUNCTION app_actor_kind();
DROP FUNCTION app_actor_customer_id();
