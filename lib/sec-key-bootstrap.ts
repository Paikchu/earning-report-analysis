export async function encryptSecModelKey(secret: string, publicKeyPem: string): Promise<string> {
  if (!secret || !publicKeyPem) throw new Error("SEC model key bootstrap is incomplete");
  const publicKey = await crypto.subtle.importKey(
    "spki",
    pemBytes(publicKeyPem),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
  const ciphertext = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, new TextEncoder().encode(secret));
  return bytesToBase64(new Uint8Array(ciphertext));
}

export async function decryptSecModelKey(ciphertext: string, privateKeyPem: string): Promise<string> {
  if (!ciphertext || !privateKeyPem) throw new Error("SEC model key bootstrap is incomplete");
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(privateKeyPem),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, base64ToBytes(ciphertext));
  return new TextDecoder().decode(plaintext);
}

export async function exportPublicKeyPem(key: CryptoKey): Promise<string> {
  return formatPem("PUBLIC KEY", new Uint8Array(await crypto.subtle.exportKey("spki", key)));
}

export async function exportPrivateKeyPem(key: CryptoKey): Promise<string> {
  return formatPem("PRIVATE KEY", new Uint8Array(await crypto.subtle.exportKey("pkcs8", key)));
}

function pemBytes(value: string): Uint8Array {
  return base64ToBytes(value.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s+/g, ""));
}

function formatPem(label: string, bytes: Uint8Array): string {
  const encoded = bytesToBase64(bytes).match(/.{1,64}/g)?.join("\n") ?? "";
  return `-----BEGIN ${label}-----\n${encoded}\n-----END ${label}-----`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
