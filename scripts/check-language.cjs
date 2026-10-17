const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const { translate, russian, localizeData, LANGUAGE_KEY } = require('./language-test-helper.cjs');
assert.equal(translate('en', 'Question {current} of {total}', {current: 2, total: 6}), 'Question 2 of 6');
assert.equal(translate('ru', 'Question {current} of {total}', {current: 2, total: 6}), 'Вопрос 2 из 6');
assert.equal(translate('ru', 'Question 2 of 6'), 'Вопрос 2 из 6');
assert.equal(translate('ru', 'Continue application I-90'), 'Продолжить заполнение I-90');
assert.equal(translate('ru', 'constructor'), 'constructor');
assert.equal(translate('ru', undefined), '');
assert.equal(translate('ru', 'Sample Applicant'), 'Sample Applicant');
for (const [source, target] of Object.entries(russian)) {
  assert.equal(typeof target, 'string'); assert.ok(target.trim(), `Empty translation: ${source}`);
  const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(item=>item[1]).sort();
  assert.deepEqual(placeholders(target), placeholders(source), `Translation parameters: ${source}`);
}
const sample = {title:'My Application',fields:[{id:'Yes',label:'Yes',value:'Yes',when:{field:'Yes',equals:'Yes'}}],answers:{name:'My Application'}};
const localized = localizeData(sample,'ru');
assert.equal(localized.title,'Мои заявления');
assert.equal(localized.fields[0].label,'Да');
assert.equal(localized.fields[0].id,'Yes');
assert.equal(localized.fields[0].value,'Yes');
assert.equal(JSON.stringify(localized.fields[0].when),JSON.stringify(sample.fields[0].when));
assert.equal(sample.title,'My Application','Localization must not mutate the source data');

const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
// A real hook host exercises async hydration and rapid language changes without remounting children.
function host({stored='ru', delayedRead=false, query=''}={}) {
  const slots=[]; let cursor=0, effects=[], releaseRead; let value=stored; const written=[];
  const React={
    createContext: initial => ({ Provider:'Provider',initial }),
    createElement:(type,props,...children)=>({type,props:{...props,children}}),
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},
    useRef(initial){const i=cursor++;return slots[i]||(slots[i]={current:initial});},
    useCallback(fn){cursor++;return fn;}, useMemo(fn){cursor++;return fn();},
    useEffect(fn,deps){const i=cursor++,prev=slots[i];if(prev&&deps&&deps.every((x,j)=>Object.is(x,prev.deps[j])))return;effects.push(()=>{prev?.cleanup?.();slots[i]={deps,cleanup:fn()};});},
  };
  const storage={getItem:()=>delayedRead?new Promise(resolve=>{releaseRead=resolve;}):Promise.resolve(value),setItem:async(k,v)=>{assert.equal(k,LANGUAGE_KEY);value=v;written.push(v);}};
  const moduleRef={exports:{}};const doc={documentElement:{lang:'en'}};
  const win={location:{search:query,href:'http://localhost/app/'+query},history:{replaceState(a,b,url){win.location.href=url;win.location.search=new URL(url).search;}}};
  vm.runInNewContext(compile('src/LanguageContext.tsx'),{module:moduleRef,exports:moduleRef.exports,URL,URLSearchParams,window:win,document:doc,require(name){
    if(name==='react')return {...React,default:React,__esModule:true};
    if(name==='react-native')return {Platform:{OS:'web'}};
    if(name==='@react-native-async-storage/async-storage')return storage;
    if(name==='./i18n')return require('./language-test-helper.cjs');
    throw Error(name);
  }});
  const child={type:'ExistingForm',answers:{name:'Sample Applicant'}};
  return {render(){cursor=0;effects=[];const tree=moduleRef.exports.LanguageProvider({children:child});effects.forEach(run=>run());return tree;},written,doc,win,child,release(){releaseRead(stored);}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 const h=host();h.render();await settle();let tree=h.render();assert.equal(tree.props.value.language,'ru');
 assert.equal(tree.props.children[0],h.child,'Language hydration must preserve mounted form identity');
 tree.props.value.setLanguage('en');tree=h.render();assert.equal(tree.props.value.language,'en');assert.equal(tree.props.children[0],h.child);await settle();assert.equal(h.written.at(-1),'en');
 tree.props.value.setLanguage('ru');tree.props.value.setLanguage('en');await settle();assert.equal(h.written.at(-1),'en','Rapid choices persist in order');
 const racing=host({delayedRead:true});tree=racing.render();tree.props.value.setLanguage('en');racing.release();await settle();assert.equal(racing.render().props.value.language,'en','Late stored locale must not overwrite a user selection');
 const deepLink=host({stored:'en',query:'?form=N-400&lang=ru'});deepLink.render();await settle();tree=deepLink.render();assert.equal(tree.props.value.language,'ru');assert.equal(deepLink.written.at(-1),'ru');
 tree.props.value.setLanguage('en');await settle();assert.match(deepLink.win.location.search,/lang=en/);assert.match(deepLink.win.location.search,/form=N-400/);
 const config=fs.readFileSync('app.config.ts','utf8');assert.match(config,/name: 'FillOut'/);assert.match(config,/CFBundleDisplayName: 'FillOut'/);
 console.log(`Language checks passed: ${Object.keys(russian).length} translations, template parameters, immutable rules/values, saved preference, late hydration, rapid changes and query handoff.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
