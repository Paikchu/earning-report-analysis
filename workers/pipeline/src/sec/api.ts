export async function hasInternalSecAccess(request: Request, expectedSecret: string): Promise<boolean> {
  const supplied = request.headers.get("x-sec-refresh-key") ?? "";
  if (!expectedSecret || !supplied) return false;
  const [expectedHash, suppliedHash] = await Promise.all([digest(expectedSecret), digest(supplied)]);
  let difference = 0;
  for (let index = 0; index < expectedHash.length; index += 1) {
    difference |= expectedHash[index] ^ suppliedHash[index];
  }
  return difference === 0;
}

async function digest(value: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}
