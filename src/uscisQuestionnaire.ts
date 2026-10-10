import rawQuestionnaire from '../data/uscis-i90-questionnaire.json';
import templates from '../data/uscis-print-templates.json';
import type { PrintAnswers, PrintFieldDefinition, PrintTemplateDefinition } from './pdfEngine';

export type QuestionnaireAnswer = string | string[];
export type QuestionnaireAnswers = Record<string, QuestionnaireAnswer>;
export type QuestionCondition =
  | { field: string; equals?: string; includes?: string; oneOf?: string[] }
  | { all: QuestionCondition[] };
export type QuestionField = {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'date' | 'select' | 'radio' | 'multiselect';
  required: boolean;
  requiredWhen?: QuestionCondition;
  maxLength?: number;
  placeholder?: string;
  validation?: string;
  options?: { value: string; label: string }[];
  pdfFields: { name: string; option?: string; exportValue?: string; transform?: 'digit1' | 'digit2' | 'digit3' }[];
};
export type QuestionnaireQuestion = {
  id: string;
  part: number;
  item: string;
  title: string;
  help: string;
  fields: QuestionField[];
  when?: QuestionCondition;
  source: { formPages: number[]; instructionPages: number[] };
};
export type QuestionnaireSigning = {
  role: string; part: number; page: number; instruction: string;
  blankPdfFields: string[]; when?: QuestionCondition;
};
export type QuestionnaireDefinition = {
  schemaVersion: number;
  id: string; formId: string; title: string; edition: string;
  originalSha256: string; sourceUrl: string; pdfUrl: string; instructionsUrl: string;
  sourceVerifiedAt: string; coverageStatus: string; coverageDescription: string; generalHelp: string;
  questions: QuestionnaireQuestion[];
  derived: { name: string; fromField: string; when?: QuestionCondition }[];
  signing: QuestionnaireSigning[];
  excluded: { name: string; reason: string }[];
  printFields: PrintFieldDefinition[];
  coverage: { officialWidgets: number; mappedAnswerWidgets: number; derivedWidgets: number; blankSignatureAndDateWidgets: number; excludedBarcodes: number };
};

export const i90Questionnaire = rawQuestionnaire as QuestionnaireDefinition;

export function conditionMatches(condition: QuestionCondition | undefined, answers: QuestionnaireAnswers): boolean {
  if (!condition) return true;
  if ('all' in condition) return condition.all.every(item => conditionMatches(item, answers));
  const value = answers[condition.field];
  if (condition.equals !== undefined) return typeof value === 'string' && value === condition.equals;
  if (condition.includes !== undefined) return Array.isArray(value) && value.includes(condition.includes);
  if (condition.oneOf) return typeof value === 'string' && condition.oneOf.includes(value);
  return false;
}

/** Build the active path in order, so answers in hidden ancestor branches never leak. */
export function activeQuestions(answers: QuestionnaireAnswers): QuestionnaireQuestion[] {
  const active: QuestionnaireQuestion[] = [];
  const visibleAnswers: QuestionnaireAnswers = {};
  for (const question of i90Questionnaire.questions) {
    if (!conditionMatches(question.when, visibleAnswers)) continue;
    active.push(question);
    for (const field of question.fields) {
      if (Object.prototype.hasOwnProperty.call(answers, field.id)) visibleAnswers[field.id] = answers[field.id];
    }
  }
  return active;
}

export function activeAnswers(answers: QuestionnaireAnswers): QuestionnaireAnswers {
  const result: QuestionnaireAnswers = {};
  for (const question of activeQuestions(answers)) {
    for (const field of question.fields) {
      if (Object.prototype.hasOwnProperty.call(answers, field.id)) result[field.id] = answers[field.id];
    }
  }
  return result;
}

export function isFieldRequired(field: QuestionField, answers: QuestionnaireAnswers): boolean {
  return field.required || (field.requiredWhen ? conditionMatches(field.requiredWhen, activeAnswers(answers)) : false);
}

export function applicableSigning(answers: QuestionnaireAnswers): QuestionnaireSigning[] {
  const visible = activeAnswers(answers);
  return i90Questionnaire.signing.filter(signature => conditionMatches(signature.when, visible));
}

function scalar(answers: QuestionnaireAnswers, id: string): string {
  return typeof answers[id] === 'string' ? answers[id].trim() : '';
}

function isDate(value: string): boolean {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(value)) return false;
  const [month, day, year] = value.split('/').map(Number);
  if (year < 1800 || year > 2199) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isUsCountry(value: string): boolean {
  return ['us', 'usa', 'unitedstates', 'unitedstatesofamerica', 'unitedstatesusa', 'unitedstatesus'].includes(value.toLowerCase().replace(/[.\s()]/g, ''));
}

