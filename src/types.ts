export type PreparationMode = 'self' | 'ai' | 'attorney';
export type DraftStage = 'check' | 'interview' | 'fullPreparation' | 'freePreparation' | 'attorney';
export type AttorneyStatus = 'awaiting_call' | 'preparing_documents' | 'sent';
export type QualificationAnswer = 'yes' | 'no' | 'unsure';
export type QuestionOutcome = 'next' | 'stop' | 'review';

export interface QualificationQuestion {
  id: string;
  text: string;
  help?: string;
  yes: QuestionOutcome;
  no: QuestionOutcome;
  stopReason?: string;
  reviewReason?: string;
  reason?: string;
}

export interface QualificationSchema {
  id: string;
  sourceUrl: string;
  pdfUrl?: string | null;
  scope?: string;
  questions: QualificationQuestion[];
}

export interface QualificationResult {
  status: 'checking' | 'passed' | 'stopped' | 'review';
  index: number;
  reason?: string;
}

export interface PreparationField {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'date' | 'email' | 'tel';
  required?: boolean;
  help?: string;
}

export interface FormRecord {
  id: string;
  title: string;
  summary: string;
  category: string;
  officialUrl: string;
  availability: string;
  relatedTo?: string[];
}

export interface DraftSummary {
  formId: string;
  title: string;
  answered: number;
  total: number;
  updatedAt: string;
  mode?: PreparationMode;
  stage?: DraftStage;
  attorneyStatus?: AttorneyStatus;
  paymentCaseId?: string;
}
