import { PreparationField, QualificationAnswer, QualificationResult, QualificationSchema } from './types';

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
