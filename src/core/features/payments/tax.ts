import { z } from "zod";
import type { StripeApi } from "./stripe-api";

/** A US billing address for Stripe Tax. Dial sends it to Stripe and keeps only the tax figures Stripe returns. */
export const billingAddressSchema = z.object({
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().regex(/^[A-Za-z]{2}$/).transform(value => value.toUpperCase()),
  postalCode: z.string().trim().regex(/^\d{5}(-\d{4})?$/),
  country: z.literal("US"),
}).strict();
export type BillingAddress = z.infer<typeof billingAddressSchema>;
export type TaxFigures = { taxCents: number; summary: string | null; calculationId: string };

/** Services sold through Dial use Stripe's general services tax code. */
export const serviceTaxCode = "txcd_20030000";

/** Stripe Tax calculates US sales tax on the whole price by the invitee's address; a non-taxable address returns none. */
export async function calculateTax(api: StripeApi, accountId: string, input: { amountCents: number; reference: string; address: BillingAddress }): Promise<TaxFigures> {
  const calculation = await api.createTaxCalculation(accountId, {
    currency: "usd",
    "line_items[0][amount]": String(input.amountCents),
    "line_items[0][reference]": input.reference.slice(0, 200),
    "line_items[0][tax_behavior]": "exclusive",
    "line_items[0][tax_code]": serviceTaxCode,
    "customer_details[address][line1]": input.address.line1,
    ...(input.address.line2 ? { "customer_details[address][line2]": input.address.line2 } : {}),
    "customer_details[address][city]": input.address.city,
    "customer_details[address][state]": input.address.state,
    "customer_details[address][postal_code]": input.address.postalCode,
    "customer_details[address][country]": input.address.country,
    "customer_details[address_source]": "billing",
  });
  const taxCents = calculation.tax_amount_exclusive;
  if (!Number.isInteger(taxCents) || taxCents < 0 || calculation.amount_total !== input.amountCents + taxCents) throw new Error("Stripe Tax returned an inconsistent calculation");
  const parts = calculation.tax_breakdown.filter(part => part.amount > 0).map(part => [part.tax_rate_details?.state, part.tax_rate_details?.display_name, part.tax_rate_details?.percentage_decimal ? `${Number(part.tax_rate_details.percentage_decimal)}%` : undefined].filter(Boolean).join(" "));
  return { taxCents, summary: taxCents > 0 ? parts.join(", ").slice(0, 200) || "Sales tax" : null, calculationId: calculation.id };
}
