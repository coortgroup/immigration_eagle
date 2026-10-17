import { activePreparationQuestions, validatePreparationQuestion } from './guidedPreparation';
import type { QuestionnaireAnswers } from './uscisQuestionnaire';

/** A blank optional step is complete only after the applicant chooses Next. */
export function fullPreparationProgress(answers: QuestionnaireAnswers, completedQuestionIds: string[] = [], formId = 'I-90') {
  const questions = activePreparationQuestions(formId, answers);
  const completed = new Set(completedQuestionIds);
  const isComplete = (question: (typeof questions)[number]) => {
    if (Object.keys(validatePreparationQuestion(formId, question, answers)).length) return false;
    const answered = (field: (typeof question.fields)[number]) => {
      const value = answers[field.id];
      return Array.isArray(value) ? value.length > 0 : !!value?.trim();
    };
    // A partially filled group must resume at its remaining fields. Keep the
    // existing I-90 behavior where optional companions share a required step.
    return completed.has(question.id) || (formId === 'I-90' ? question.fields.some(answered) : question.fields.every(answered));
  };
  return {
    questions,
    answered: questions.filter(isComplete).length,
    firstIncomplete: questions.find(question => !isComplete(question)),
  };
}

/** Drop completion markers if a changed answer hides or invalidates a step. */
export function validCompletedQuestions(answers: QuestionnaireAnswers, completedQuestionIds: string[], formId = 'I-90'): string[] {
  const completed = new Set(completedQuestionIds);
  return activePreparationQuestions(formId, answers)
    .filter(question => completed.has(question.id) && !Object.keys(validatePreparationQuestion(formId, question, answers)).length)
    .map(question => question.id);
}
