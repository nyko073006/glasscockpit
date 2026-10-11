/** Text einer WebSocket-Nachricht (ws liefert Buffer, ArrayBuffer oder eine Buffer-Liste), als UTF-8. */
export function rawDataToString(data: Buffer | ArrayBuffer | Buffer[]): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}
