/// <reference lib="dom" />
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
// The worker is bundled into this document so editing works without a CDN or network.
// @ts-expect-error PDF.js does not publish a declaration for its worker entry point.
import { WorkerMessageHandler } from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import { FreePdfValidationError, prepareFreePdf, saveFreePdf } from '../freePdfEngine';

type Config = { formId: string; base64: string; native: boolean };
type PreparedPdf = Awaited<ReturnType<typeof prepareFreePdf>>;
type Field = PreparedPdf['fields'][number];
type FieldInput = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
type ExportAction = 'save' | 'print';
type EditorWindow = Window & {
  ReactNativeWebView?: { postMessage: (message: string) => void };
  pdfjsWorker?: { WorkerMessageHandler: unknown };
};

const host = window as EditorWindow;
host.pdfjsWorker = { WorkerMessageHandler };

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const title = element<HTMLElement>('document-title');
const status = element<HTMLElement>('status');
const errorBox = element<HTMLElement>('error');
const errorText = element<HTMLElement>('error-text');
const retryButton = element<HTMLButtonElement>('retry');
const stage = element<HTMLElement>('page-stage');
const pageFrame = element<HTMLElement>('page-frame');
const canvas = element<HTMLCanvasElement>('pdf-page');
const fieldsLayer = element<HTMLElement>('fields');
const previousButton = element<HTMLButtonElement>('previous-page');
const nextButton = element<HTMLButtonElement>('next-page');
const pageSelect = element<HTMLSelectElement>('page-select');
const zoomSelect = element<HTMLSelectElement>('zoom-select');
const help = element<HTMLElement>('field-help');
const saveButton = element<HTMLButtonElement>('save-pdf');
const printButton = element<HTMLButtonElement>('print-pdf');
const defaultHelp = 'Select a blue field to type. Use Tab to move between fields.';

let config: Config;
let prepared: PreparedPdf | undefined;
let pdf: pdfjs.PDFDocumentProxy | undefined;
let values: Record<string, string | boolean> = Object.create(null);
let currentPage = 1;
let renderSequence = 0;
let renderTask: pdfjs.RenderTask | undefined;
let busy = false;
let loading = false;
let dirty = false;
let lastExportAction: ExportAction = 'save';
let retryAction: (() => void) | undefined;
let renderPromise: Promise<void> = Promise.resolve();
let renderedStageWidth = 0;

function notify(message: Record<string, unknown>) {
  const payload = { source: 'fillout-pdf-editor', ...message };
  if (host.ReactNativeWebView) host.ReactNativeWebView.postMessage(JSON.stringify(payload));
  else if (window.parent !== window) window.parent.postMessage(payload, '*');
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : 'The PDF could not be processed. Please try again.';
}

function showError(message: string, retry?: () => void) {
  errorText.textContent = message;
  errorBox.hidden = false;
  retryAction = retry;
  retryButton.hidden = !retry;
}

function clearError() {
  errorBox.hidden = true;
  retryAction = undefined;
}

function updateControls() {
  const unavailable = loading || !pdf || !prepared;
  previousButton.disabled = unavailable || busy || currentPage <= 1;
  nextButton.disabled = unavailable || busy || currentPage >= (pdf?.numPages || 1);
  pageSelect.disabled = unavailable || busy;
  zoomSelect.disabled = unavailable || busy;
  saveButton.disabled = unavailable || busy;
  printButton.disabled = unavailable || busy;
  fieldsLayer.toggleAttribute('inert', busy);
  fieldsLayer.setAttribute('aria-busy', String(busy));
}

function setBusy(value: boolean) {
  busy = value;
  updateControls();
  notify({ type: 'busy', value });
}

function decodeBase64(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let start = 0; start < bytes.length; start += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(start, start + chunkSize));
  }
  return btoa(binary);
}

function syncFieldInputs(field: Field) {
  const fieldValue = values[field.name];
  fieldsLayer.querySelectorAll<FieldInput>('[data-field]').forEach((input) => {
    if (input.dataset.field !== field.name) return;
    if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = fieldValue === true;
    else if (input instanceof HTMLInputElement && input.type === 'radio') input.checked = fieldValue === input.value;
    else input.value = typeof fieldValue === 'string' ? fieldValue : '';
  });
}

