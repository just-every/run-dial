-- Coupons are a fixed-value, limited-use subtype of session credit. Keeping
-- the existing kind preserves every installed catalog, ledger and foreign key.
ALTER TABLE payment_products ADD COLUMN is_coupon INTEGER NOT NULL DEFAULT 0 CHECK(is_coupon IN (0,1));
ALTER TABLE payment_entitlements ADD COLUMN is_coupon INTEGER NOT NULL DEFAULT 0 CHECK(is_coupon IN (0,1));
ALTER TABLE payment_redemptions ADD COLUMN discount_cents INTEGER NOT NULL DEFAULT 0 CHECK(discount_cents>=0);
