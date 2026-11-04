import { strict as assert } from "node:assert";
import test from "node:test";
import { fetchTvecAggregation, fetchTvecAggregations } from "../tvec-radar-fetch.js";

function response(status, body = "") {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

test("retries TVEC 429/5xx responses with bounded, injected backoff", async () => {
  const calls = [];
  const sleeps = [];
  const sequence = [response(429), response(503), response(200, "<html>ok</html>")];
  const result = await fetchTvecAggregation("Soluciones de videovigilancia", {
    url: "https://example.test/tvec?Agregacion=Soluciones",
    fetchImpl: async (url, options) => { calls.push({ url, options }); return sequence.shift(); },
    sleep: async ms => sleeps.push(ms), maxAttempts: 3, baseDelayMs: 10,
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.attempts, 3);
  assert.equal(result.text, "<html>ok</html>");
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [10, 20]);
  assert.equal(calls[0].options.headers["User-Agent"], "SN-CRM-TVEC-Radar/1.0");
});

test("does not retry a permanent 4xx response", async () => {
  let calls = 0; let sleeps = 0;
  await assert.rejects(fetchTvecAggregation("Conectividad IV", {
    url: "https://example.test/tvec?Agregacion=Conectividad",
    fetchImpl: async () => { calls += 1; return response(404); },
    sleep: async () => { sleeps += 1; }, maxAttempts: 3,
  }), error => error.status === 404 && error.attempts === 1);
  assert.equal(calls, 1);
  assert.equal(sleeps, 0);
});

test("does not retry non-transient thrown errors", async () => {
  let calls = 0; let sleeps = 0;
  await assert.rejects(fetchTvecAggregation("Conectividad IV", {
    url: "https://example.test/tvec?Agregacion=Conectividad",
    fetchImpl: async () => { calls += 1; throw new Error("invalid response"); },
    sleep: async () => { sleeps += 1; }, maxAttempts: 3,
  }), error => error.attempts === 1 && error.cause?.message === "invalid response");
  assert.equal(calls, 1);
  assert.equal(sleeps, 0);
});

test("isolates aggregation failures so successful aggregations still resolve", async () => {
  const calls = new Map();
  const results = await fetchTvecAggregations({ healthy: 90, broken: 80 }, {
    baseUrl: "https://example.test/tvec",
    fetchImpl: async url => {
      const aggregation = new URL(url).searchParams.get("Agregacion");
      calls.set(aggregation, (calls.get(aggregation) || 0) + 1);
      return aggregation === "broken" ? response(400) : response(200, "<html>healthy</html>");
    },
    sleep: async () => { throw new Error("permanent failure must not sleep"); },
  });
  assert.equal(results.length, 2);
  assert.deepEqual(results.map(result => result.aggregation), ["healthy", "broken"]);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].attempts, 1);
  assert.equal(results[1].ok, false);
  assert.equal(results[1].status, 400);
  assert.equal(results[1].attempts, 1);
  assert.equal(results[1].error.status, 400);
  assert.equal(calls.get("healthy"), 1);
  assert.equal(calls.get("broken"), 1);
});

test("retries transient network errors but remains bounded", async () => {
  let calls = 0;
  await assert.rejects(fetchTvecAggregation("Nube pública V", {
    url: "https://example.test/tvec?Agregacion=Nube",
    fetchImpl: async () => { calls += 1; throw new TypeError("fetch failed"); },
    sleep: async () => {}, maxAttempts: 3,
  }), error => error.attempts === 3 && error.cause?.message === "fetch failed");
  assert.equal(calls, 3);
});
