import { SpanKind, withSpan } from "@checkout/telemetry";

/** Demo rule: the fake card has a $500 limit. */
export const CARD_LIMIT_CENTS = Number(process.env.PAYMENT_LIMIT_CENTS ?? 50_000);
const RANDOM_FAILURE_RATE = Number(process.env.PAYMENT_RANDOM_FAILURE_RATE ?? 0);

export type ChargeResult = { ok: true } | { ok: false; reason: string };

/**
 * Stand-in for a payment provider (Stripe and the like). Real providers take an
 * idempotency key; we pass the order id so a retried charge is not doubled.
 */
export function charge(idempotencyKey: string, amount: number): Promise<ChargeResult> {
  return withSpan(
    "psp.charge",
    { kind: SpanKind.CLIENT, attributes: { "psp.idempotency_key": idempotencyKey, "psp.amount": amount } },
    async (span) => {
      await new Promise((r) => setTimeout(r, 150 + Math.random() * 350));
      let result: ChargeResult = { ok: true };
      if (amount > CARD_LIMIT_CENTS) {
        result = { ok: false, reason: `card declined: over the $${CARD_LIMIT_CENTS / 100} limit` };
      } else if (Math.random() < RANDOM_FAILURE_RATE) {
        result = { ok: false, reason: "card declined: issuer unavailable" };
      }
      span.setAttribute("psp.approved", result.ok);
      return result;
    },
  );
}

/** Refunds a captured charge (same idempotency key as the charge). */
export function refundCharge(idempotencyKey: string, amount: number): Promise<void> {
  return withSpan(
    "psp.refund",
    { kind: SpanKind.CLIENT, attributes: { "psp.idempotency_key": idempotencyKey, "psp.amount": amount } },
    () => new Promise<void>((r) => setTimeout(r, 100 + Math.random() * 200)),
  );
}

/** Failure lab "slow provider": its answer arrives 3 s after the order's deadline. */
export function slowProvider(deadline: string): Promise<void> {
  const ms = Math.max(0, Date.parse(deadline) + 3000 - Date.now());
  return withSpan("demo: slow provider (failure lab)", { attributes: { "demo.hold_ms": ms } }, () =>
    new Promise<void>((r) => setTimeout(r, ms)),
  );
}
