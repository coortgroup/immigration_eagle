/** The editor sends no form answers to a server. This bridge is local to its frame. */
export type PdfEditorMessage =
  | { type: 'ready' | 'dirty' }
  | { type: 'busy'; value: boolean }
  | { type: 'error'; error?: string; message?: string }
  | { type: 'export'; action: 'save' | 'print'; base64: string };
export type PdfEditorReply = { type: 'export-result'; error?: string };
export type PdfEditorHandle = { reply: (message: PdfEditorReply) => void };
export type PdfEditorProps = { html: string; onMessage: (message: PdfEditorMessage) => void };

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function pdfToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  let chunk = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const value = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    chunk += alphabet[value >>> 18] + alphabet[(value >>> 12) & 63] +
      (i + 1 < bytes.length ? alphabet[(value >>> 6) & 63] : '=') +
      (i + 2 < bytes.length ? alphabet[value & 63] : '=');
    if (chunk.length >= 16384) { chunks.push(chunk); chunk = ''; }
  }
  chunks.push(chunk);
  return chunks.join('');
}
export function pdfFromBase64(value: string): Uint8Array {
  if (!value || value.length > 48 * 1024 * 1024 || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error('The completed PDF could not be read. Try saving again.');
  }
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array(value.length / 4 * 3 - padding);
  let offset = 0;
  for (let i = 0; i < value.length; i += 4) {
    const word = (alphabet.indexOf(value[i]) << 18) | (alphabet.indexOf(value[i + 1]) << 12) |
      (Math.max(0, alphabet.indexOf(value[i + 2])) << 6) | Math.max(0, alphabet.indexOf(value[i + 3]));
    bytes[offset++] = word >>> 16;
    if (offset < bytes.length) bytes[offset++] = (word >>> 8) & 255;
    if (offset < bytes.length) bytes[offset++] = word & 255;
  }
  if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') throw new Error('The completed file is not a PDF.');
  return bytes;
}
