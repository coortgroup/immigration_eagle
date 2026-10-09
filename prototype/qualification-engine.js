  // Preliminary form applicability only; never a USCIS adjudication.
  function evaluateQualification(schema, answers) {
    if(!schema?.questions?.length)return {status:'review',index:0,reason:'A specialist needs to review the requirements for this form.'};
    for(let index=0;index<schema.questions.length;index++) {
      const question=schema.questions[index], answer=answers[question.id];
      if(!['yes','no'].includes(answer))return {status:'checking',index};
      const outcome=question[answer];
      if(outcome==='stop')return {status:'stopped',index,reason:question.stopReason||question.reason||'Your answer does not match the purpose of this form.'};
      if(outcome==='review')return {status:'review',index,reason:question.reviewReason||question.reason||'Your situation needs an individual review before you continue.'};
      if(outcome!=='next')return {status:'review',index,reason:'We need to confirm the requirements before you continue.'};
    }
    return {status:'passed',index:schema.questions.length};
  }
