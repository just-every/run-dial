-- PAY-003 (D7): a person erasure's receipt counts the Stripe customers Dial created or used for the payer, which stay
-- in the host's own Stripe account because Dial does not ask Stripe to delete them.
-- Additive: receipts written before this migration keep NULL, meaning they were never counted.
ALTER TABLE person_erasure_receipts ADD COLUMN stripe_customers_retained INTEGER;
