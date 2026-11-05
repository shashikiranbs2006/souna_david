-- 0017 Share-link tracking (David edition, step 4).
--
--   * share_link_views gets a shortened visitor address (IPv4 /24, IPv6 /48; never the full IP)
--     and a trimmed user agent, so "opened from more than one device or network" can be counted.
--   * share_link_activity: one row per page open (client-chosen visit id) with whether the inside
--     view was used and the seconds the page was visible. Upserted while the page is open, so the
--     row is not append-only; it holds no address.

ALTER TABLE share_link_views
  ADD COLUMN ip_prefix  text CHECK (length(ip_prefix) <= 64),
  ADD COLUMN user_agent text CHECK (length(user_agent) <= 200);

CREATE TABLE share_link_activity (
  id            bigint      GENERATED ALWAYS AS IDENTITY UNIQUE,
  share_link_id uuid        NOT NULL,
  reseller_id   uuid        NOT NULL,
  visit_id      uuid        NOT NULL,
  inside_view   boolean     NOT NULL DEFAULT false,
  seconds       integer     NOT NULL DEFAULT 0 CHECK (seconds BETWEEN 0 AND 3600),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (share_link_id, visit_id),
  CONSTRAINT share_link_activity_link_fk FOREIGN KEY (share_link_id, reseller_id)
    REFERENCES share_links (id, reseller_id) ON DELETE CASCADE
);
CREATE INDEX share_link_activity_reseller_idx ON share_link_activity (reseller_id, created_at DESC);

ALTER TABLE share_link_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_link_activity FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_all ON share_link_activity FOR ALL TO app_tenant
  USING (reseller_id = (SELECT app_reseller_id())) WITH CHECK (reseller_id = (SELECT app_reseller_id()));
GRANT SELECT, INSERT, UPDATE ON share_link_activity TO app_tenant;

-- Retention: the worker prunes activity with the views (same period), through the allow-listed
-- batch function of 0011 (replaced here with one more table).
CREATE OR REPLACE FUNCTION retention_delete_batch(p_table text, p_cutoff timestamptz, p_limit int) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_col text;
  n     int;
BEGIN
  v_col := CASE p_table WHEN 'share_link_views' THEN 'viewed_at' WHEN 'audit_events' THEN 'occurred_at' WHEN 'share_link_activity' THEN 'created_at' END;
  IF v_col IS NULL THEN
    PERFORM raise_rule('RETENTION_TABLE_NOT_ALLOWED', format('retention is not allowed on %s', p_table));
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100000 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 100000' USING ERRCODE = '22023';
  END IF;
  EXECUTE format(
    'DELETE FROM %1$I WHERE id IN (SELECT id FROM %1$I WHERE %2$I < $1 ORDER BY %2$I LIMIT $2 FOR UPDATE SKIP LOCKED)',
    p_table, v_col)
  USING p_cutoff, p_limit;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;
