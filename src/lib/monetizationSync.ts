import {
  getPendingCheckoutsForBuyer,
  markCheckoutPaidByOrderId,
  type PendingCheckout,
} from "@/lib/entitlementLedger";
import { findCompletedPaymentForOrder } from "@/lib/squareCheckout";

export async function syncPendingSquarePaymentsForBuyer(buyerId: string): Promise<PendingCheckout[]> {
  const pending = await getPendingCheckoutsForBuyer(buyerId);
  const paid: PendingCheckout[] = [];

  for (const checkout of pending) {
    if (!checkout.orderId) continue;
    const payment = await findCompletedPaymentForOrder({
      orderId: checkout.orderId,
      amountCents: checkout.amountCents,
      createdAt: checkout.createdAt,
    });
    if (!payment) continue;
    const updated = await markCheckoutPaidByOrderId(checkout.orderId);
    if (updated) paid.push(updated);
  }

  return paid;
}
