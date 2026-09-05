import {
  ANALYSIS_SCOPE_WILDCARD,
  isAnalysisReadScope,
  type AnalysisReadScope,
} from "../../../lib/analysis-contract/versions.ts";

/**
 * Read credentials for the analysis backend.
 *
 * Deliberately small: a runtime secret holding a list of credentials, not an account system. What
 * it has to do is give each consumer an independently identifiable, independently revocable
 * credential with its own scopes, and it does.
 *
 * `ANALYSIS_READ_KEYS` format — entries separated by commas or newlines, fields by colons:
 *
 *     <keyId>:<secret>:<scope>|<scope>|…
 *     web-worker:REDACTED_LONG_RANDOM_STRING:*
 *     partner-a:REDACTED_LONG_RANDOM_STRING:filings:read      <-- WRONG, scopes contain colons
 *
 * Scopes therefore use `|` between them and keep their own `:` inside, e.g.
 * `filings:read|fundamentals:read`. `*` grants every read scope.
 *
 * What this is **not**: it is not the administrative secret. `SEC_REFRESH_KEY` still guards
 * refresh, backfill and every other control operation, and no value parsed here can reach one —
 * the control handlers never consult this module.
 */
export type AnalysisReadCredential = {
  keyId: string;
  /** SHA-256 of the secret. The plaintext is never retained past parsing. */
  secretHash: Uint8Array;
  scopes: Set<string>;
};

export type AnalysisReadIdentity = {
  keyId: string;
  scopes: Set<string>;
};

export type ReadAuthOutcome =
  | { ok: true; identity: AnalysisReadIdentity }
  | { ok: false; reason: "not_configured" | "unauthorized" };

const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{2,64}$/;
/** Long enough that a credential cannot be guessed, and long enough to notice a truncated paste. */
export const ANALYSIS_READ_SECRET_MIN_LENGTH = 24;

export class AnalysisReadKeyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisReadKeyConfigError";
  }
}

/**
 * Parses the credential list. Throws on anything malformed rather than skipping the bad entry:
 * a typo that silently drops a consumer's credential is indistinguishable from a revocation, and
 * the operator would find out from a 401 in production instead of from a failed deploy.
 */
export async function parseAnalysisReadKeys(raw: string | undefined | null): Promise<AnalysisReadCredential[]> {
  const entries = String(raw ?? "").split(/[,\n]+/).map((entry) => entry.trim()).filter(Boolean);
  const credentials: AnalysisReadCredential[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const separator = entry.indexOf(":");
    const secondSeparator = entry.indexOf(":", separator + 1);
    if (separator <= 0 || secondSeparator <= separator) {
      throw new AnalysisReadKeyConfigError("ANALYSIS_READ_KEYS entries must be <keyId>:<secret>:<scopes>");
    }
    const keyId = entry.slice(0, separator);
    const secret = entry.slice(separator + 1, secondSeparator);
    const scopeText = entry.slice(secondSeparator + 1);
    if (!KEY_ID_PATTERN.test(keyId)) throw new AnalysisReadKeyConfigError(`ANALYSIS_READ_KEYS has an invalid keyId`);
    if (seen.has(keyId)) throw new AnalysisReadKeyConfigError("ANALYSIS_READ_KEYS has a duplicate keyId");
    if (secret.length < ANALYSIS_READ_SECRET_MIN_LENGTH) {
      throw new AnalysisReadKeyConfigError(`ANALYSIS_READ_KEYS secret for ${keyId} is shorter than ${ANALYSIS_READ_SECRET_MIN_LENGTH} characters`);
    }
    const scopes = scopeText.split("|").map((scope) => scope.trim()).filter(Boolean);
    if (!scopes.length) throw new AnalysisReadKeyConfigError(`ANALYSIS_READ_KEYS credential ${keyId} has no scopes`);
    for (const scope of scopes) {
      if (scope !== ANALYSIS_SCOPE_WILDCARD && !isAnalysisReadScope(scope)) {
        throw new AnalysisReadKeyConfigError(`ANALYSIS_READ_KEYS credential ${keyId} has an unknown scope`);
      }
    }
    seen.add(keyId);
    credentials.push({ keyId, secretHash: await digest(secret), scopes: new Set(scopes) });
  }
  return credentials;
}

/**
 * Authenticates a request against the configured credentials.
 *
 * The transport is not evidence of anything. A request arriving over the Service Binding presents
 * the same `Authorization` header an external consumer presents, and gets the same answer — a
 * Worker that is also publicly reachable must not hand out an authentication bypass just because
 * one of its callers happens to be bound to it. No hostname, `Origin`, or caller-supplied
 * "internal" header is consulted anywhere in this function.
 */
export async function authenticateReadRequest(
  request: Request,
  rawKeys: string | undefined | null,
): Promise<ReadAuthOutcome> {
  let credentials: AnalysisReadCredential[];
  try {
    credentials = await parseAnalysisReadKeys(rawKeys);
  } catch {
    return { ok: false, reason: "not_configured" };
  }
  // Fail closed: with no credentials configured there is no such thing as an authorised reader.
  if (!credentials.length) return { ok: false, reason: "not_configured" };

  const authorization = request.headers.get("authorization") ?? "";
  const presented = authorization.slice(0, 7).toLowerCase() === "bearer " ? authorization.slice(7).trim() : "";
  const dot = presented.indexOf(".");
  if (dot <= 0 || dot === presented.length - 1) return { ok: false, reason: "unauthorized" };
  const keyId = presented.slice(0, dot);
  const secret = presented.slice(dot + 1);

  const credential = credentials.find((candidate) => candidate.keyId === keyId);
  // Hash the presented secret either way, so an unknown keyId and a wrong secret cost the same.
  const presentedHash = await digest(secret);
  if (!credential || !timingSafeEqual(credential.secretHash, presentedHash)) {
    return { ok: false, reason: "unauthorized" };
  }
  return { ok: true, identity: { keyId: credential.keyId, scopes: credential.scopes } };
}

export function hasScope(identity: AnalysisReadIdentity, scope: AnalysisReadScope): boolean {
  return identity.scopes.has(ANALYSIS_SCOPE_WILDCARD) || identity.scopes.has(scope);
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}
