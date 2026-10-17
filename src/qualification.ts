import { FormRecord, PreparationField, QualificationAnswer, QualificationResult, QualificationSchema } from './types';

// This evaluates a preliminary routing screen, never USCIS eligibility.
export function evaluateQualification(
  schema: QualificationSchema | undefined,
  answers: Record<string, QualificationAnswer>,
): QualificationResult {
  if (!schema?.questions?.length) {
    return { status: 'review', index: 0, reason: 'A specialist needs to review the requirements for this form.' };
  }
  for (let index = 0; index < schema.questions.length; index += 1) {
    const question = schema.questions[index];
    const answer = answers[question.id];
    if (answer === 'unsure') {
      return { status: 'review', index, reason: question.reviewReason || 'Let’s review this requirement before you continue. An uncertain answer does not mean you are ineligible.' };
    }
    if (answer !== 'yes' && answer !== 'no') return { status: 'checking', index };
    const outcome = question[answer];
    if (outcome === 'stop') return { status: 'stopped', index, reason: question.stopReason || question.reason || 'This form does not match the purpose you selected.' };
    if (outcome === 'review') return { status: 'review', index, reason: question.reviewReason || question.reason || 'Your situation needs individual review before continuing.' };
    if (outcome !== 'next') return { status: 'review', index, reason: 'We need to confirm the requirements before continuing.' };
  }
  return { status: 'passed', index: schema.questions.length };
}

export function validateField(field: PreparationField, value: string): string | null {
  const input = value.trim();
  if (!input) return field.required ? 'Please enter an answer to continue.' : null;
  if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)) return 'Enter a valid email address.';
  if (field.type === 'tel' && input.replace(/\D/g, '').length < 7) return 'Enter a phone number including its area code.';
  if (field.type === 'date') {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input);
    if (!match) return 'Use MM/DD/YYYY, for example 04/23/1990.';
    const month = Number(match[1]), day = Number(match[2]), year = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (year < 1900 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return 'Enter a valid calendar date.';
    if (field.id.includes('birth') && date > new Date()) return 'A date of birth cannot be in the future.';
  }
  return null;
}

export function draftProgress(fields: PreparationField[], answers: Record<string, string>, completedFieldIds: string[] = []) {
  const firstInvalid = fields.findIndex(field => validateField(field, answers[field.id] || '') !== null);
  const answered = fields.filter(field => !!answers[field.id]?.trim() && validateField(field, answers[field.id]) === null).length;
  const firstUnanswered = fields.findIndex(field => validateField(field, answers[field.id] || '') !== null
    || (!answers[field.id]?.trim() && !completedFieldIds.includes(field.id)));
  return { answered, total: fields.length, firstInvalid, firstUnanswered, complete: fields.length > 0 && firstUnanswered < 0 };
}

// Resume against today's questions instead of trusting a previously saved result.
export function draftResume(
  schema: QualificationSchema | undefined,
  checks: Record<string, QualificationAnswer>,
  fields: PreparationField[],
  answers: Record<string, string>,
  completedFieldIds: string[] = [],
) {
  return { qualification: evaluateQualification(schema, checks), progress: draftProgress(fields, answers, completedFieldIds) };
}

export function matchesFormSearch(form: FormRecord, query: string, alternateTitle = ''): boolean {
  // Treat I-130, I 130 and I130 alike, including pasted typographic dashes.
  const normalize = (value: string) => value.toLowerCase()
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\b([a-z]{1,2})[\s-]*(\d+)([a-z]*)\b/g, '$1$2$3')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const haystack = normalize(`${form.id} ${form.title} ${form.summary} ${form.category} ${alternateTitle}`);
  return normalize(query).split(/\s+/).every(word => haystack.includes(word));
}
