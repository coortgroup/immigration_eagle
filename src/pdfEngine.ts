import { digest, CryptoDigestAlgorithm } from 'expo-crypto';
import {
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFFont,
  PDFName,
  PDFHexString,
  PDFOptionList,
  PDFRadioGroup,
  PDFString,
  PDFTextField,
  StandardFonts,
} from 'pdf-lib';

/** A prepared template is a derived static-print source, never the original XFA. */
export interface PrintTemplateDefinition {
  id: string;
  sha256: string;
  pageCount: number;
  fields: PrintFieldDefinition[];
}

export interface PrintFieldDefinition {
  name: string;
  type: string;
  disposition: string;
  maxLength?: number | null;
  /** Required for fields whose metadata labels alone are not a safe allowlist. */
  approvedForPrint?: boolean;
}

export type PrintAnswer = string | boolean;
export type PrintAnswers = Record<string, PrintAnswer>;
export type PrintIssueCode = 'template' | 'unknown-field' | 'protected-field' | 'value' | 'overflow' | 'characters';

export class PrintValidationError extends Error {
  readonly code: PrintIssueCode;
  readonly fieldName?: string;

  constructor(code: PrintIssueCode, message: string, fieldName?: string) {
    super(message);
    this.name = 'PrintValidationError';
    this.code = code;
    this.fieldName = fieldName;
  }
}

// AI must never create a signature, certification date, government entry or barcode.
// Certifications selected by the user are handled in a separately reviewed interview.
const protectedName = /barcode|signature|dateofsign|uscisuse|foruscis|actionblock|receiptblock/i;
const allowedDispositions = new Set(['answer', 'derived']);

function fail(code: PrintIssueCode, message: string, fieldName?: string): never {
  throw new PrintValidationError(code, message, fieldName);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  // Native Expo Crypto requires a TypedArray; a bare ArrayBuffer only works on web.
  const value = await digest(CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes));
  return Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Mirrors the line wrapping used by PDF-LIB, conservatively reserving padding. */
function fitsMultiline(text: string, font: PDFFont, size: number, width: number, height: number): boolean {
  let lines = 0;
  for (const paragraph of text.split('\n')) {
    let line = '';
    if (!paragraph) { lines += 1; continue; }
    for (const word of paragraph.split(/\s+/)) {
      if (font.widthOfTextAtSize(word, size) > width) return false;
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width) { lines += 1; line = word; }
      else line = next;
    }
    lines += 1;
  }
  return lines * size * 1.25 <= height;
}

function fitText(field: PDFTextField, text: string, font: PDFFont, schema: PrintFieldDefinition): number {
  const maxLength = field.getMaxLength() ?? schema.maxLength;
  if (maxLength != null && [...text].length > maxLength) {
    fail('overflow', 'This answer exceeds the space available on the official form. Revise it or use the reviewed additional-information workflow.', schema.name);
  }
  try { for (const line of text.split(/\r?\n/)) font.encodeText(line); }
  catch { fail('characters', 'This answer includes characters the print font cannot represent. Review the answer before exporting; it has not been altered.', schema.name); }
  if (!field.isMultiline() && /[\r\n]/.test(text)) {
    fail('overflow', 'This official field accepts one line. Review the answer before exporting.', schema.name);
  }
  for (const size of [10, 9.5, 9]) {
    const fits = field.acroField.getWidgets().every(widget => {
      const rect = widget.getRectangle();
      const width = rect.width - 4;
      const height = rect.height - 2;
      if (width <= 0 || height < size) return false;
      if (field.isCombed() && maxLength) {
        return [...text].every(char => font.widthOfTextAtSize(char, size) <= width / maxLength - 1);
      }
      return field.isMultiline()
        ? fitsMultiline(text, font, size, width, height)
        : font.widthOfTextAtSize(text, size) <= width;
    });
    if (fits) return size;
  }
  fail('overflow', 'This answer does not fit legibly in the official field. Revise it or use the reviewed additional-information workflow.', schema.name);
}

/**
 * Deterministically fill a hash-pinned official template using confirmed answers.
 * The caller supplies only fields approved in the reviewed interview mapping.
 * No legal facts are inferred here. No network requests, logging or storage occur.
 * The returned document is explicitly STATIC, for printing and handwritten signing.
 */
