import templates from '../data/uscis-print-templates.json';
import { getGuidedFormDefinition } from './guidedFormSchema';
import { prepareFreePdf, saveFreePdf, FreePdfValidationError } from './freePdfEngine';
import {
  activeAnswers, activeQuestions, applicableSigning, conditionMatches, i90Questionnaire,
  questionForPdfField, QuestionnaireValidationError, validateI90Answers, validateQuestion,
  type QuestionField, type QuestionnaireAnswers, type QuestionnaireQuestion,
} from './uscisQuestionnaire';

export type PreparationField = QuestionField & { help?: string };
export type PreparationQuestion = Omit<QuestionnaireQuestion, 'fields'> & { fields: PreparationField[] };
export type PreparationDefinition = {
  formId: string;
  title: string;
  edition: string;
  instructionsUrl: string;
  generalHelp: string;
  questions: PreparationQuestion[];
};
const definitions = new Map<string, PreparationDefinition>();

/** Keep I-90's reviewed conditional interview; expose every other form's official fields. */
export function getPreparationDefinition(formId = 'I-90'): PreparationDefinition {
  if (formId === 'I-90') return i90Questionnaire;
  const existing = definitions.get(formId);
  if (existing) return existing;
  const schema = getGuidedFormDefinition(formId);
  if (!schema) throw new Error('This guided form is not available.');
  const questions: PreparationQuestion[] = [];
  for (const section of schema.sections) {
    let group: typeof section.fields = [];
    const flush = () => {
      if (!group.length) return;
      const first = group[0];
      questions.push({
        id: `${section.id}:${first.id}`,
        part: 0, item: first.source.item || '', title: group.length === 1 ? first.label : section.title,
        help: `These entries appear on page ${section.page} of the official ${formId} form. Follow the printed directions and leave an entry blank only when the form says it does not apply.`,
        when: first.when,
        source: { formPages: [section.page], instructionPages: [] },
        fields: group.map(field => ({
          ...field, type: field.kind === 'checkbox' ? 'multiselect' : field.kind,
          required: field.required ?? false,
          options: field.kind === 'checkbox' ? (field.options || [{ value: 'checked', label: field.label }]) : field.options,
        })),
      });
      group = [];
    };
    for (const field of section.fields) {
      const standalone = !['text', 'textarea'].includes(field.kind) || !!field.when;
      if (standalone || group.length === 4 || group.some(item => !!item.when)) flush();
      group.push(field);
      if (standalone || field.kind === 'textarea') flush();
    }
    flush();
  }
  const definition = { formId, title: schema.title, edition: schema.edition, instructionsUrl: schema.instructionsUrl || schema.sourceUrl, generalHelp: schema.generalHelp, questions };
  definitions.set(formId, definition);
  return definition;
}

export function activePreparationQuestions(formId: string, answers: QuestionnaireAnswers): PreparationQuestion[] {
  if (formId === 'I-90') return activeQuestions(answers);
  const result: PreparationQuestion[] = [];
  const visible: QuestionnaireAnswers = {};
  for (const question of getPreparationDefinition(formId).questions) {
    if (!conditionMatches(question.when, visible)) continue;
    result.push(question);
    for (const field of question.fields) if (Object.prototype.hasOwnProperty.call(answers, field.id)) visible[field.id] = answers[field.id];
  }
  return result;
}

export function activePreparationAnswers(formId: string, answers: QuestionnaireAnswers): QuestionnaireAnswers {
  if (formId === 'I-90') return activeAnswers(answers);
  const result: QuestionnaireAnswers = {};
  for (const question of activePreparationQuestions(formId, answers)) {
    for (const field of question.fields) if (Object.prototype.hasOwnProperty.call(answers, field.id)) result[field.id] = answers[field.id];
  }
  return result;
}

