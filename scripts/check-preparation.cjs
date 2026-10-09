const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,'data',name),'utf8'));
const catalog=read('forms-catalog.json').forms;
const schemas=[...read('eligibility-main.json').forms,...read('eligibility-other.json').forms];
const interviews=read('preparation-fields.json').forms;
const context={}; vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'prototype/qualification-engine.js'),'utf8'),context);
const evaluate=context.evaluateQualification;
const sorted=xs=>xs.map(f=>f.id).sort();
assert.deepEqual(sorted(schemas),sorted(catalog),'Every catalog form must have one check');
assert.deepEqual(sorted(interviews),sorted(catalog),'Every catalog form must have one interview');
let branches=0,passable=0;
for(const schema of schemas) {
  assert.match(schema.pdfUrl,/^https:\/\/www\.uscis\.gov\/.*\.pdf$/);
  assert.ok(schema.questions.length>0);
  const answers={};
  for(let i=0;i<schema.questions.length;i++) {
    const q=schema.questions[i];
    assert.ok(q.text&&q.id);
    for(const value of ['yes','no']) {
      assert.ok(['next','stop','review'].includes(q[value]));
      if(q[value]==='stop')assert.ok(q.stopReason||q.reason);
      if(q[value]==='review')assert.ok(q.reviewReason||q.reason);
    }
    const current=evaluate(schema,answers);
    assert.equal(current.status,'checking');assert.equal(current.index,i);
    for(const value of ['yes','no']) {
      const result=evaluate(schema,{...answers,[q.id]:value});branches++;
      const expected=q[value]==='stop'?'stopped':q[value]==='review'?'review':i===schema.questions.length-1?'passed':'checking';
      assert.equal(result.status,expected,`${schema.id} ${q.id} ${value}`);
      if(expected==='stopped'||expected==='review') {
        const future=Object.fromEntries(schema.questions.slice(i+1).map(later=>[later.id,later.yes==='next'?'yes':'no']));
        assert.equal(evaluate(schema,{...answers,...future,[q.id]:value}).status,expected,'Later answers cannot bypass a blocked result');
      }
    }
    const next=['yes','no'].find(value=>q[value]==='next');
    if(!next)break;
    answers[q.id]=next;
  }
  if(evaluate(schema,answers).status==='passed')passable++;
  const fieldIds=interviews.find(f=>f.id===schema.id).fields.map(f=>f.id);
  assert.equal(new Set(fieldIds).size,fieldIds.length);
}
assert.equal(evaluate(undefined,{}).status,'review');
const source=fs.readFileSync(path.join(root,'preview/immigration-eagle.html'),'utf8');
const scripts=[...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
for(const script of scripts)new vm.Script(script[1]);
assert.ok(!/__(?:PREPARATION|ELIGIBILITY|QUALIFICATION)_/.test(source));
assert.equal((source.match(/data-preparation-mode=/g)||[]).length,3);
assert.ok(source.includes('data-official-pdf'));
console.log(`PASS: ${schemas.length} forms, ${branches} yes/no branches, ${passable} paths permitting preparation; generated JavaScript parses.`);