/** Validate displayed answers without converting unknown facts or silently truncating. */
export function validateQuestion(question: QuestionnaireQuestion, answers: QuestionnaireAnswers): Record<string, string> {
  if (!activeQuestions(answers).some(item => item.id === question.id)) return {};
  const visible = activeAnswers(answers);
  const errors: Record<string, string> = {};
  for (const field of question.fields) {
    const raw = answers[field.id];
    const value = typeof raw === 'string' ? raw.trim() : '';
    const required = field.required || (field.requiredWhen ? conditionMatches(field.requiredWhen, visible) : false);
    if (field.type === 'multiselect') {
      if (raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0)) {
        if (required) errors[field.id] = 'Select at least one option.';
        continue;
      }
      if (!Array.isArray(raw) || new Set(raw).size !== raw.length || raw.some(item => typeof item !== 'string' || !field.options?.some(option => option.value === item))) {
        errors[field.id] = 'Select only the listed options.';
      }
      continue;
    }
    if (raw !== undefined && typeof raw !== 'string') { errors[field.id] = 'Enter one answer for this field.'; continue; }
    if (!value) {
      if (required) errors[field.id] = 'Enter an answer before continuing.';
      continue;
    }
    if (field.maxLength && [...value].length > field.maxLength) {
      errors[field.id] = `The official form allows ${field.maxLength} characters here. Use Part 8 if your answer needs more space.`;
      continue;
    }
    if (field.options && !field.options.some(option => option.value === value)) { errors[field.id] = 'Choose one of the listed options.'; continue; }
    if (field.type !== 'textarea' && /[\r\n]/.test(value)) { errors[field.id] = 'Enter one line here; use Part 8 for additional information.'; continue; }
    if (field.validation === 'date' && !isDate(value)) errors[field.id] = 'Enter a real date in MM/DD/YYYY format.';
    if (['birth_date', 'admission_date'].includes(field.id) && isDate(value)) {
      const [month, day, year] = value.split('/').map(Number);
      const now = new Date();
      if (Date.UTC(year, month - 1, day) > Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) errors[field.id] = 'This date cannot be in the future.';
    }
    if (field.validation === 'a-number' && !/^(?:\d{7,9}|N\/A)$/i.test(value)) errors[field.id] = 'Enter 7–9 digits without A, or N/A if you have no A-Number.';
    if (field.validation === 'online-account' && !/^(?:\d{12}|N\/A)$/i.test(value)) errors[field.id] = 'Enter your 12-digit USCIS Online Account Number, or leave blank if you do not have one.';
    if (field.validation === 'ssn' && !/^(?:\d{9}|None|N\/A)$/i.test(value)) errors[field.id] = 'Enter nine digits without dashes, or leave blank if you do not have an SSN.';
    if (field.validation === 'zip' && !/^\d{5}$/.test(value) && !/^N\/A$/i.test(value)) errors[field.id] = 'Enter a five-digit ZIP code.';
    if (field.validation === 'phone' && !/^(?:[+\d ()-]+|N\/A|None)$/i.test(value)) errors[field.id] = 'Enter a telephone number using digits and telephone punctuation.';
    if (field.validation === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !/^N\/A$/i.test(value)) errors[field.id] = 'Enter a valid email address, or leave blank if you do not have one.';
    if (field.validation === 'weight' && (!/^\d{3}$/.test(value) || (value !== '000' && (Number(value) < 30 || Number(value) > 699)))) errors[field.id] = 'Enter three digits from 030–699, or 000 as directed in the instructions.';
    if (field.id === 'admission_class' && !/^[A-Za-z0-9]{3}$/.test(value)) errors[field.id] = 'Enter the three-character class of admission printed on your card.';
  }
  if (question.id === 'admission') {
    const birth = scalar(answers, 'birth_date');
    const admission = scalar(answers, 'admission_date');
    if (isDate(birth) && isDate(admission)) {
      const sortable = (date: string) => date.slice(6) + date.slice(0, 2) + date.slice(3, 5);
      if (sortable(admission) < sortable(birth)) errors.admission_date = 'Check this date: admission cannot be before your birth.';
    }
  }
  if (question.id === 'commuter-port' && answers.resident_status === 'commuter' && scalar(answers, 'mail_country') && !isUsCountry(scalar(answers, 'mail_country')) && !scalar(answers, 'commuter_port')) {
    errors.commuter_port = 'The instructions require your U.S. port of entry when a current commuter uses a foreign mailing address.';
  }
  for (const prefix of ['mail', 'physical', 'interpreter', 'preparer']) {
    if (!question.fields.some(field => field.id === `${prefix}_country`)) continue;
    if (isUsCountry(scalar(answers, `${prefix}_country`))) {
      if (!scalar(answers, `${prefix}_state`)) errors[`${prefix}_state`] = 'Select the state for this U.S. address.';
      if (!/^\d{5}$/.test(scalar(answers, `${prefix}_zip`))) errors[`${prefix}_zip`] = 'Enter the five-digit ZIP code for this U.S. address.';
    }
    if (scalar(answers, `${prefix}_unit_type`) === 'none' && scalar(answers, `${prefix}_unit`)) {
      errors[`${prefix}_unit`] = 'Choose the unit type for this number, or clear the unit number.';
    }
  }
  if (question.id.startsWith('additional-')) {
    const suffix = question.id.slice('additional-'.length);
    const ids = ['page', 'part', 'item', 'text'].map(key => `additional_${suffix}_${key}`);
    if (ids.some(id => scalar(answers, id))) {
      for (const id of ids) if (!scalar(answers, id)) errors[id] = 'Complete the page, part, item and explanation for this entry.';
      const page = scalar(answers, ids[0]);
      if (page && (!/^\d+$/.test(page) || Number(page) < 1 || Number(page) > 7)) errors[ids[0]] = 'Enter an official form page number from 1 to 7.';
      const part = scalar(answers, ids[1]);
      if (part && (!/^\d+$/.test(part) || Number(part) < 1 || Number(part) > 8)) errors[ids[1]] = 'Enter a part number from 1 to 8.';
    }
  }
  return errors;
}