export function validatePreparationQuestion(formId: string, question: PreparationQuestion, answers: QuestionnaireAnswers): Record<string, string> {
  if (formId === 'I-90') return validateQuestion(question, answers);
  if (!activePreparationQuestions(formId, answers).some(item => item.id === question.id)) return {};
  const errors: Record<string, string> = {};
  for (const field of question.fields) {
    const raw = answers[field.id];
    if (field.type === 'multiselect') {
      if (raw === undefined || raw === '' || (Array.isArray(raw) && !raw.length)) {
        if (field.required) errors[field.id] = 'Select at least one option.';
      } else if (!Array.isArray(raw) || new Set(raw).size !== raw.length || raw.some(value => !field.options?.some(option => option.value === value))) errors[field.id] = 'Select only the listed options.';
      continue;
    }
    if (raw !== undefined && typeof raw !== 'string') { errors[field.id] = 'Enter one answer for this field.'; continue; }
    // Several official dropdown export values intentionally begin with a
    // space. Those values must round-trip exactly; only free text is trimmed.
    const value = typeof raw === 'string' ? field.options ? raw : raw.trim() : '';
    if (!value) {
      if (field.required) errors[field.id] = 'Enter an answer before continuing.';
      continue;
    }
    if (field.maxLength !== undefined && value.length > field.maxLength) errors[field.id] = `The official form allows ${field.maxLength} characters in this field. Use the form's additional-information space if needed.`;
    else if (field.options && !field.options.some(option => option.value === value)) errors[field.id] = 'Choose one of the listed options.';
    else if (field.type !== 'textarea' && /[\r\n]/.test(value)) errors[field.id] = 'This field accepts one line of text.';
    else if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value)) errors[field.id] = 'Use ordinary spaces and line breaks; this entry contains unsupported control characters.';
  }
  return errors;
}

export function validatePreparationAnswers(formId: string, answers: QuestionnaireAnswers): Record<string, string> {
  if (formId === 'I-90') return validateI90Answers(answers);
  return Object.assign({}, ...activePreparationQuestions(formId, answers).map(question => validatePreparationQuestion(formId, question, answers)));
}

export function preparationSigning(formId: string, answers: QuestionnaireAnswers): string[] {
  if (formId === 'I-90') return applicableSigning(answers).map(item => item.instruction);
  return getGuidedFormDefinition(formId)?.signing.map(item => item.instruction) || [];
}

export function preparationQuestionForPdfField(formId: string, name: string): PreparationQuestion | undefined {
  if (formId === 'I-90') return questionForPdfField(name);
  return getPreparationDefinition(formId).questions.find(question => question.fields.some(field => field.pdfFields.some(mapping => mapping.name === name)));
}

/** Explicit field mapping only: no inferred answers, signatures, or government-use values. */
export function mapGuidedPreparationAnswers(formId: string, answers: QuestionnaireAnswers): Record<string, string | boolean> {
  if (formId === 'I-90') throw new Error('Use the reviewed I-90 print mapping.');
  const errors = validatePreparationAnswers(formId, answers);
  if (Object.keys(errors).length) throw new QuestionnaireValidationError(errors);
  const visible = activePreparationAnswers(formId, answers);
  const values: Record<string, string | boolean> = {};
  const schema = getGuidedFormDefinition(formId)!;
  // Map every field, including hidden branches, so stale answers cannot leak.
  for (const section of schema.sections) for (const field of section.fields) {
    const value = visible[field.id];
    for (const mapping of field.pdfFields) {
      if (Object.prototype.hasOwnProperty.call(values, mapping.name)) throw new Error('The guided form contains a duplicate PDF mapping.');
      values[mapping.name] = mapping.option !== undefined
        ? Array.isArray(value) ? value.includes(mapping.option) : value === mapping.option
        : field.kind === 'checkbox' ? Array.isArray(value) && value.includes(field.options?.[0]?.value || 'checked')
          : typeof value === 'string' ? field.options ? value : value.trim() : '';
    }
  }
  return values;
}

/** The caller loads the hash-verified bundled edition with loadFreePdfTemplate. */
export async function fillGuidedPreparationPdf(formId: string, bytes: Uint8Array, answers: QuestionnaireAnswers): Promise<Uint8Array> {
  const schema = getGuidedFormDefinition(formId);
  const template = templates.templates[formId as keyof typeof templates.templates];
  if (!schema || !template || schema.templateSha256 !== template.sha256 || schema.pageCount !== template.pageCount) throw new Error('The questionnaire and PDF template are different editions.');
  const values = mapGuidedPreparationAnswers(formId, answers);
  const prepared = await prepareFreePdf(bytes, formId);
  if (prepared.pages.length !== schema.pageCount) throw new Error('The questionnaire and PDF template are different editions.');
  const actual = new Set(prepared.fields.map(field => field.name));
  for (const name of Object.keys(values)) if (!actual.has(name)) throw new FreePdfValidationError('unknown-field', 'This entry is not an editable field in the PDF.', name);
  const excluded = new Set(schema.excluded.map(field => field.name));
  if (prepared.fields.some(field => !Object.prototype.hasOwnProperty.call(values, field.name) && !excluded.has(field.name))) throw new Error('The guided questionnaire does not cover this PDF edition.');
  return saveFreePdf(prepared.bytes, prepared.fields, values);
}
