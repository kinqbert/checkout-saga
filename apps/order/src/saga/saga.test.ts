import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { startSaga, transition } from "./saga.orchestrator.js";
import { PAYMENT_TIMEOUT_REASON, STOCK_TIMEOUT_REASON } from "./saga.handlers.js";
import type { CheckoutSaga, SagaEvent, SagaTimeout } from "./saga.types.js";

const orderId = randomUUID();
const items = [{ sku: "mug", quantity: 2 }];
const ctx = { deadline: "2026-01-01T00:00:20.000Z" };
const timeout: SagaTimeout = { type: "saga.timeout" };
type MessageEvent = Exclude<SagaEvent, SagaTimeout>;

function evt<T extends MessageEvent["type"]>(
  type: T,
  payload: Extract<MessageEvent, { type: T }>["payload"],
): SagaEvent {
  return {
    id: randomUUID(),
    orderId,
    occurredAt: new Date().toISOString(),
    type,
    payload,
  } as SagaEvent;
}

const run = (saga: CheckoutSaga, ...events: SagaEvent[]) => {
  const sent: string[] = [];
  for (const e of events) {
    const r = transition(saga, e, ctx);
    saga = r.saga;
    sent.push(...r.messages.map((m) => m.type));
  }
  return { saga, sent };
};

describe("checkout saga", () => {
  it("starts by reserving stock", () => {
    const { saga, messages } = startSaga(orderId, items, 2400, ctx);
    assert.equal(saga.state, "AWAITING_STOCK");
    assert.deepEqual(messages, [{ type: "checkout.cmd.inventory.reserve", payload: { items, deadline: ctx.deadline } }]);
  });

  it("happy path: reserved → captured → confirmed", () => {
    const { saga, sent } = run(
      startSaga(orderId, items, 2400, ctx).saga,
      evt("checkout.evt.inventory.reserved", {}),
      evt("checkout.evt.payment.captured", {}),
    );
    assert.equal(saga.state, "CONFIRMED");
    assert.deepEqual(sent, ["checkout.cmd.payment.capture", "checkout.evt.order.confirmed"]);
  });

  it("asks payment for the saga amount", () => {
    const r = transition(startSaga(orderId, items, 2400, ctx).saga, evt("checkout.evt.inventory.reserved", {}), ctx);
    assert.deepEqual(r.messages[0], { type: "checkout.cmd.payment.capture", payload: { amount: 2400, deadline: ctx.deadline } });
  });

  it("out of stock cancels without compensation", () => {
    const { saga, sent } = run(
      startSaga(orderId, items, 2400, ctx).saga,
      evt("checkout.evt.inventory.rejected", { reason: "out of stock", skus: ["mug"] }),
    );
    assert.equal(saga.state, "CANCELLED");
    assert.equal(saga.cancelReason, "out of stock");
    assert.deepEqual(sent, ["checkout.evt.order.cancelled"]);
  });

  it("payment failure releases stock, then cancels with the payment reason", () => {
    const { saga, sent } = run(
      startSaga(orderId, items, 2400, ctx).saga,
      evt("checkout.evt.inventory.reserved", {}),
      evt("checkout.evt.payment.failed", { reason: "card declined" }),
      evt("checkout.evt.inventory.released", {}),
    );
    assert.equal(saga.state, "CANCELLED");
    assert.equal(saga.cancelReason, "card declined");
    assert.deepEqual(sent, [
      "checkout.cmd.payment.capture",
      "checkout.cmd.inventory.release",
      "checkout.evt.order.cancelled",
    ]);
  });

  it("ignores events that do not fit the current state", () => {
    const start = startSaga(orderId, items, 2400, ctx).saga;
    const r = transition(start, evt("checkout.evt.payment.captured", {}), ctx);
    assert.equal(r.saga, start);
    assert.deepEqual(r.messages, []);
  });

  it("terminal states never move again", () => {
    const { saga } = run(
      startSaga(orderId, items, 2400, ctx).saga,
      evt("checkout.evt.inventory.reserved", {}),
      evt("checkout.evt.payment.captured", {}),
    );
    const r = transition(saga, evt("checkout.evt.payment.failed", { reason: "late" }), ctx);
    assert.equal(r.saga.state, "CONFIRMED");
    assert.deepEqual(r.messages, []);
  });

  describe("timeouts", () => {
    it("no answer from inventory cancels, nothing to undo", () => {
      const { saga, sent } = run(startSaga(orderId, items, 2400, ctx).saga, timeout);
      assert.equal(saga.state, "CANCELLED");
      assert.equal(saga.cancelReason, STOCK_TIMEOUT_REASON);
      assert.deepEqual(sent, ["checkout.evt.order.cancelled"]);
    });

    it("no answer from payment releases stock, then cancels", () => {
      const { saga, sent } = run(
        startSaga(orderId, items, 2400, ctx).saga,
        evt("checkout.evt.inventory.reserved", {}),
        timeout,
        evt("checkout.evt.inventory.released", {}),
      );
      assert.equal(saga.state, "CANCELLED");
      assert.equal(saga.cancelReason, PAYMENT_TIMEOUT_REASON);
      assert.deepEqual(sent, ["checkout.cmd.payment.capture", "checkout.cmd.inventory.release", "checkout.evt.order.cancelled"]);
    });

    it("stock reserved after the timeout is released", () => {
      const { saga, sent } = run(
        startSaga(orderId, items, 2400, ctx).saga,
        timeout,
        evt("checkout.evt.inventory.reserved", {}),
      );
      assert.equal(saga.state, "CANCELLED");
      assert.deepEqual(sent, ["checkout.evt.order.cancelled", "checkout.cmd.inventory.release"]);
    });

    it("a card charged after the timeout is refunded, whether stock is still releasing or already back", () => {
      const releasing = run(
        startSaga(orderId, items, 2400, ctx).saga,
        evt("checkout.evt.inventory.reserved", {}),
        timeout,
        evt("checkout.evt.payment.captured", {}),
      );
      assert.equal(releasing.saga.state, "RELEASING_STOCK");
      assert.equal(releasing.sent.at(-1), "checkout.cmd.payment.refund");

      const cancelled = run(releasing.saga, evt("checkout.evt.inventory.released", {}), evt("checkout.evt.payment.captured", {}));
      assert.equal(cancelled.saga.state, "CANCELLED");
      assert.deepEqual(cancelled.sent, ["checkout.evt.order.cancelled", "checkout.cmd.payment.refund"]);
    });

    it("a timeout after the saga ended changes nothing", () => {
      const { saga } = run(
        startSaga(orderId, items, 2400, ctx).saga,
        evt("checkout.evt.inventory.reserved", {}),
        evt("checkout.evt.payment.captured", {}),
      );
      const r = transition(saga, timeout, ctx);
      assert.equal(r.saga, saga);
      assert.deepEqual(r.messages, []);
    });
  });
});
