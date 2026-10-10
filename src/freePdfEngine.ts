import {
  adjustDimsForRotation, layoutMultilineText, PDFCheckBox, PDFDict, PDFDocument,
  PDFDropdown, PDFField, PDFFont, PDFHexString, PDFName, PDFOptionList,
  PDFRadioGroup, PDFString, PDFTextField, StandardFonts,
} from 'pdf-lib';

export interface FreePdfWidget {
  /** One-based page; rectangles use the PDF's bottom-left origin. */
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  option?: string;
}

export interface FreePdfField {
  name: string;
  label: string;
  kind: 'text' | 'checkbox' | 'radio' | 'choice';
  maxLength?: number;
  multiline: boolean;
  options: string[];
  widgets: FreePdfWidget[];
  value: string | boolean;
}

export type FreePdfIssueCode = 'template' | 'unknown-field' | 'protected-field' | 'value' | 'overflow' | 'characters';

export class FreePdfValidationError extends Error {
  constructor(readonly code: FreePdfIssueCode, message: string, readonly fieldName?: string) {
    super(message);
    this.name = 'FreePdfValidationError';
  }
}

function fail(code: FreePdfIssueCode, message: string, fieldName?: string): never {
  throw new FreePdfValidationError(code, message, fieldName);
}

function labelOf(field: PDFField): string {
  const label = field.acroField.dict.lookup(PDFName.of('TU'));
  return label instanceof PDFString || label instanceof PDFHexString
    ? label.decodeText().replace(/\r\n?/g, '\n') : field.getName().split('.').pop()!.replace(/\[\d+\]$/, '');
}

