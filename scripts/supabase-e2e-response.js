export async function readJsonLimited(response, maxBytes = 1_000_000) {
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    try { await response.body?.cancel?.(); } catch {}
    throw new Error("Supabase E2E response exceeded the configured size limit.");
  }
  if (!response.body?.getReader) {
    throw new Error("Supabase E2E response cannot be size-limited without a streaming body.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let raw = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try { await reader.cancel(); } catch {}
        throw new Error("Supabase E2E response exceeded the configured size limit.");
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  try { return raw ? JSON.parse(raw) : null; }
  catch { throw new Error("Supabase E2E endpoint returned malformed JSON."); }
}
