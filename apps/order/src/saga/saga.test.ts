import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { startSaga, transition } from "./saga.orchestrator.js";
import type { CheckoutSaga, SagaEvent } from "./saga.types.js";

const orderId = randomUUID();
const items = [{ sku: "mug", quantity: 2 }];

function evt<T extends SagaEvent["type"]>(
  type: T,
  payload: Extract<SagaEvent, { type: T }>["payload"],
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
    const r = transition(saga, e);
    saga = r.saga;
    sent.push(...r.messages.map((m) => m.type));
  }
  return { saga, sent };
};

describe("checkout saga", () => {
  it("starts by reserving stock", () => {
    const { saga, messages } = startSaga(orderId, items, 2400);
    assert.equal(saga.state, "AWAITING_STOCK");
    assert.deepEqual(messages, [{ type: "checkout.cmd.inventory.reserve", payload: { items } }]);
  });

  it("happy path: reserved → captured → confirmed", () => {
    const { saga, sent } = run(
      startSaga(orderId, items, 2400).saga,
      evt("checkout.evt.inventory.reserved", {}),
      evt("checkout.evt.payment.captured", {}),
    );
    assert.equal(saga.state, "CONFIRMED");
    assert.deepEqual(sent, ["checkout.cmd.payment.capture", "checkout.evt.order.confirmed"]);
  });

  it("asks payment for the saga amount", () => {
    const r = transition(startSaga(orderId, items, 2400).saga, evt("checkout.evt.inventory.reserved", {}));
    assert.deepEqual(r.messages[0], { type: "checkout.cmd.payment.capture", payload: { amount: 2400 } });
  });

  it("out of stock cancels without compensation", () => {
    const { saga, sent } = run(
      startSaga(orderId, items, 2400).saga,
      evt("checkout.evt.inventory.rejected", { reason: "out of stock", skus: ["mug"] }),
    );
    assert.equal(saga.state, "CANCELLED");
    assert.equal(saga.cancelReason, "out of stock");
    assert.deepEqual(sent, ["checkout.evt.order.cancelled"]);
  });

  it("payment failure releases stock, then cancels with the payment reason", () => {
    const { saga, sent } = run(
      startSaga(orderId, items, 2400).saga,
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
    const start = startSaga(orderId, items, 2400).saga;
    const r = transition(start, evt("checkout.evt.payment.captured", {}));
    assert.equal(r.saga, start);
    assert.deepEqual(r.messages, []);
  });

  it("terminal states never move again", () => {
    const { saga } = run(
      startSaga(orderId, items, 2400).saga,
      evt("checkout.evt.inventory.reserved", {}),
      evt("checkout.evt.payment.captured", {}),
    );
    const r = transition(saga, evt("checkout.evt.payment.failed", { reason: "late" }));
    assert.equal(r.saga.state, "CONFIRMED");
    assert.deepEqual(r.messages, []);
  });
});
