import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import templatesFile from '../data/uscis-print-templates.json';
import { loadPrintTemplate } from './officialPdfDocument';

// Literal requires let Expo include every blank form in web and native releases.
const assets: Record<string, number> = {
  'AR-11': require('../assets/uscis-print/ar-11.pdf'),
  'G-1145': require('../assets/uscis-print/g-1145.pdf'),
  'G-639': require('../assets/uscis-print/g-639.pdf'),
  'I-90': require('../assets/uscis-print/i-90.pdf'),
  'I-129F': require('../assets/uscis-print/i-129f.pdf'),
  'I-130': require('../assets/uscis-print/i-130.pdf'),
  'I-130A': require('../assets/uscis-print/i-130a.pdf'),
  'I-131': require('../assets/uscis-print/i-131.pdf'),
  'I-131A': require('../assets/uscis-print/i-131a.pdf'),
  'I-134': require('../assets/uscis-print/i-134.pdf'),
  'I-485': require('../assets/uscis-print/i-485.pdf'),
  'I-751': require('../assets/uscis-print/i-751.pdf'),
  'I-765': require('../assets/uscis-print/i-765.pdf'),
  'I-765WS': require('../assets/uscis-print/i-765ws.pdf'),
  'I-821': require('../assets/uscis-print/i-821.pdf'),
  'I-821D': require('../assets/uscis-print/i-821d.pdf'),
  'I-864': require('../assets/uscis-print/i-864.pdf'),
  'I-864A': require('../assets/uscis-print/i-864a.pdf'),
  'N-400': require('../assets/uscis-print/n-400.pdf'),
  'N-565': require('../assets/uscis-print/n-565.pdf'),
  'N-600': require('../assets/uscis-print/n-600.pdf'),
};

export async function loadFreePdfTemplate(formId: string): Promise<Uint8Array> {
  const definition = templatesFile.templates[formId as keyof typeof templatesFile.templates];
  if (!assets[formId] || !definition) throw new Error('This PDF form is not available.');
  const bytes = await loadPrintTemplate(assets[formId]);
  const hash = await digest(CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes).buffer);
  const hex = Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
  if (hex !== definition.sha256) throw new Error('This form could not be verified. Please reload the PDF.');
  return bytes;
}
