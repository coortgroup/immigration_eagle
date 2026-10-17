#!/usr/bin/env node
// Exercise the actual My Application rendering and actions without a native runtime.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const source = ts.transpileModule(fs.readFileSync('src/screens/ApplicationScreen.tsx', 'utf8'), {
  compilerOptions: { module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022, jsx:ts.JsxEmit.React, esModuleInterop:true },
}).outputText;
function host(drafts) {
  const slots = [];
  let index = 0;
  const resumed = [];
  const removed = [];
  const React = {
    createElement(type, props, ...children) {
      const next = {...props,children};
      return typeof type === 'function' ? type(next) : {type,props:next};
    },
    useState(initial) {
      const position = index++;
      if (!(position in slots)) slots[position] = initial;
      return [slots[position],value => { slots[position] = value; }];
    },
  };
  const moduleRef = {exports:{}};
  vm.runInNewContext(source, {
    module:moduleRef, exports:moduleRef.exports,
    require(name) {
      if (name.endsWith('/LanguageContext')) return require('./language-test-helper.cjs');
      if (name.endsWith('/i18n')) return require('./language-test-helper.cjs');
      if (name.endsWith('/LanguageSwitcher')) return { LanguageSwitcher: 'LanguageSwitcher' };
      if (name === 'react') return {...React,default:React,__esModule:true};
      if (name === 'react-native') return {Pressable:'Pressable',ScrollView:'ScrollView',Text:'Text',View:'View',StyleSheet:{create:value=>value}};
      if (name.includes('Ionicons')) return {default:'Ionicons',__esModule:true};
      if (name.endsWith('forms-catalog.json')) return JSON.parse(fs.readFileSync('data/forms-catalog.json','utf8'));
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return {
    resumed,removed,
    render() {
      index = 0;
      return moduleRef.exports.ApplicationScreen({drafts,onSelectForm(){},onRetry(){},onResume:id=>resumed.push(id),onRemove:async id=>{removed.push(id);}});
    },
  };
}
function findAll(node,predicate,result=[]) {
  if (!node || typeof node !== 'object') return result;
  if (Array.isArray(node)) { node.forEach(child=>findAll(child,predicate,result)); return result; }
  if (predicate(node)) result.push(node);
  findAll(node.props?.children,predicate,result);
  return result;
}
const content = node => typeof node === 'string' || typeof node === 'number' ? String(node)
  : Array.isArray(node) ? node.map(content).join('') : content(node?.props?.children || []);
const action = (tree,label) => findAll(tree,node=>node.type==='Pressable' && node.props.accessibilityLabel===label)[0];
const draft = (formId,extras={}) => ({formId,title:'Sample form',answered:1,total:8,updatedAt:'2026-10-09T12:00:00.000Z',...extras});

(async()=>{
  for (const [status,current] of [[undefined,0],['awaiting_call',0],['preparing_documents',1],['sent',2]]) {
    const harness = host([draft('I-130',{mode:'attorney',attorneyStatus:status})]);
    const tree = harness.render();
    assert.equal(action(tree,'Continue application I-130'),undefined,'Attorney drafts cannot open a preparation flow');
    assert.ok(action(tree,'Remove draft I-130'),'Attorney drafts retain a separate removal action');
    assert.ok(action(tree,'Continue request I-130'),'Attorney contact drafts can resume for editing');
    assert.ok(!content(tree).includes('Preparing document package'),'A referral does not invent a legal-service workflow');
    action(tree,'Continue request I-130').props.onPress();
    assert.deepEqual(harness.resumed,['I-130']);
  }
  const harness = host([draft('N-400'),draft('I-130',{mode:'attorney'})]);
  let tree = harness.render();
  action(tree,'Continue application N-400').props.onPress();
  assert.deepEqual(harness.resumed,['N-400'],'Legacy/self drafts still resume the selected form');
  action(tree,'Remove draft I-130').props.onPress();
  tree = harness.render();
  assert.match(content(tree),/Remove the saved I-130 draft/);
  const confirm = findAll(tree,node=>node.type==='Pressable' && content(node)==='Remove draft')[0];
  assert.ok(confirm);
  confirm.props.onPress();
  await Promise.resolve();
  assert.deepEqual(harness.removed,['I-130']);
  assert.match(content(tree),/saved automatically.*first answer/);
  console.log('My Application: free attorney request resume, no invented representation status, separate removal and legacy resume passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