export async function fillOfficialPrintPdf(
  bytes: Uint8Array,
  definition: PrintTemplateDefinition,
  answers: PrintAnswers,
): Promise<Uint8Array> {
  if (!/^[a-f0-9]{64}$/.test(definition.sha256) || await sha256(bytes) !== definition.sha256) {
    fail('template', 'The official print template has changed. Update the reviewed template before exporting.');
  }
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
  if (doc.isEncrypted || doc.getPageCount() !== definition.pageCount) fail('template', 'The print template does not match its reviewed edition.');
  const form = doc.getForm();
  if (form.hasXFA()) fail('template', 'An original XFA document cannot be used as the static print template.');
  const schemas = new Map(definition.fields.map(field => [field.name, field]));
  if (schemas.size !== definition.fields.length) fail('template', 'The print mapping contains duplicate fields.');
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const [name, value] of Object.entries(answers)) {
    const schema = schemas.get(name);
    if (!schema) fail('unknown-field', 'An answer is not mapped to the reviewed official form.', name);
    if (!schema.approvedForPrint || !allowedDispositions.has(schema.disposition) || protectedName.test(name)) {
      fail('protected-field', 'This field is reserved for a signature, government use or separate review.', name);
    }
    const field = form.getFieldMaybe(name);
    if (!field) fail('template', 'A mapped field is missing from the official template.', name);
    if (field instanceof PDFTextField) {
      if (schema.type !== '/Tx' || typeof value !== 'string') fail('value', 'This official field requires text.', name);
      const size = fitText(field, value, font, schema);
      field.setText(value);
      field.setFontSize(size);
    } else if (field instanceof PDFCheckBox) {
      if (schema.type !== '/Btn' || typeof value !== 'boolean') fail('value', 'This official checkbox requires an explicit selection.', name);
      if (value) field.check(); else field.uncheck();
    } else if (field instanceof PDFRadioGroup) {
      if (schema.type !== '/Btn' || typeof value !== 'string' || !field.getOptions().includes(value)) fail('value', 'Choose one of the official options.', name);
      field.select(value);
    } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      if (schema.type !== '/Ch' || typeof value !== 'string') fail('value', 'This official field requires one of its listed choices.', name);
      if (value === '') field.clear();
      else {
        if (!field.getOptions().includes(value)) fail('value', 'Choose one of the official options.', name);
        field.select(value);
      }
    } else {
      fail('protected-field', 'This official field is not available for automatic filling.', name);
    }
  }

  // Only dirty answer widgets are regenerated. Original blank/barcode appearances stay intact.
  for (const name of Object.keys(answers)) {
    const field = form.getField(name);
    field.defaultUpdateAppearances(font);
    if (field.acroField.getWidgets().some(widget => !widget.getAppearances()?.normal)) {
      fail('template', 'A completed field has no printable appearance.', name);
    }
  }
  // Some original blank widgets have no appearance at all (including rich-text
  // continuation boxes). A transparent appearance preserves their original blank
  // rendering. Never regenerate a barcode or silently discard a nonempty value.
  for (const field of form.getFields()) {
    for (const widget of field.acroField.getWidgets()) {
      const appearance = widget.getAppearances()?.normal;
      const value = field.acroField.V();
      const empty = value == null || value === PDFName.of('Off') ||
        ((value instanceof PDFString || value instanceof PDFHexString) && value.decodeText() === '');
      const isButton = field instanceof PDFCheckBox || field instanceof PDFRadioGroup;
      const missing = !appearance || (isButton && appearance instanceof PDFDict &&
        !appearance.has(value instanceof PDFName ? value : PDFName.of('Off')));
      if (!missing) continue;
      // N-600 contains a blank checkbox with /V /0 but /AS /Off. Preserve that
      // source's visible OFF state; this exception never applies to an answer.
      const originalOff = !Object.prototype.hasOwnProperty.call(answers, field.getName()) &&
        isButton && widget.getAppearanceState() === PDFName.of('Off');
      if (!empty && !originalOff) fail('template', 'An original nonempty field has no printable appearance.', field.getName());
      const rect = widget.getRectangle();
      const blank = doc.context.register(doc.context.formXObject([], { BBox: [0, 0, rect.width, rect.height], Resources: {} }));
      if (isButton) {
        const states = appearance instanceof PDFDict ? appearance : doc.context.obj({});
        states.set(PDFName.of('Off'), blank);
        widget.setNormalAppearance(states);
      } else widget.setNormalAppearance(blank);
    }
  }
  form.flatten({ updateFieldAppearances: false });
  doc.catalog.delete(PDFName.of('AcroForm'));
  const result = await doc.save({ updateFieldAppearances: false });
  const reopened = await PDFDocument.load(result, { updateMetadata: false, throwOnInvalidObject: true });
  if (reopened.getPageCount() !== definition.pageCount || reopened.catalog.has(PDFName.of('AcroForm'))) {
    fail('template', 'The printable document did not pass its structural check.');
  }
  for (const page of reopened.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let index = 0; index < annots.size(); index += 1) {
      const annotation = reopened.context.lookup(annots.get(index));
      if (annotation && 'get' in annotation && typeof annotation.get === 'function' && annotation.get(PDFName.of('Subtype')) === PDFName.of('Widget')) {
        fail('template', 'The printable document still has an interactive field.');
      }
    }
  }
  return result;
}
