import { createAuthenticatedEndpoint, HttpError, serviceRpc, UUID } from '../_shared/http.mjs';
import { FREE_AI_FORMS, PAYMENT_FORM_IDS, readPaymentConfig, reconcilePaymentUser, verifyPaymentProduct } from '../_shared/payments.mjs';

export function createPaymentHandler({ env,fetchImpl = fetch }) {
  return createAuthenticatedEndpoint({ env,fetchImpl,action:async ({ input,user,config }) => {
    if (!['status','reconcile','prepare','cancel'].includes(input.action) || !UUID.test(input.caseId || '') || !PAYMENT_FORM_IDS.includes(input.formId)
      || !['ios','android','web'].includes(input.platform) || (input.parentCaseId !== undefined && !UUID.test(input.parentCaseId))
      || Object.keys(input).some(key => !['action','caseId','formId','parentCaseId','platform'].includes(key)))
      throw new HttpError(422,'invalid_payment_request','Check your payment request and try again.');
    const caseId = input.caseId.toLowerCase(),formId = input.formId;
    let environment;
    const receipt = (access,productId = null) => ({ body:{ caseId,formId,access,productId,...(environment ? { environment } : {}) } });
    if (FREE_AI_FORMS.includes(formId)) return receipt('granted');
    const payment = readPaymentConfig(env);
    environment = payment?.environment;
    if (!payment || input.platform === 'web' || ['G-639','I-821','I-821D','I-765WS'].includes(formId)) return receipt('unavailable');
    const store = input.platform === 'ios' ? 'app_store' : 'play_store';
    const product = payment.products.find(p => p.formId === formId && p.store === store);
    const included = !!input.parentCaseId && ['I-130','I-130A'].includes(formId);
    if (!product && !['I-130','I-130A'].includes(formId)) return receipt('unavailable');
    // Validate sale configuration before offering a checkout, even when no purchase exists.
    if (product && !included) await verifyPaymentProduct(payment,product,fetchImpl);
    await reconcilePaymentUser({ config,payment,userId:user.id,fetchImpl });
    const result = await serviceRpc(config,'fillout_payment_case',{ p_user_id:user.id,p_case_id:caseId,p_form_id:formId,
      p_parent_case_id:input.parentCaseId?.toLowerCase() ?? null,p_action:input.action },fetchImpl);
    if (typeof result?.allowed !== 'boolean') throw Error('Invalid payment receipt');
    if (result.allowed && !['production','sandbox'].includes(result.environment)) throw Error('Missing payment environment');
    if (result.environment !== undefined && result.environment !== null) {
      if (!['production','sandbox'].includes(result.environment)) throw Error('Invalid payment environment');
      environment = result.environment;
    }
    const response = receipt(result.allowed ? 'granted' : included || result.included || result.unavailable || result.recoverCaseId || !product ? 'unavailable' : 'payment_required',included || result.included ? null : product?.productId ?? null);
    if (result.purchaseState === 'pending' && !result.allowed && !result.recoverCaseId) response.body.purchaseState = 'pending';
    if (result.recoverCaseId !== undefined && result.recoverCaseId !== null) {
      if (result.allowed || !UUID.test(result.recoverCaseId) || result.recoverCaseId === caseId) throw Error('Invalid recovered case receipt');
      response.body.recoverCaseId = result.recoverCaseId;
    }
    if (input.action === 'prepare') {
      if (typeof result.purchasePrepared !== 'boolean') throw Error('Invalid reservation receipt');
      response.body.purchasePrepared = result.purchasePrepared;
    }
    return response;
  } });
}
