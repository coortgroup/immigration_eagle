import rawDefinitions from '../data/uscis-guided-questionnaires.json';
import type { QuestionCondition } from './uscisQuestionnaire';

/** Pinned, source-backed form inputs. IDs and PDF names are internal only. */
export type GuidedField = {
  id: string;
  label: string;
  help?: string;
  kind: 'text' | 'textarea' | 'radio' | 'select' | 'checkbox' | 'multiselect';
  required?: boolean;
  maxLength?: number;
  options?: { value: string; label: string }[];
  pdfFields: { name: string; option?: string; exportValue?: string }[];
  source: { page: number; pages?: number[]; item?: string; officialLabel: string };
  when?: QuestionCondition;
};

export type GuidedSection = { id: string; page: number; title: string; fields: GuidedField[] };
export type GuidedFormDefinition = {
  id: string;
  title: string;
  edition: string;
  templateSha256: string;
  originalSha256: string;
  pageCount: number;
  pdfUrl: string;
  sourceUrl: string;
  instructionsUrl: string;
  generalHelp: string;
  sections: GuidedSection[];
  signing: { role: string; page: number; instruction: string; blankPdfFields: string[] }[];
  excluded: { name: string; page: number; reason: string }[];
  coverage: { officialFields: number; editableFields: number; mappedFields: number; protectedFields: number; questions: number };
};

export const guidedFormDefinitions = rawDefinitions.forms as Record<string, GuidedFormDefinition>;

export function getGuidedFormDefinition(formId: string): GuidedFormDefinition | undefined {
  return guidedFormDefinitions[formId];
}

export const getGuidedFormSchema = getGuidedFormDefinition;
