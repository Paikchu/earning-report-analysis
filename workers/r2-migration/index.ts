interface Env {
  SOURCE: R2Bucket;
  DESTINATION: R2Bucket;
  SEC_MIGRATION_KEY: string;
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    if (!env.SEC_MIGRATION_KEY || request.headers.get("x-sec-migration-key") !== env.SEC_MIGRATION_KEY) return new Response("Unauthorized", { status: 401 });
    if (new URL(request.url).searchParams.has("verify")) {
      const listed = await env.SOURCE.list({ limit: 5 });
      const samples = [];
      for (const source of listed.objects) {
        const [sourceObject, destinationObject] = await Promise.all([env.SOURCE.get(source.key), env.DESTINATION.get(source.key)]);
        if (!sourceObject || !destinationObject) throw new Error(`Missing verification object: ${source.key}`);
        const [sourceHash, destinationHash] = await Promise.all([sha256(await sourceObject.arrayBuffer()), sha256(await destinationObject.arrayBuffer())]);
        if (sourceHash !== destinationHash) throw new Error(`R2 content mismatch: ${source.key}`);
        samples.push({ key: source.key, size: source.size, sha256: sourceHash });
      }
      return Response.json({ samples });
    }
    const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
    const listed = await env.SOURCE.list({ cursor, limit: 100 });
    const copied: Array<{ key: string; size: number; etag: string }> = [];
    for (const source of listed.objects) {
      const object = await env.SOURCE.get(source.key);
      if (!object) throw new Error(`Missing source object: ${source.key}`);
      await env.DESTINATION.put(source.key, object.body, { httpMetadata: object.httpMetadata, customMetadata: object.customMetadata });
      const destination = await env.DESTINATION.head(source.key);
      if (!destination || destination.size !== source.size) throw new Error(`R2 verification failed: ${source.key}`);
      copied.push({ key: source.key, size: source.size, etag: destination.etag });
    }
    return Response.json({ copied, truncated: listed.truncated, cursor: listed.truncated ? listed.cursor : null });
  },
};

async function sha256(value: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", value));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default worker;
