import assert from "node:assert/strict";
import test from "node:test";

import {
  parseOwnershipPayloads,
  refreshOwnership,
  type OwnershipCacheRecord,
  type OwnershipRepository,
} from "../lib/ownership-service.ts";

class MemoryOwnershipRepository implements OwnershipRepository {
  caches = new Map<string, OwnershipCacheRecord<unknown>>();

  async getCache<T>(key: string): Promise<OwnershipCacheRecord<T> | null> {
    return this.caches.get(key) as OwnershipCacheRecord<T> | undefined ?? null;
  }

  async setCache<T>(key: string, payload: T, fetchedAt: string): Promise<void> {
    this.caches.set(key, { payload, fetchedAt });
  }
}

const institutionalPayload = {
  data: {
    ownershipSummary: {
      SharesOutstandingPCT: { value: "83.90%" },
      ShareoutstandingTotal: { value: "7,426" },
    },
    holdingsTransactions: {
      table: {
        rows: [
          { date: "3/31/2026", ownerName: "Vanguard Group Inc" },
          { date: "12/31/2025", ownerName: "Blackrock, Inc." },
        ],
      },
    },
  },
};

const insiderPayload = {
  data: {
    transactionTable: {
      table: {
        rows: [
          { insider: "ALICE", ownType: "Direct", lastDate: "7/15/2026", sharesHeld: "100,000" },
          { insider: "ALICE", ownType: "Direct", lastDate: "6/1/2026", sharesHeld: "90,000" },
          { insider: "BOB", ownType: "Direct", lastDate: "7/1/2026", sharesHeld: "50,000" },
          { insider: "BOB", ownType: "Indirect", lastDate: "7/1/2026", sharesHeld: "25,000" },
        ],
      },
    },
  },
};

test("parses the three ownership shares and quarter disclosure deadline", () => {
  const feed = parseOwnershipPayloads("msft", institutionalPayload, insiderPayload, new Date("2026-08-02T00:00:00.000Z"));

  assert.equal(feed.ticker, "MSFT");
  assert.equal(feed.institutionalPct, 83.9);
  assert.equal(feed.dataAsOf, "2026-03-31");
  assert.equal(feed.disclosureDueDate, "2026-05-15");
  assert.equal(feed.insiderMajorHolderPctEstimate, 175_000 / 7_426_000_000 * 100);
  assert.equal(feed.retailUnclassifiedPct, 100 - feed.institutionalPct - feed.insiderMajorHolderPctEstimate);
});

test("scans the upstream source on every refresh and keeps the last result on failure", async () => {
  const repository = new MemoryOwnershipRepository();
  let requestCount = 0;
  const fetcher: typeof fetch = async (input) => {
    requestCount += 1;
    const url = String(input);
    if (url.includes("institutional-holdings")) return new Response(JSON.stringify(institutionalPayload), { status: 200 });
    if (url.includes("insider-trades")) return new Response(JSON.stringify(insiderPayload), { status: 200 });
    throw new Error(`Unexpected URL: ${url}`);
  };

  const runtime = { fetcher, now: () => new Date("2026-08-02T00:00:00.000Z") };
  const first = await refreshOwnership(repository, "MSFT", runtime);
  const second = await refreshOwnership(repository, "MSFT", runtime);

  assert.equal(first.status, "ready");
  assert.equal(second.status, "ready");
  assert.equal(requestCount, 4);

  const stale = await refreshOwnership(repository, "MSFT", {
    ...runtime,
    fetcher: async () => { throw new Error("upstream unavailable"); },
  });
  assert.equal(stale.status, "stale");
  assert.equal(stale.institutionalPct, 83.9);
});
