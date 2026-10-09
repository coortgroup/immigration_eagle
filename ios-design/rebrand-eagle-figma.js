// Run with use_figma against D37t2aLjzF26fAkggMAZB5.
// Requires the original supplied JPEG on Brand / Eagle logo (7:79).
const board = await figma.getNodeByIdAsync('3:24');
const assets = await figma.getNodeByIdAsync('3:25');
const logo = await figma.getNodeByIdAsync('7:79');
const ids = {home:'4:588',application:'4:648',question:'4:742',documents:'4:801',ai:'4:866',native:'4:930'};
const screens = {};
for(const [k,id] of Object.entries(ids)) screens[k] = await figma.getNodeByIdAsync(id);
const textNodes = [...board.findAllWithCriteria({types:['TEXT']}), ...assets.findAllWithCriteria({types:['TEXT']})];
const fontMap = new Map();
for(const n of textNodes) for(const seg of n.getStyledTextSegments(['fontName'])) fontMap.set(JSON.stringify(seg.fontName),seg.fontName);
await Promise.all([...fontMap.values()].map(f=>figma.loadFontAsync(f)));
const fonts = {regular:{family:'Inter',style:'Regular'},medium:{family:'Inter',style:'Medium'},semi:{family:'Inter',style:'Semi Bold'},bold:{family:'Inter',style:'Bold'},serif:{family:'DM Serif Display',style:'Regular'}};
await Promise.all(Object.values(fonts).map(f=>figma.loadFontAsync(f)));
const vars = {};
const varIds = {bg:'VariableID:3:4',card:'VariableID:3:6',ink:'VariableID:3:8',muted:'VariableID:3:10',line:'VariableID:3:12',navy:'VariableID:3:14',soft:'VariableID:3:16',gold:'VariableID:3:18',space:'VariableID:3:21',radius:'VariableID:3:22',smallRadius:'VariableID:3:23'};
await Promise.all(Object.entries(varIds).map(async([k,id])=>{vars[k]=await figma.variables.getVariableByIdAsync(id)}));
const made = [], changed = new Set(), removed = [], links = [];
function mark(n){changed.add(n.id);return n;}
function reg(n){made.push(n.id);return n;}
function paint(k){return figma.variables.setBoundVariableForPaint({type:'SOLID',color:{r:0,g:0,b:0}},'color',vars[k]);}
function fill(n,k){n.fills=k?[paint(k)]:[];}
fill(board,'bg');mark(board);
function layout(parent,name,dir='VERTICAL',gap=0,w=342,bg=null,pad=0,radius=0){
  const n=reg(figma.createAutoLayout(dir));parent.appendChild(n);n.name=name;n.itemSpacing=gap;n.resize(w,10);n.layoutSizingHorizontal='FIXED';n.layoutSizingVertical='HUG';n.counterAxisAlignItems=dir==='HORIZONTAL'?'CENTER':'MIN';fill(n,bg);
  n.paddingTop=n.paddingBottom=n.paddingLeft=n.paddingRight=pad;
  if(pad===16)for(const p of ['paddingTop','paddingBottom','paddingLeft','paddingRight'])n.setBoundVariable(p,vars.space);
  if(radius)n.setBoundVariable('cornerRadius',vars[radius===20?'radius':'smallRadius']);
  return n;
}
function text(parent,value,size=14,color='ink',weight='regular',width=null){
  const n=reg(figma.createText());n.fontName=fonts[weight];n.fontSize=size;n.lineHeight={unit:'PIXELS',value:Math.ceil(size*(weight==='serif'?1.13:1.35))};n.characters=value;n.name=value.slice(0,60);fill(n,color);parent.appendChild(n);
  n.textAutoResize=width===null?'WIDTH_AND_HEIGHT':'HEIGHT';if(width!==null)n.resize(width,Math.max(1,n.height));return n;
}
function spacer(p,h){const n=layout(p,'Spacing','VERTICAL',0,1);n.resize(1,h);n.layoutSizingVertical='FIXED';return n;}
function logoInstance(p,size){const n=reg(logo.createInstance());p.appendChild(n);n.resize(size,size);n.cornerRadius=Math.round(size*.24);n.name='Eagle / original brand artwork';return n;}
function brand(p){const r=layout(p,'Immigration Eagle / brand and account','HORIZONTAL',10,342);logoInstance(r,40);const copy=layout(r,'Wordmark','VERTICAL',0,251);text(copy,'IMMIGRATION',9,'muted','semi');text(copy,'Eagle',21,'ink','bold');const a=layout(r,'Sample account','HORIZONTAL',0,31,'soft');a.resize(31,31);a.layoutSizingVertical='FIXED';a.cornerRadius=16;a.primaryAxisAlignItems='CENTER';text(a,'AR',10,'navy','semi');return r;}
const navyButton = await figma.getNodeByIdAsync('4:547');
const goldButton = await figma.getNodeByIdAsync('4:551');
navyButton.name='Button / Navy';goldButton.name='Button / Gold';mark(navyButton);mark(goldButton);
navyButton.description=goldButton.description='Immigration Eagle primary action. Shared token-bound button with editable Label property.';
function button(p,label,route,gold=false,w=342,height=50){const template=gold?goldButton:navyButton;const n=reg(template.createInstance());p.appendChild(n);const key=Object.keys(n.componentProperties).find(k=>k.startsWith('Label#'));n.setProperties({[key]:label});n.resize(w,height);n.name=label;if(route)links.push([n,route]);return n;}
function clear(p,keep=[]){for(const n of [...p.children])if(!keep.includes(n.id)){removed.push(n.id);n.remove();}mark(p);}
function content(s){return s.children.find(n=>n.name==='App content');}
function allIds(n){return [n.id,...n.findAll(()=>true).map(c=>c.id)];}
const homeContent=content(screens.home),appContent=content(screens.application),aiContent=content(screens.ai),nativeContent=content(screens.native);
const continueCard=await figma.getNodeByIdAsync('4:619');
const checklist=await figma.getNodeByIdAsync('4:688');
if(!continueCard||!checklist)throw new Error('Expected original nodes missing; inspect before rerunning.');
// Move the existing card, keeping its semantic contents and button instance.
appContent.appendChild(continueCard);allIds(continueCard).forEach(id=>changed.add(id));
clear(homeContent);clear(appContent,[continueCard.id,checklist.id]);clear(aiContent);clear(nativeContent);
function home(p,native=false){
  brand(p);spacer(p,14);
  const hero=layout(p,'Home / immigration preparation hero','VERTICAL',0,342,'navy',20,20);
  text(hero,'Your next chapter\nstarts here.',30,'card',native?'bold':'serif',302);spacer(hero,9);
  text(hero,'Prepare your forms with simple,\nstep-by-step guidance.',13,'card','regular',302);spacer(hero,14);
  button(hero,'Explore services','application',true,302,46);
  spacer(p,18);text(p,'Popular services',17,'ink','semi',342);spacer(p,10);
  const list=layout(p,'Home / popular paths','VERTICAL',6,342);
  for(const [title,sub] of [['Green card','Form I-485'],['U.S. citizenship','Form N-400'],['Family petition','Form I-130'],['Fiancé visa','Form I-129F']]){
    const row=layout(list,'Path / '+title,'HORIZONTAL',8,342,'card',10,12);row.resize(342,43);row.layoutSizingVertical='FIXED';
    const copy=layout(row,'Path details','HORIZONTAL',7,292);text(copy,title,12,'ink','semi');text(copy,sub,10,'muted');text(row,'›',20,'navy','medium');links.push([row,'application']);
  }
  spacer(p,16);text(p,'How it works',16,'ink','semi',342);spacer(p,8);
  const steps=layout(p,'Home / three preparation steps','HORIZONTAL',8,342);
  for(const [number,title] of [['01','Choose a path'],['02','Answer questions'],['03','Review & prepare']]){
    const s=layout(steps,'Step '+number,'VERTICAL',3,108);text(s,number,11,'muted','semi');text(s,title,10,'ink','medium',108);
  }
}
home(homeContent);home(nativeContent,true);
// My application owns the continued work card.
const heading=text(appContent,'My application',30,'ink','serif',342);appContent.insertChild(0,heading);const gap=spacer(appContent,14);appContent.insertChild(1,gap);
continueCard.name='My application / Continue application';continueCard.paddingTop=continueCard.paddingBottom=continueCard.paddingLeft=continueCard.paddingRight=16;continueCard.itemSpacing=8;continueCard.setBoundVariable('cornerRadius',vars.radius);
for(const n of continueCard.children){if(n.type==='FRAME')n.resize(310,n.height);if(n.type==='TEXT'){n.resize(310,n.height);n.fontSize=25;n.lineHeight={unit:'PIXELS',value:29};}if(n.type==='INSTANCE'){n.resize(310,44);links.push([n,'question']);}}
const cardLabel=continueCard.findOne(n=>n.type==='TEXT'&&n.characters==='YOUR NEXT CHAPTER');if(cardLabel){cardLabel.characters='IN PROGRESS';cardLabel.name='IN PROGRESS';}
const cardTrack=continueCard.findOne(n=>n.name==='Preparation progress');if(cardTrack){fill(cardTrack,'muted');if(cardTrack.children[0])cardTrack.children[0].resize(102,5);}
appContent.appendChild(continueCard);spacer(appContent,18);text(appContent,'Preparation checklist',14,'ink','semi');spacer(appContent,8);appContent.appendChild(checklist);
checklist.name='My application / preparation checklist';checklist.layoutSizingVertical='HUG';mark(checklist);
for(const row of checklist.children){row.resize(342,39);allIds(row).forEach(id=>changed.add(id));links.push([row,'question']);}
spacer(appContent,16);const docs=layout(appContent,'My application / documents','HORIZONTAL',10,342,'card',12,12);text(docs,'Your documents',12,'ink','semi');text(docs,'2 sample files',10,'muted');text(docs,'View  →',11,'navy','semi');links.push([docs,'documents']);
// Eagle AI is an honest demonstration of the assistant surface.
brand(aiContent);spacer(aiContent,20);
const intro=layout(aiContent,'Eagle AI / introduction','VERTICAL',9,342,'navy',20,20);
const aiTitle=layout(intro,'Assistant name','HORIZONTAL',10,302);logoInstance(aiTitle,38);text(aiTitle,'Eagle AI',28,'card','serif');
text(intro,'A little clarity for your next step.',14,'card','medium',302);
text(intro,'Ask about the app, your workspace, or preparing your information.',12,'card','regular',302);
spacer(aiContent,18);text(aiContent,'How can I help?',19,'ink','semi');spacer(aiContent,12);
const prompts=layout(aiContent,'Eagle AI / suggested questions','VERTICAL',9,342);
for(const [title,detail,route] of [['Where do I continue?','Find your saved application','application'],['Where are my documents?','Open your document workspace','documents'],['How does preparation work?','Explore the steps on Home','home']]){
  const row=layout(prompts,title,'HORIZONTAL',10,342,'card',14,12);const cp=layout(row,'Prompt text','VERTICAL',4,280);text(cp,title,13,'ink','semi',280);text(cp,detail,11,'muted','regular',280);text(row,'›',21,'navy');links.push([row,route]);
}
spacer(aiContent,18);const input=layout(aiContent,'Eagle AI / prototype input','HORIZONTAL',8,342,'soft',14,12);text(input,'Ask Eagle AI…',13,'muted','regular',278);text(input,'↑',21,'navy','bold');spacer(aiContent,10);
text(aiContent,'Prototype preview · Live AI is not connected.',10,'muted','regular',342);
// Apply names, brand consistency, and original eagle thumbnails to every tab bar.
const labels={home:'Home',application:'My application',question:'Questions',documents:'Documents',ai:'Eagle AI',native:'Home / native alternative'};
for(const [key,s]of Object.entries(screens)){
  s.name='iPhone / Immigration Eagle / '+labels[key];mark(s);
  s.parent.name='IMMIGRATION EAGLE / '+labels[key];mark(s.parent);
  for(const label of s.parent.children.filter(n=>n.type==='TEXT')){label.characters='IMMIGRATION EAGLE / '+labels[key];label.name=label.characters;mark(label);}
  const tabs=s.findOne(n=>n.name==='Navigation items');
  if(tabs){for(const tab of tabs.children){const textNode=tab.children.find(n=>n.type==='TEXT');if(!textNode)continue;const route=textNode.characters==='Home'?'home':textNode.characters==='My application'?'application':'ai';if(route==='ai'){tab.name='Tab / Eagle AI';mark(tab);textNode.characters='Eagle AI';textNode.name='Eagle AI';mark(textNode);for(const c of [...tab.children])if(c.type!=='TEXT'){removed.push(c.id);c.remove();}const eagle=logoInstance(tab,22);tab.insertChild(0,eagle);}links.push([tab,route]);}}
}
for(const n of board.findAllWithCriteria({types:['TEXT']})){if(n.characters.includes('CitizenPath')){n.characters=n.characters.replaceAll('CitizenPath','Immigration Eagle');mark(n);}}
const introBlock=board.children.find(n=>n.name==='Design review introduction');if(introBlock){const ts=introBlock.children.filter(n=>n.type==='TEXT');const values=['Immigration Eagle, designed for iPhone.','Home → My application → Questions → Documents → Eagle AI','Editable design concept · Sample application data · Original eagle branding · AI preview'];for(let i=0;i<Math.min(ts.length,values.length);i++){ts[i].characters=values[i];ts[i].name=values[i];mark(ts[i]);}}
const rows=board.children.filter(n=>n.type==='FRAME'&&n!==introBlock);if(rows[0]){rows[0].name='Immigration Eagle / primary journey';mark(rows[0]);}if(rows[1]){rows[1].name='Documents, Eagle AI, and native home';mark(rows[1]);}
const overflow=Object.entries(screens).map(([key,s])=>{const c=content(s);return {screen:key,contentId:c.id,available:c.height-c.paddingBottom,lastChildBottom:Math.max(...c.children.map(n=>n.y+n.height))};});
return {createdNodeIds:made,mutatedNodeIds:[...changed],removedNodeIds:removed,screenIds:ids,logoNodeId:logo.id,linkTargets:links.map(([n,target])=>({nodeId:n.id,targetNodeId:ids[target]})),overflow,fonts:[...new Set(board.findAllWithCriteria({types:['TEXT']}).map(n=>n.fontName.family))],editableTextCount:board.findAllWithCriteria({types:['TEXT']}).length};
