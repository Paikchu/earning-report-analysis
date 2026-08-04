import assert from "node:assert/strict";
import test from "node:test";

import { decryptSecModelKey, encryptSecModelKey, exportPrivateKeyPem, exportPublicKeyPem } from "../lib/sec-key-bootstrap.ts";
import { resolveWorkerModelKey, type SecPipelineEnv } from "../workers/sec-cron/operations.ts";

test("transfers the Sites model key to the workflow worker as RSA-OAEP ciphertext", async () => {
  const pair = await crypto.subtle.generateKey({
    name: "RSA-OAEP",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  }, true, ["encrypt", "decrypt"]);
  const publicKey = await exportPublicKeyPem(pair.publicKey);
  const privateKey = await exportPrivateKeyPem(pair.privateKey);

  const ciphertext = await encryptSecModelKey("deepseek-secret", publicKey);

  assert.notEqual(ciphertext, "deepseek-secret");
  assert.equal(await decryptSecModelKey(ciphertext, privateKey), "deepseek-secret");
});

test("workflow worker retrieves one encrypted model key from the authenticated Sites bootstrap", async () => {
  const pair = await crypto.subtle.generateKey({
    name: "RSA-OAEP",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  }, true, ["encrypt", "decrypt"]);
  const publicKey = await exportPublicKeyPem(pair.publicKey);
  const privateKey = await exportPrivateKeyPem(pair.privateKey);
  const ciphertext = await encryptSecModelKey("sites-deepseek-secret", publicKey);
  let bootstrapCalls = 0;
  const env = {
    MAX_SITE_ORIGIN: "https://site.test",
    MAX_SITE_BYPASS_TOKEN: "sites-token",
    SEC_REFRESH_KEY: "refresh-key",
    SEC_BOOTSTRAP_PRIVATE_KEY: privateKey,
  } as SecPipelineEnv;
  const fetcher: typeof fetch = async (input) => {
    assert.equal(String(input), "https://site.test/api/internal/sec/model-key");
    bootstrapCalls += 1;
    return Response.json({ ciphertext });
  };

  assert.equal(await resolveWorkerModelKey(env, fetcher), "sites-deepseek-secret");
  assert.equal(await resolveWorkerModelKey(env, fetcher), "sites-deepseek-secret");
  assert.equal(bootstrapCalls, 1);
});
