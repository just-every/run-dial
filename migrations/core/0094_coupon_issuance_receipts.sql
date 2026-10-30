-- Non-personal issuance identity survives purchaser erasure, preventing an old command from recreating credit.
ALTER TABLE payment_products ADD COLUMN issuance_key_hash TEXT;
CREATE UNIQUE INDEX payment_coupon_issuance_identity ON payment_products(issuance_key_hash);
