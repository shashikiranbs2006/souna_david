-- The local IdP has a staff pool only; customer accounts no longer exist.
DELETE FROM idp.users WHERE pool = 'CUSTOMER';
ALTER TABLE idp.users DROP CONSTRAINT users_pool_check;
ALTER TABLE idp.users ADD CONSTRAINT users_pool_check CHECK (pool = 'STAFF');
-- Sign-up and password-reset codes belonged to the customer pool.
DROP TABLE idp.codes;