function updateValue(field: Field, input: FieldInput) {
  values[field.name] = input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked : input.value;
  syncFieldInputs(field);
  if (!dirty) { dirty = true; notify({ type: 'dirty' }); }
  status.textContent = 'Changes are in this window. Save a filled copy to keep them.';
}

function createInput(field: Field, widget: Field['widgets'][number], index: number): FieldInput {
  let input: FieldInput;
  if (field.kind === 'choice') {
    input = document.createElement('select');
    const empty = document.createElement('option');
    empty.value = ''; empty.textContent = '';
    input.append(empty);
    field.options.forEach((value) => {
      const option = document.createElement('option');
      option.value = value; option.textContent = value;
      input.append(option);
    });
  } else if (field.multiline && field.kind === 'text') {
    input = document.createElement('textarea');
  } else {
    input = document.createElement('input');
    input.type = field.kind === 'radio' ? 'radio' : field.kind === 'checkbox' ? 'checkbox' : 'text';
    if (field.kind === 'radio') {
      input.name = field.name;
      input.value = widget.option || field.options[index] || String(index);
    }
  }
  input.className = `pdf-field pdf-field--${field.kind}`;
  input.dataset.field = field.name;
  input.id = `field-${currentPage}-${fieldsLayer.childElementCount}`;
  const label = `${field.label}${widget.option && field.kind === 'radio' ? `: ${widget.option}` : ''}`;
  input.setAttribute('aria-label', label);
  input.setAttribute('aria-describedby', 'field-help');
  input.title = label;
  input.autocomplete = 'off';
  input.spellcheck = false;
  if (field.kind === 'text' && field.maxLength && !(input instanceof HTMLSelectElement)) input.maxLength = field.maxLength;
  input.addEventListener('focus', () => { help.textContent = label; });
  input.addEventListener('blur', () => { help.textContent = defaultHelp; });
  input.addEventListener(field.kind === 'text' ? 'input' : 'change', () => updateValue(field, input));
  return input;
}

async function renderPage(sequence: number) {
  if (!pdf || !prepared) return;
  const pageNumber = currentPage;
  const page = await pdf.getPage(pageNumber);
  if (sequence !== renderSequence) return;
  const unscaled = page.getViewport({ scale: 1 });
  const fitScale = Math.max(0.3, Math.min(1.6, (stage.clientWidth - 32) / unscaled.width));
  const scale = zoomSelect.value === 'fit' ? fitScale : Number(zoomSelect.value);
  const viewport = page.getViewport({ scale });
  renderedStageWidth = stage.clientWidth;
  const focusedInput = document.activeElement instanceof HTMLElement && fieldsLayer.contains(document.activeElement)
    ? document.activeElement as FieldInput : undefined;
  const focusSnapshot = focusedInput ? {
    name: focusedInput.dataset.field,
    value: focusedInput.value,
    start: focusedInput instanceof HTMLSelectElement ? null : focusedInput.selectionStart,
    end: focusedInput instanceof HTMLSelectElement ? null : focusedInput.selectionEnd,
  } : undefined;
  // Limit pixel density to keep large forms usable on phones.
  const density = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(viewport.width * density);
  canvas.height = Math.round(viewport.height * density);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  pageFrame.style.width = `${viewport.width}px`;
  pageFrame.style.height = `${viewport.height}px`;
  fieldsLayer.replaceChildren();
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This device could not display the PDF. Try opening the form in another browser.');
  renderTask = page.render({
    canvas,
    canvasContext: context,
    viewport,
    transform: density !== 1 ? [density, 0, 0, density, 0, 0] : undefined,
    // Keep official protected annotations (including barcodes). Opaque HTML inputs
    // cover editable widget appearances so their old values never show through.
    annotationMode: pdfjs.AnnotationMode.ENABLE,
  });
  await renderTask.promise;
  if (sequence !== renderSequence) return;
  for (const field of prepared.fields) {
    field.widgets.forEach((widget, index) => {
      if (widget.page !== pageNumber) return;
      const rect = [...viewport.convertToViewportPoint(widget.x, widget.y), ...viewport.convertToViewportPoint(widget.x + widget.width, widget.y + widget.height)];
      const width = Math.abs(rect[2] - rect[0]);
      const height = Math.abs(rect[3] - rect[1]);
      if (width < 1 || height < 1) return;
      const input = createInput(field, widget, index);
      input.style.left = `${Math.min(rect[0], rect[2])}px`;
      input.style.top = `${Math.min(rect[1], rect[3])}px`;
      input.style.width = `${width}px`;
      input.style.height = `${height}px`;
      input.style.fontSize = `${Math.max(5, Math.min(field.multiline ? 10 * scale : height * 0.68, 12 * scale))}px`;
      fieldsLayer.append(input);
    });
    syncFieldInputs(field);
  }
  pageFrame.hidden = false;
  stage.setAttribute('aria-busy', 'false');
  pageSelect.value = String(pageNumber);
  pageFrame.setAttribute('aria-label', `Page ${pageNumber} of ${pdf.numPages}`);
  updateControls();
  if (focusSnapshot) {
    const input = Array.from(fieldsLayer.querySelectorAll<FieldInput>('[data-field]')).find((candidate) =>
      candidate.dataset.field === focusSnapshot.name && (!(candidate instanceof HTMLInputElement) || candidate.type !== 'radio' || candidate.value === focusSnapshot.value));
    input?.focus({ preventScroll: true });
    if (input && !(input instanceof HTMLSelectElement) && focusSnapshot.start !== null && focusSnapshot.end !== null) {
      input.setSelectionRange(focusSnapshot.start, focusSnapshot.end);
    }
  }
}

