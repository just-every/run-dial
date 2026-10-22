/** Preserve the released erasure command's key and exact body across deployments. */
export const pendingRefundKey = (holdId: string) => `dial-erasure-hold-${holdId}`;
export const pendingRefundParams = (intentId: string, amountCents: number) => ({ payment_intent: intentId, amount: String(amountCents) });
