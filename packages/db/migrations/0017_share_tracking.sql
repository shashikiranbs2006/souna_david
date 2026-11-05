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