function queueRender() {
  const sequence = ++renderSequence;
  renderTask?.cancel();
  stage.setAttribute('aria-busy', 'true');
  // Wait for cancellation before reusing the canvas, including rapid page/zoom changes.
  renderPromise = renderPromise.catch(() => {}).then(() => renderPage(sequence)).catch((error: unknown) => {
    if (sequence !== renderSequence || (error instanceof Error && error.name === 'RenderingCancelledException')) return;
    stage.setAttribute('aria-busy', 'false');
    showError(`The page could not be displayed. ${messageOf(error)}`, queueRender);
  });
  return renderPromise;
}

function goToPage(page: number) {
  if (!pdf || busy) return;
  currentPage = Math.min(pdf.numPages, Math.max(1, page));
  stage.scrollTo({ top: 0, left: 0 });
  help.textContent = defaultHelp;
  updateControls();
  void queueRender();
}

function finishNativeExport(error?: string) {
  if (!busy) return;
  setBusy(false);
  if (error) showError(error, () => { void exportPdf(lastExportAction); });
  else status.textContent = lastExportAction === 'print'
    ? 'Print dialog closed. You can continue editing or save a filled copy.'
    : 'Save dialog closed. You can continue editing this form.';
}

async function exportPdf(action: ExportAction) {
  if (busy || !prepared) return;
  clearError();
  let printWindow: Window | null = null;
  // Reserve the tab in the click handler, before generating bytes, to respect popup blockers.
  if (action === 'print' && !config.native) {
    printWindow = window.open('about:blank', '_blank');
    if (!printWindow) {
      showError('Allow a new tab for this site, then choose Print again. You can also save the PDF and print the saved file.', () => { void exportPdf('print'); });
      return;
    }
    printWindow.opener = null;
    printWindow.document.title = 'Preparing filled PDF';
    printWindow.document.body.textContent = 'Preparing your filled PDF. When it opens, use the PDF viewer’s Print button.';
  }
  lastExportAction = action;
  setBusy(true);
  status.textContent = 'Preparing your current answers in the filled PDF…';
  try {
    const snapshot = { ...values };
    const bytes = await saveFreePdf(prepared.bytes, prepared.fields, snapshot);
    if (config.native) {
      if (!host.ReactNativeWebView) throw new Error('The device save connection is unavailable. Close and reopen this form, then try again.');
      notify({ type: 'export', action, base64: encodeBase64(bytes) });
      // The user may keep the system save/print sheet open indefinitely. Only
      // the host's result can release the operation and allow another export.
      return;
    }
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
    if (action === 'save') {
      const link = document.createElement('a');
      link.href = url;
      link.download = `${config.formId.replace(/[^a-z0-9-]/gi, '') || 'Form'}-filled.pdf`;
      document.body.append(link);
      link.click();
      link.remove();
      // Leave enough time for the browser to consume the download before revocation.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      status.textContent = 'Your filled PDF is ready to save. You can reopen it in a PDF app to continue editing.';
    } else if (printWindow && !printWindow.closed) {
      printWindow.location.replace(url);
      // The opened viewer owns this object URL for this editor session. Do not revoke it
      // while the user is reading or printing the document in the separate viewer tab.
      status.textContent = 'Filled PDF opened in a new tab. Use the PDF viewer’s Print button to print it.';
    } else {
      URL.revokeObjectURL(url);
      throw new Error('The print tab was closed. Choose Print to open it again.');
    }
    setBusy(false);
  } catch (error) {
    printWindow?.close();
    setBusy(false);
    showError(messageOf(error), () => { void exportPdf(action); });
    status.textContent = 'Your answers are still here. Try again when you are ready.';
    if (error instanceof FreePdfValidationError && error.fieldName) {
      const invalidField = prepared.fields.find((field) => field.name === error.fieldName);
      if (invalidField?.widgets[0]) {
        currentPage = invalidField.widgets[0].page;
        await queueRender();
        const input = Array.from(fieldsLayer.querySelectorAll<FieldInput>('[data-field]')).find((candidate) => candidate.dataset.field === invalidField.name);
        input?.scrollIntoView({ block: 'center', inline: 'nearest' });
        input?.focus({ preventScroll: true });
      }
    }
  }
}

