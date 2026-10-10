  let preparation=null;
  const modeNames={free:'Do it yourself · Free',ai:'Prepare with AI',attorney:'Prepare with an attorney'};
  const selectedForm=()=>forms.find(f=>f.id===state.formId);
  const qualificationSchema=()=>eligibilityForms.find(f=>f.id===state.formId);
  const interviewSchema=()=>preparationFields.forms.find(f=>f.id===state.formId);
  const canPrepare=()=>preparation?.formId===state.formId&&preparation.result.status==='passed'&&evaluateQualification(qualificationSchema(),preparation.answers).status==='passed';
  const flowContext=()=>`<div class="eagle-flow-context"><span class="eagle-form-code">${escape(state.formId)}</span><span>${escape(modeNames[preparation.mode])}</span></div>`;
  const flowSource=()=>`<a class="eagle-flow-source" href="${escape(qualificationSchema().sourceUrl)}" target="_blank" rel="noopener noreferrer">Read the USCIS requirements ${icon('arrow-up-right')}</a>`;
  const flowProgress=(current,total,label)=>`<div class="eagle-flow-progress"><p><span>${label}</span><span>${current} of ${total}</span></p><div class="eagle-flow-track" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${current}"><span style="width:${Math.round(current/total*100)}%"></span></div></div>`;
  function beginPreparation(mode) {
    if(!['free','ai','attorney'].includes(mode)||!qualificationSchema())return;
    preparation={formId:state.formId,mode,index:0,answers:{},result:{status:'checking'},draft:{},step:0,intake:{},intakePreview:false};
    navigate('qualification');
  }
  function qualification() {
    const schema=qualificationSchema(),q=schema.questions[preparation.index],choice=preparation.answers[q.id];
    return page(`<div class="eagle-subtop">${button(icon('chevron-left')+'Back','data-flow-action="previous-check"','eagle-text-button')}</div>${flowContext()}${flowProgress(preparation.index+1,schema.questions.length,'Form check')}<div class="eagle-eyebrow">BEFORE YOU BEGIN</div><h1 class="eagle-flow-question">${escape(q.text)}</h1>${q.help?`<p class="eagle-flow-help">${escape(q.help)}</p>`:''}<div class="eagle-binary" role="group" aria-label="Your answer">${['yes','no'].map(value=>button(value==='yes'?'Yes':'No',`data-check-answer="${value}" aria-pressed="${choice===value}"`,'cursor-interaction')).join('')}</div>${button(preparation.index===schema.questions.length-1?'See my result '+icon('arrow-right'):'Continue '+icon('arrow-right'),`data-flow-action="next-check" ${choice?'':'disabled'}`)}<div class="eagle-flow-actions">${button('I’m not sure','data-flow-action="uncertain-check"','eagle-text-button')}</div><p class="eagle-footnote">Initial check for ${escape(state.formId)}. It does not confirm every filing requirement or guarantee USCIS approval.</p>${flowSource()}`);
  }
  function qualificationResult() {
    const result=preparation.result,schema=qualificationSchema(),f=selectedForm();
    const passed=canPrepare(),review=result.status==='review';
    const heading=passed?'Congratulations!':review?'Let’s check your situation':'Sorry, this form isn’t a match';
    const copy=passed?`You passed the initial check for ${f.id}. You can continue with ${preparation.mode==='free'?'self-preparation':preparation.mode==='ai'?'AI preparation':'attorney assistance'}.`:result.reason||'Complete the form check before you continue.';
    let next='';
    if(passed&&preparation.mode==='free')next=`<div class="eagle-flow-summary"><h2>Your official ${escape(f.id)} PDF</h2><p>Open the fillable form, enter your answers, save a copy and print it using the PDF viewer. If editing is unavailable in your browser, download it and open it in Adobe Acrobat Reader.</p></div><a class="eagle-button cursor-interaction" data-official-pdf href="${escape(schema.pdfUrl)}" target="_blank" rel="noopener noreferrer">Open fillable PDF ${icon('arrow-up-right')}</a>`;
    if(passed&&preparation.mode==='ai')next=`<div class="eagle-flow-summary"><h2>One question at a time</h2><p>Start with ${escape(interviewSchema().subject.toLowerCase())}. Review your draft answers as you go.</p></div>${button('Start AI interview '+icon('arrow-right'),'data-flow-action="continue-preparation"')}`;
    if(passed&&preparation.mode==='attorney')next=`<div class="eagle-flow-summary"><h2>Next, your contact details</h2><p>Tell our legal team how to reach you and who the form is for.</p></div>${button('Continue to my details '+icon('arrow-right'),'data-flow-action="continue-preparation"')}`;
    if(!passed)next=`${review?button('Request a review','data-flow-action="request-review"'):button('Find another form','data-route="home"')}${button('Review my answers','data-flow-action="review-check"','eagle-button secondary')}`;
    return page(`${back('form','Preparation options')}${flowContext()}<div class="eagle-flow-result" role="status"><div class="eagle-result-symbol">${icon(passed?'check':review?'messages-square':'circle-x')}</div><h1 class="eagle-heading">${heading}</h1><p class="eagle-intro">${escape(copy)}</p></div>${next}${passed?button('Review my answers','data-flow-action="review-check"','eagle-text-button'):''}<p class="eagle-footnote">${passed?'This is a preliminary result. Check the full instructions and supporting documents before filing.':review?'Preparation is paused until the applicable requirements are confirmed. This is not a finding that you are ineligible.':'This result applies to the answers you gave. You can correct an answer or explore another form.'}</p>${flowSource()}`);
  }
  function prepareAi() {
    const schema=interviewSchema(),fields=schema.fields,step=preparation.step;
    if(step>=fields.length)return page(`${back('qualification-result','Form check')}${flowContext()}<h1 class="eagle-heading">Your answers,<br>organized.</h1><p class="eagle-intro">Review this first part of your ${escape(state.formId)} draft.</p><dl class="eagle-answer-review">${fields.map((field,index)=>`<div><dt>${escape(field.label)}${button('Edit',`data-edit-draft="${index}" aria-label="Edit ${escape(field.label)}"`,'eagle-text-button')}</dt><dd>${escape(preparation.draft[field.id]||'Not answered')}</dd></div>`).join('')}</dl><div class="eagle-note">${icon('info')}<span>Introductory draft only. A live AI service and complete USCIS PDF generation are not connected in this preview.</span></div>${button('Back to preparation options','data-route="form"','eagle-button secondary')}`);
    const field=fields[step],value=preparation.draft[field.id]||'',previous=step>0?fields[step-1]:null;
    const input=field.type==='textarea'?`<textarea id="eagle-interview-answer" data-draft-field="${field.id}" rows="4" maxlength="1000" ${field.required?'required':''}>${escape(value)}</textarea>`:`<input id="eagle-interview-answer" data-draft-field="${field.id}" type="${escape(field.type)}" value="${escape(value)}" maxlength="200" ${field.type==='date'&&/birth/i.test(field.label)?'max="'+new Date().toISOString().slice(0,10)+'"':''} ${field.required?'required':''}>`;
    return page(`<div class="eagle-subtop">${button(icon('chevron-left')+'Back','data-flow-action="previous-interview"','eagle-text-button')}${button('Review draft','data-flow-action="review-draft"','eagle-text-button')}</div>${flowContext()}${flowProgress(step+1,fields.length,'Getting started')}<div class="eagle-chat-author">FILLOUT AI</div>${previous&&preparation.draft[previous.id]?`<div class="eagle-interview-reply">${escape(preparation.draft[previous.id])}</div>`:''}<h1 class="eagle-flow-question">${escape(field.label)}</h1>${field.help?`<p class="eagle-flow-help">${escape(field.help)}</p>`:''}<label class="eagle-field" for="eagle-interview-answer"><span>Your answer</span>${input}</label><p class="eagle-error" id="eagle-interview-error" role="alert" hidden></p>${button(step===fields.length-1?'Review my answers '+icon('arrow-right'):'Save & continue '+icon('arrow-right'),'data-flow-action="next-interview"')}<p class="eagle-footnote">Interactive interview preview · Use sample details. Answers stay in this tab and are cleared on reload. No live AI or filing.</p>`);
  }
  const intakeFields=[{id:'name',label:'Your full name',type:'text',required:true},{id:'email',label:'Email',type:'email'},{id:'phone',label:'Phone number',type:'tel'},{id:'applicant',label:'Name of the person this form is for',type:'text',required:true},{id:'location',label:'City and country of residence',type:'text',required:true},{id:'notes',label:'Anything you would like us to know? (optional)',type:'textarea'}];
  function attorneyIntake() {
    const price=attorneyData.forms.find(f=>f.id===state.formId)?.servicePriceUsd;
    if(preparation.intakePreview)return page(`${back('qualification-result','Form check')}${flowContext()}<h1 class="eagle-heading">Review your details</h1><p class="eagle-intro">${Number.isFinite(price)?`Attorney preparation fee: ${money(price)}.`:'Our team will confirm the scope and preparation fee.'}</p><dl class="eagle-answer-review">${intakeFields.filter(f=>preparation.intake[f.id]).map(f=>`<div><dt>${escape(f.label)}</dt><dd>${escape(preparation.intake[f.id])}</dd></div>`).join('')}</dl><div class="eagle-note">${icon('info')}<span>Preview only. These details have not been sent to our team.</span></div>${button('Edit my details','data-flow-action="edit-intake"')}`);
    return page(`${back('qualification-result','Form check')}${flowContext()}<h1 class="eagle-heading">Let’s get<br>to know you.</h1><p class="eagle-intro">Share your details so our legal team can help prepare ${escape(state.formId)}.</p><p class="eagle-footnote">${Number.isFinite(price)?`Fixed preparation fee: ${money(price)}. Government fees are separate.`:'We will confirm the scope and quote for your form.'}</p>${intakeFields.map(f=>`<label class="eagle-field"><span>${escape(f.label)}</span>${f.type==='textarea'?`<textarea data-intake-field="${f.id}" rows="3" maxlength="1500">${escape(preparation.intake[f.id]||'')}</textarea>`:`<input data-intake-field="${f.id}" type="${f.type}" value="${escape(preparation.intake[f.id]||'')}" maxlength="200" ${f.required?'required':''}>`}</label>`).join('')}<p class="eagle-footnote">Please enter an email or phone number.</p><p id="eagle-intake-error" class="eagle-error" role="alert" hidden></p>${button('Review my details '+icon('arrow-right'),'data-flow-action="preview-intake"')}<p class="eagle-footnote">Design preview · Use sample details. Nothing is sent or charged.</p>`);
  }
  function showFlowError(id,message,field) {
    const error=view.querySelector(id); error.hidden=false; error.textContent=message;
    if(field){field.setAttribute('aria-invalid','true');field.setAttribute('aria-describedby',id.slice(1));field.focus();}
  }
  function handlePreparationClick(target) {
    if(target.dataset.preparationMode){beginPreparation(target.dataset.preparationMode);return true;}
    const action=target.dataset.flowAction;
    if(target.dataset.checkAnswer) {
      if(state.route!=='qualification'||!preparation)return true;
      const schema=qualificationSchema(),q=schema.questions[preparation.index];
      const changed=preparation.answers[q.id]!==target.dataset.checkAnswer;
      preparation.answers[q.id]=target.dataset.checkAnswer;
      if(changed)for(const later of schema.questions.slice(preparation.index+1))delete preparation.answers[later.id];
      preparation.result={status:'checking'};render();
      view.querySelector(`[data-check-answer="${target.dataset.checkAnswer}"]`)?.focus({preventScroll:true});return true;
    }
    if(target.dataset.editDraft!==undefined) {
      if(canPrepare()&&preparation.mode==='ai') {preparation.step=Number(target.dataset.editDraft);render();}return true;
    }
    if(!action)return false;
    if(!preparation)return true;
    if(action==='previous-check') {
      if(preparation.index>0){preparation.index--;preparation.result={status:'checking'};render();}else navigate('form');
    }
    if(action==='next-check'&&state.route==='qualification') {
      const q=qualificationSchema().questions[preparation.index];if(!['yes','no'].includes(preparation.answers[q.id]))return true;
      const prefix=Object.fromEntries(qualificationSchema().questions.slice(0,preparation.index+1).map(question=>[question.id,preparation.answers[question.id]]));
      const result=evaluateQualification(qualificationSchema(),prefix);
      preparation.result=result;
      if(result.status==='checking'){preparation.index=result.index;navigate('qualification');}else navigate('qualification-result');
    }
    if(action==='uncertain-check') {for(const question of qualificationSchema().questions.slice(preparation.index))delete preparation.answers[question.id];preparation.result={status:'review',index:preparation.index,reason:'You are not sure about a requirement. Our team can help confirm which path applies to you.'};navigate('qualification-result');}
    if(action==='review-check'){preparation.index=0;preparation.result={status:'checking'};navigate('qualification');}
    if(action==='request-review') {
      contactDraft.topic='Choosing a form';contactDraft.message=`Please help me review the requirements for ${state.formId}.`;navigate('contact');
    }
    if(action==='continue-preparation'&&canPrepare())navigate(preparation.mode==='ai'?'prepare-ai':'attorney-intake');
    if(action==='previous-interview'&&canPrepare()) {if(preparation.step>0){preparation.step--;render();}else navigate('qualification-result');}
    if(action==='review-draft'&&canPrepare()) {preparation.step=interviewSchema().fields.length;render();}
    if(action==='next-interview'&&canPrepare()) {
      const field=view.querySelector('#eagle-interview-answer');
      if(!field.value.trim()||!field.validity.valid){showFlowError('#eagle-interview-error',field.type==='date'?'Enter a valid date. A birth date cannot be in the future.':'Please enter a valid answer.',field);return true;}
      preparation.draft[field.dataset.draftField]=field.value.trim();preparation.step++;render();view.querySelector('#eagle-interview-answer')?.focus({preventScroll:true});
    }
    if(action==='preview-intake'&&canPrepare()) {
      const fields=[...view.querySelectorAll('[data-intake-field]')];
      fields.forEach(field=>field.removeAttribute('aria-invalid'));
      const invalid=fields.find(field=>(field.required&&!field.value.trim())||!field.validity.valid);
      if(invalid){showFlowError('#eagle-intake-error','Please enter valid contact details.',invalid);return true;}
      const email=preparation.intake.email?.trim(),phoneValue=preparation.intake.phone?.trim();
      if(!email&&!phoneValue){showFlowError('#eagle-intake-error','Enter an email address or phone number.',fields.find(f=>f.dataset.intakeField==='email'));return true;}
      if(phoneValue&&(!/^[+\d\s().-]+$/.test(phoneValue)||phoneValue.replace(/\D/g,'').length<7||phoneValue.replace(/\D/g,'').length>15)){showFlowError('#eagle-intake-error','Enter a valid phone number.',fields.find(f=>f.dataset.intakeField==='phone'));return true;}
      preparation.intakePreview=true;render();
    }
    if(action==='edit-intake'&&canPrepare()){preparation.intakePreview=false;render();}
    return true;
  }
  root.addEventListener('input',event=>{
    if(!canPrepare())return;
    const field=event.target;
    if(field.dataset.draftField)preparation.draft[field.dataset.draftField]=field.value;
    if(field.dataset.intakeField)preparation.intake[field.dataset.intakeField]=field.value;
  });
