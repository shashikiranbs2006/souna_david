-- The David edition is one shop with no manufacturer admin. Drop what only the manufacturer
-- admin used: its sign-in table and the cross-shop statistics functions. Shop data, the
-- catalogue and the single `manufacturers` row that owns it stay.

DROP FUNCTION IF EXISTS staff_principal_for_manufacturer(text);
DROP FUNCTION IF EXISTS reseller_overview(uuid, uuid);
DROP FUNCTION IF EXISTS reseller_request_status_counts(uuid);
DROP FUNCTION IF EXISTS reseller_stats(uuid, timestamptz);
DROP TABLE IF EXISTS manufacturer_admins;
