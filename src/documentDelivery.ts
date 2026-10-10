export type DocumentDeliveryChoice = 'self' | 'mailing';
export type MailingDestination = 'applicant' | 'agency';

/** A quote supplied by the mailing service, never calculated from preparation prices. */
export type MailingQuote = {
  id: string;
  amountMinor: number;
  currency: string;
};

export type MailingConfiguration = {
  quote?: MailingQuote;
  destination?: MailingDestination;
  requestAvailable?: boolean;
};

export type MailingRequest = {
  formId: string;
  quoteId: string;
  destination: MailingDestination;
  reviewed: true;
  signedPacketConfirmed: boolean;
  consent: true;
};

export type DocumentDeliveryState = {
  choice: DocumentDeliveryChoice;
  reviewed: boolean;
  signedPacketConfirmed: boolean;
  consent: boolean;
};

export const initialDocumentDeliveryState: DocumentDeliveryState = {
  choice: 'self', reviewed: false, signedPacketConfirmed: false, consent: false,
};

export function formatMailingQuote(quote?: MailingQuote): string | null {
  if (!quote?.id.trim() || !Number.isSafeInteger(quote.amountMinor) || quote.amountMinor <= 0 || !/^[A-Z]{3}$/.test(quote.currency)) return null;
  try {
    const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: quote.currency, currencyDisplay: 'code' });
    const decimals = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(quote.amountMinor / 10 ** decimals);
  } catch {
    return null;
  }
}

/** These are UI gates; a fulfillment backend must independently verify the quote and packet. */
export function getDocumentDeliveryStatus(input: {
  pdfReady: boolean;
  mailing?: MailingConfiguration;
  state: DocumentDeliveryState;
  hasRequestHandler: boolean;
  busy?: boolean;
}) {
  const { pdfReady, mailing, state, hasRequestHandler, busy } = input;
  const price = formatMailingQuote(mailing?.quote);
  const destination = mailing?.destination === 'applicant' || mailing?.destination === 'agency' ? mailing.destination : undefined;
  const needsSignature = destination === 'agency';
  const destinationLabel = destination === 'applicant'
    ? 'Print and mail to me for signature'
    : destination === 'agency' ? 'Mail my reviewed, signed packet to USCIS' : 'Delivery destination to be confirmed';
  let blockedReason: string | null = null;
  if (state.choice !== 'mailing') blockedReason = 'Choose the mailing service to continue.';
  else if (!pdfReady) blockedReason = 'Your filled official PDF must be ready first.';
  else if (!price) blockedReason = 'Mailing price to be confirmed';
  else if (!destination) blockedReason = 'Delivery destination to be confirmed';
  else if (!mailing?.requestAvailable || !hasRequestHandler) blockedReason = 'Mailing requests are not available yet.';
  else if (!state.reviewed) blockedReason = 'Review your completed form before requesting mailing.';
  else if (needsSignature && !state.signedPacketConfirmed) blockedReason = 'Sign your packet before requesting mailing to USCIS.';
  else if (!state.consent) blockedReason = 'Confirm that you want to send this mailing request.';
  else if (busy) blockedReason = 'Sending your mailing request…';
  return { price, priceLabel: price ? `${price} additional` : 'Mailing price to be confirmed', destination, destinationLabel, needsSignature, blockedReason, canRequestMailing: !blockedReason };
}

export function createMailingRequest(input: {
  formId: string;
  pdfReady: boolean;
  mailing?: MailingConfiguration;
  state: DocumentDeliveryState;
  hasRequestHandler: boolean;
  busy?: boolean;
}): MailingRequest | null {
  const status = getDocumentDeliveryStatus(input);
  if (!input.formId.trim() || !status.canRequestMailing || !status.destination || !input.mailing?.quote) return null;
  return {
    formId: input.formId,
    quoteId: input.mailing.quote.id,
    destination: status.destination,
    reviewed: true,
    signedPacketConfirmed: input.state.signedPacketConfirmed,
    consent: true,
  };
}
