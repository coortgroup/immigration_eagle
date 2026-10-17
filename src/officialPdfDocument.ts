import { Platform } from 'react-native';
import { Asset } from 'expo-asset';
import { randomUUID } from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

export type PrintableDocument = {
  uri: string;
  download: () => Promise<void>;
  /** On web, opens the PDF viewer where the user can print the document. */
  print?: () => Promise<void>;
  share?: () => Promise<void>;
  /** Release the app's temporary copy; user-saved or shared copies are unaffected. */
  dispose: () => void;
};

/** Load only a bundled blank template. Filled documents never pass through this function. */
export async function loadPrintTemplate(module: number): Promise<Uint8Array> {
  const asset = Asset.fromModule(module);
  if (Platform.OS === 'web') {
    const response = await fetch(asset.localUri || asset.uri);
    if (!response.ok) throw new Error('The official form template could not be loaded.');
    return new Uint8Array(await response.arrayBuffer());
  }
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error('The official form template is unavailable on this device.');
  return new File(asset.localUri).bytes();
}

/** Keep the completed document local until the user explicitly downloads, prints or shares it. */
export async function createPrintableDocument(bytes: Uint8Array, formId: string, dialogTitle = 'Save or share completed form', options: { test?: boolean } = {}): Promise<PrintableDocument> {
  if (!bytes.byteLength) throw new Error('The completed PDF is empty.');
  const formCode = /^[A-Z]{1,3}-[0-9]{1,5}[A-Z]{0,3}$/.test(formId) ? formId : 'Form';
  const filename = `${options.test ? 'TEST-' : ''}${formCode}-filled`;
  if (Platform.OS === 'web') return createWebDocument(bytes, `${filename}.pdf`);

  const file = new File(Paths.cache, `${filename}-${randomUUID()}.pdf`);
  try {
    file.create();
    file.write(bytes);
  } catch {
    try { if (file.exists) file.delete(); } catch { /* The OS can also purge this cache file. */ }
    throw new Error('The completed PDF could not be saved on this device.');
  }
  let disposed = false;
  let activeOperations = 0;

  function cleanup() {
    if (!disposed || activeOperations) return;
    try { if (file.exists) file.delete(); } catch { /* Cache cleanup must not interrupt screen navigation. */ }
  }

  async function useDocument(action: () => Promise<void>) {
    if (disposed || !file.exists) throw new Error('Generate the PDF again before opening it.');
    activeOperations += 1;
    try { await action(); }
    finally { activeOperations -= 1; cleanup(); }
  }

  const share = () => useDocument(async () => {
    if (!await Sharing.isAvailableAsync()) throw new Error('Saving and sharing files is unavailable on this device.');
    await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle });
  });
  return {
    uri: file.uri,
    // The native share sheet includes Save to Files and other user-chosen destinations.
    download: share,
    share,
    print: () => useDocument(() => Print.printAsync({ uri: file.uri })),
    dispose: () => { disposed = true; cleanup(); },
  };
}

function createWebDocument(bytes: Uint8Array, filename: string): PrintableDocument {
  // Copy the input so regenerating/editing answers cannot mutate an existing download.
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
  const uri = URL.createObjectURL(blob);
  let disposed = false;
  function ensureAvailable() {
    if (disposed) throw new Error('Generate the PDF again before opening it.');
  }
  return {
    uri,
    download: async () => {
      ensureAvailable();
      const link = document.createElement('a');
      link.href = uri;
      link.download = filename;
      document.body.appendChild(link);
      try { link.click(); }
      finally { link.remove(); }
    },
    print: async () => {
      ensureAvailable();
      // Browsers do not reliably expose PDF print() through an iframe. The PDF viewer
      // provides the actual document's print controls instead of printing the app page.
      const viewer = window.open('about:blank', '_blank');
      if (!viewer) throw new Error('Allow a new tab to open the PDF for printing.');
      viewer.opener = null;
      viewer.location.replace(uri);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      URL.revokeObjectURL(uri);
    },
  };
}