async function initialize() {
  if (loading) return;
  loading = true;
  clearError();
  status.textContent = 'Opening your fillable PDF…';
  updateControls();
  try {
    const value: unknown = JSON.parse(element<HTMLElement>('pdf-config').textContent || '{}');
    if (!value || typeof value !== 'object' || !('base64' in value) || !('formId' in value)
      || typeof value.base64 !== 'string' || typeof value.formId !== 'string') {
      throw new Error('The form could not be opened. Close this window and choose the free form again.');
    }
    config = value as Config;
    title.textContent = `${config.formId} · Free PDF form`;
    document.title = `${config.formId} — Fillable PDF`;
    prepared = await prepareFreePdf(decodeBase64(config.base64), config.formId);
    values = Object.create(null);
    prepared.fields.forEach((field) => { values[field.name] = field.value; });
    pdf = await pdfjs.getDocument({
      data: new Uint8Array(prepared.bytes),
      useSystemFonts: true,
      useWasm: false,
      verbosity: pdfjs.VerbosityLevel.ERRORS,
    }).promise;
    pageSelect.replaceChildren();
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const option = document.createElement('option');
      option.value = String(number);
      option.textContent = `Page ${number} of ${pdf.numPages}`;
      pageSelect.append(option);
    }
    currentPage = 1;
    await queueRender();
    if (!errorBox.hidden) return;
    status.textContent = 'Your answers stay in this window until you save a filled copy.';
    notify({ type: 'ready' });
  } catch (error) {
    status.textContent = 'The PDF is not ready yet.';
    showError(messageOf(error), () => { void initialize(); });
  } finally {
    loading = false;
    updateControls();
  }
}

previousButton.addEventListener('click', () => goToPage(currentPage - 1));
nextButton.addEventListener('click', () => goToPage(currentPage + 1));
pageSelect.addEventListener('change', () => goToPage(Number(pageSelect.value)));
zoomSelect.addEventListener('change', () => { void queueRender(); });
saveButton.addEventListener('click', () => { void exportPdf('save'); });
printButton.addEventListener('click', () => { void exportPdf('print'); });
retryButton.addEventListener('click', () => { const action = retryAction; clearError(); action?.(); });
function receiveMessage(event: MessageEvent) {
  if (!config?.native) return;
  try {
    const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    if (data?.type === 'export-result') finishNativeExport(typeof data.error === 'string' ? data.error : undefined);
  } catch { /* Unrelated bridge messages are not editor commands. */ }
}
window.addEventListener('message', receiveMessage);
// Android WebViews may dispatch bridge messages on document instead of window.
document.addEventListener('message', receiveMessage as EventListener);
let resizeTimer: ReturnType<typeof setTimeout>;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    // The mobile keyboard changes height, but does not require replacing inputs.
    if (zoomSelect.value === 'fit' && pdf && !busy && Math.abs(stage.clientWidth - renderedStageWidth) > 1) void queueRender();
  }, 180);
});
help.textContent = defaultHelp;
void initialize();