// Tooltips often contain a whole section heading mentioning "Signature". Only
// field names and specific instructions identify protected entries. Read-only
// alone is NOT a protection rule: XFA used it for ordinary conditional inputs.
function isProtected(field: PDFField): boolean {
  const name = field.getName();
  const label = labelOf(field);
  const compactLabel = label.replace(/[\s.]/g, '').toLowerCase();
  return /barcode|signature|dateofsign|(?:_|\.)(?:sign|sig)\[|(?:interpreter|preparer)s?sig\[|uscisuse|foruscis|actionblock|receiptblock|uscisofficer|uscistitle|uscisprintedname|uscisname|officersprintedname/i.test(name)
    || /date\s+of\s+(?:[\w'’]+\s+){0,3}signature|this (?:signature )?field cannot be completed electronically|(?:can\s*not|cannot) be signed electronically|protected field|print (?:this |the )?form and sign in ink/i.test(label)
    || /foruscisuseonly|uscisofficer['’]?s(?:printedname|title)|uscisorconsularofficial['’]?scertification/.test(compactLabel);
}

function valueOf(field: PDFField): string | boolean {
  if (field instanceof PDFTextField) {
    // getText() throws on some blank rich-text continuation fields. /V is the
    // canonical plain-text value, including when an obsolete /RV also exists.
    const value = field.acroField.V();
    return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : '';
  }
  if (field instanceof PDFCheckBox) return field.isChecked();
  if (field instanceof PDFRadioGroup) return field.getSelected() ?? '';
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) return field.getSelected()[0] ?? '';
  return '';
}

function describe(doc: PDFDocument): FreePdfField[] {
  const pageByWidget = new Map<PDFDict, number>();
  doc.getPages().forEach((page, index) => {
    const annots = page.node.Annots();
    if (!annots) return;
    for (let i = 0; i < annots.size(); i += 1) {
      const annotation = doc.context.lookup(annots.get(i));
      if (annotation instanceof PDFDict) pageByWidget.set(annotation, index + 1);
    }
  });
  const result: FreePdfField[] = [];
  const names = new Set<string>();
  for (const field of doc.getForm().getFields()) {
    if (isProtected(field)) continue;
    const kind = field instanceof PDFTextField ? 'text'
      : field instanceof PDFCheckBox ? 'checkbox'
        : field instanceof PDFRadioGroup ? 'radio'
          : field instanceof PDFDropdown || field instanceof PDFOptionList ? 'choice' : undefined;
    if (!kind) continue;
    const name = field.getName();
    if (names.has(name)) fail('template', 'The PDF has duplicate field names.', name);
    names.add(name);
    const options = field instanceof PDFRadioGroup || field instanceof PDFDropdown || field instanceof PDFOptionList
      ? field.getOptions() : [];
    const widgets = field.acroField.getWidgets().map((widget, index) => {
      const page = pageByWidget.get(widget.dict);
      if (!page) fail('template', 'A PDF field is not attached to a page.', name);
      const rect = widget.getRectangle();
      if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) {
        fail('template', 'A PDF field has invalid dimensions.', name);
      }
      return { page, ...rect, ...(kind === 'radio' ? { option: options[index] } : {}) };
    });
    if (!widgets.length) continue;
    result.push({
      name, label: labelOf(field), kind, options, widgets, value: valueOf(field),
      multiline: field instanceof PDFTextField && field.isMultiline(),
      ...(field instanceof PDFTextField && field.getMaxLength() !== undefined ? { maxLength: field.getMaxLength() } : {}),
    });
  }
  return result;
}

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
  if (doc.isEncrypted || doc.getForm().hasXFA()) fail('template', 'Use the prepared, unencrypted official PDF template.');
  return doc;
}

/** Expose the official form for manual completion, without inferring answers. */
export async function prepareFreePdf(bytes: Uint8Array, formId: string): Promise<{
  bytes: Uint8Array;
  pages: { width: number; height: number }[];
  fields: FreePdfField[];
}> {
  if (!formId || typeof formId !== 'string') fail('template', 'Choose an official form.');
  const doc = await load(bytes);
  const fields = describe(doc);
  for (const descriptor of fields) doc.getForm().getField(descriptor.name).disableReadOnly();
  return {
    bytes: await doc.save({ updateFieldAppearances: false }),
    pages: doc.getPages().map(page => ({ width: page.getWidth(), height: page.getHeight() })),
    fields,
  };
}

function textSize(field: PDFTextField | PDFDropdown | PDFOptionList, text: string, font: PDFFont): number {
  const name = field.getName();
  const maxLength = field instanceof PDFTextField ? field.getMaxLength() : undefined;
  if (maxLength !== undefined && text.length > maxLength) fail('overflow', 'This entry exceeds the field’s character limit.', name);
  if (/[^\S\n ]/.test(text) || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(text)) {
    fail('characters', 'Use ordinary spaces and line breaks; this entry contains unsupported control characters.', name);
  }
  try { text.split('\n').forEach(line => font.encodeText(line)); }
  catch { fail('characters', 'This entry contains characters the PDF font cannot display. Use supported characters before saving.', name); }
  const multiline = field instanceof PDFTextField && field.isMultiline();
  if (!multiline && text.includes('\n')) fail('overflow', 'This field accepts one line of text.', name);
  if (!text) return 10;
  for (const size of [10, 9.5, 9]) {
    const fits = field.acroField.getWidgets().every(widget => {
      const rotation = widget.getAppearanceCharacteristics()?.getRotation() ?? 0;
      const dims = adjustDimsForRotation(widget.getRectangle(), rotation);
      const border = widget.getBorderStyle()?.getWidth() ?? 0;
      const comb = field instanceof PDFTextField && field.isCombed();
      const padding = comb ? 0 : 1;
      const width = dims.width - 2 * (border + padding);
      const height = dims.height - 2 * (border + padding);
      if (width <= 0 || height < font.heightAtSize(size)) return false;
      if (comb && maxLength) return [...text].every(character => font.widthOfTextAtSize(character, size) <= width / maxLength - 1);
      if (!multiline) return font.widthOfTextAtSize(text, size) <= width;
      const layout = layoutMultilineText(text, {
        alignment: (field as PDFTextField).getAlignment(), fontSize: size, font,
        bounds: { x: 0, y: 0, width, height },
      });
      return layout.lines.every(line => line.x >= -0.01 && line.y >= -0.01 && line.x + line.width <= width + 0.01);
    });
    if (fits) return size;
  }
  fail('overflow', 'This entry will not fit legibly in the PDF field. Shorten it or use the form’s additional-information space.', name);
}

function setFont(field: PDFTextField | PDFDropdown | PDFOptionList, fontName: string, size: number): void {
  // Original USCIS widgets have their own /DA, which takes precedence over the
  // parent field. Update BOTH or an old 10pt widget would ignore fitted 9pt text.
  const appearance = `/${fontName} ${size} Tf 0 g`;
  field.acroField.setDefaultAppearance(appearance);
  for (const widget of field.acroField.getWidgets()) widget.setDefaultAppearance(appearance);
}

/** Save current manual values; preserve AcroForm, widgets and future editability. */
export async function saveFreePdf(
  bytes: Uint8Array,
  fields: FreePdfField[],
  values: Record<string, string | boolean>,
): Promise<Uint8Array> {
  const doc = await load(bytes);
  const form = doc.getForm();
  // Re-read trusted PDF metadata; callers cannot bypass protection or maxLength
  // by modifying a descriptor in the UI.
  const actual = new Map(describe(doc).map(field => [field.name, field]));
  const allowed = new Set(fields.map(field => field.name));
  if (allowed.size !== fields.length) fail('template', 'The editor contains duplicate fields.');
  for (const descriptor of fields) {
    const field = form.getFieldMaybe(descriptor.name);
    if (field && isProtected(field)) fail('protected-field', 'Signatures and official-use fields cannot be filled here.', descriptor.name);
    if (!actual.has(descriptor.name)) fail('unknown-field', 'The editor field is not part of this PDF.', descriptor.name);
  }
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontResource = 'FreeFormHelvetica';
  const changed: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    const field = form.getFieldMaybe(name);
    if (field && isProtected(field)) fail('protected-field', 'Signatures and official-use fields cannot be filled here.', name);
    const descriptor = actual.get(name);
    if (!field || !descriptor || !allowed.has(name)) fail('unknown-field', 'This entry is not an editable field in the PDF.', name);
    if (descriptor.kind === 'checkbox' ? typeof value !== 'boolean' : typeof value !== 'string') {
      fail('value', descriptor.kind === 'checkbox' ? 'This checkbox requires true or false.' : 'This field requires text.', name);
    }
    if ((descriptor.kind === 'radio' || descriptor.kind === 'choice') && value !== '' && !descriptor.options.includes(value as string)) {
      fail('value', 'Choose one of the options listed in the official PDF.', name);
    }
    if (value === descriptor.value) continue;
    field.disableReadOnly();
    let size: number | undefined;
    if (field instanceof PDFTextField) {
      size = textSize(field, value as string, font);
      field.setText(value as string);
      setFont(field, font.name, size);
    } else if (field instanceof PDFCheckBox) {
      if (value) field.check(); else field.uncheck();
    } else if (field instanceof PDFRadioGroup) {
      if (value === '') field.clear(); else field.select(value as string);
    } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      size = textSize(field, value as string, font);
      if (value === '') field.clear(); else field.select(value as string);
      setFont(field, font.name, size);
    }
    field.defaultUpdateAppearances(font);
    if (size !== undefined && (field instanceof PDFTextField || field instanceof PDFDropdown || field instanceof PDFOptionList)) {
      setFont(field, fontResource, size);
    }
    if (field.acroField.getWidgets().some(widget => !widget.getAppearances()?.normal)) {
      fail('template', 'A saved field is missing its printable appearance.', name);
    }
    changed.push(name);
  }
  // PDF readers resolve /DA fonts through AcroForm /DR while editing later.
  const resources = form.acroForm.dict.lookupMaybe(PDFName.of('DR'), PDFDict) ?? doc.context.obj({});
  const fonts = resources.lookupMaybe(PDFName.of('Font'), PDFDict) ?? doc.context.obj({});
  fonts.set(PDFName.of(fontResource), font.ref);
  resources.set(PDFName.of('Font'), fonts);
  form.acroForm.dict.set(PDFName.of('DR'), resources);
  const result = await doc.save({ updateFieldAppearances: false });
  const reopened = await load(result);
  if (reopened.getPageCount() !== doc.getPageCount() || reopened.getForm().getFields().length !== form.getFields().length) {
    fail('template', 'The saved PDF did not preserve its editable fields.');
  }
  for (const name of changed) {
    if (valueOf(reopened.getForm().getField(name)) !== values[name]) fail('template', 'The saved PDF did not preserve this entry.', name);
  }
  return result;
}
