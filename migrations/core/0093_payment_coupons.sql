-- Coupons reuse the finite session ledger; their value is a fixed USD discount per use.
ALTER TABLE payment_products ADD COLUMN is_coupon INTEGER NOT NULL DEFAULT 0 CHECK(is_coupon IN (0,1));
ALTER TABLE payment_entitlements ADD COLUMN is_coupon INTEGER NOT NULL DEFAULT 0 CHECK(is_coupon IN (0,1));
ALTER TABLE payment_redemptions ADD COLUMN discount_cents INTEGER NOT NULL DEFAULT 0 CHECK(discount_cents>=0);