export function validateI90Answers(answers: QuestionnaireAnswers): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const question of activeQuestions(answers)) Object.assign(errors, validateQuestion(question, answers));
  if (answers.resident_status === 'commuter' && answers.reason_a !== '2h2' && answers.physical_different === 'no' && isUsCountry(scalar(answers, 'mail_country'))) {
    errors.physical_different = 'Current commuters are instructed to provide their foreign physical residence address. Review the physical address section.';
  }
  for (const [field, item] of [['removal_history', '4'], ['abandonment_history', '5']]) {
    if (answers[field] !== 'yes') continue;
    const hasExplanation = [1, 2, 3, 4, 5].some(index =>
      scalar(answers, `additional_${index}_page`) === '3' &&
      scalar(answers, `additional_${index}_part`) === '3' &&
      // A combined explanation may explicitly refer to both items 4 and 5.
      scalar(answers, `additional_${index}_item`).split(/\s*[,;&/]\s*/).includes(item) &&
      scalar(answers, `additional_${index}_text`).length > 0 &&
      !/^(?:N\/?A|None|Not applicable|No)[.!]?$/i.test(scalar(answers, `additional_${index}_text`)),
    );
    if (!hasExplanation) errors[field] = `Add a detailed explanation for Part 3, Item ${item} in Part 8.`;
  }
  return errors;
}

export class QuestionnaireValidationError extends Error {
  readonly errors: Record<string, string>;
  constructor(errors: Record<string, string>) {
    super(Object.values(errors)[0] || 'Review the answers before generating the official form.');
    this.name = 'QuestionnaireValidationError';
    this.errors = errors;
  }
}

export function questionForPdfField(fieldName: string): QuestionnaireQuestion | undefined {
  const direct = i90Questionnaire.questions.find(question => question.fields.some(field => field.pdfFields.some(mapping => mapping.name === fieldName)));
  if (direct) return direct;
  const derived = i90Questionnaire.derived.find(field => field.name === fieldName);
  return derived ? i90Questionnaire.questions.find(question => question.fields.some(field => field.id === derived.fromField)) : undefined;
}

function assertCoverage(): void {
  const expected = new Set(i90Questionnaire.printFields.map(field => field.name));
  const mapped = [
    ...i90Questionnaire.questions.flatMap(question => question.fields.flatMap(field => field.pdfFields.map(mapping => mapping.name))),
    ...i90Questionnaire.derived.map(field => field.name),
    ...i90Questionnaire.signing.flatMap(signature => signature.blankPdfFields),
    ...i90Questionnaire.excluded.map(field => field.name),
  ];
  if (expected.size !== 195 || mapped.length !== 195 || new Set(mapped).size !== 195 || mapped.some(name => !expected.has(name))) {
    throw new Error('The I-90 mapping does not cover the verified official form.');
  }
}

/** A pure, deterministic map: no AI, transmission, guessed facts or signing. */
export function mapI90Answers(input: QuestionnaireAnswers): { definition: PrintTemplateDefinition; answers: PrintAnswers } {
  assertCoverage();
  const errors = validateI90Answers(input);
  if (Object.keys(errors).length) throw new QuestionnaireValidationError(errors);
  const template = templates.templates['I-90'];
  if (template.originalSha256 !== i90Questionnaire.originalSha256 || template.pageCount !== 7) {
    throw new Error('The questionnaire and print template are different editions.');
  }
  const visible = activeAnswers(input);
  const answers: PrintAnswers = {};
  for (const question of activeQuestions(visible)) {
    for (const field of question.fields) {
      const value = visible[field.id];
      for (const mapping of field.pdfFields) {
        if (mapping.option !== undefined) {
          answers[mapping.name] = Array.isArray(value) ? value.includes(mapping.option) : value === mapping.option;
        } else if (typeof value === 'string' && value.trim()) {
          answers[mapping.name] = mapping.transform ? value.trim()[Number(mapping.transform.slice(-1)) - 1] : value.trim();
        }
      }
    }
  }
  for (const field of i90Questionnaire.derived) {
    if (!conditionMatches(field.when, visible)) continue;
    const value = visible[field.fromField];
    if (typeof value === 'string' && value.trim()) answers[field.name] = value.trim();
  }
  return { definition: { id: 'I-90', sha256: template.sha256, pageCount: 7, fields: i90Questionnaire.printFields }, answers };
}
