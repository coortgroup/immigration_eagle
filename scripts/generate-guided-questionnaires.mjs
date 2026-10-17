#!/usr/bin/env node
/** Generate source-backed, field-by-field guided forms from the PINNED local PDFs.
 * This is input coverage, not an eligibility or filing-readiness claim. Re-run
 * after reviewing a template edition; no live government fetch occurs here.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/uscis-form-inventory.json')));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/uscis-print-templates.json')));
const moduleValue = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(ROOT, 'src/freePdfEngine.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: moduleValue, exports: moduleValue.exports, require, Uint8Array, ArrayBuffer, console });
const { prepareFreePdf } = moduleValue.exports;
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const slug = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
const short = field => field.name.split('.').at(-1);
const base = field => short(field).replace(/\[\d+\]$/, '');
const order = (a, b) => a.page - b.page || b.rect[1] - a.rect[1] || a.rect[0] - b.rect[0];
const forms = {};
const audit = { staleHeadings: [], ungroupedCheckboxes: [], groups: [] };
const titles = {
  'AR-11': "Alien's Change of Address Card", 'G-1145': 'E-Notification of Application/Petition Acceptance', 'G-639': 'Freedom of Information/Privacy Act Request',
  'I-90': 'Application to Replace Permanent Resident Card', 'I-129F': 'Petition for Alien Fiancé(e)', 'I-130': 'Petition for Alien Relative',
  'I-130A': 'Supplemental Information for Spouse Beneficiary', 'I-131': 'Application for Travel Documents, Parole Documents, and Arrival/Departure Records',
  'I-131A': 'Application for Carrier Documentation', 'I-134': 'Declaration of Financial Support', 'I-485': 'Application to Register Permanent Residence or Adjust Status',
  'I-751': 'Petition to Remove Conditions on Residence', 'I-765': 'Application for Employment Authorization', 'I-765WS': 'Form I-765 Worksheet',
  'I-821': 'Application for Temporary Protected Status', 'I-821D': 'Consideration of Deferred Action for Childhood Arrivals',
  'I-864': 'Affidavit of Support Under Section 213A of the INA', 'I-864A': 'Contract Between Sponsor and Household Member',
  'N-400': 'Application for Naturalization', 'N-565': 'Application for Replacement Naturalization/Citizenship Document', 'N-600': 'Application for Certificate of Citizenship',
};

// Corrections are transcribed from visible text in these pinned PDF editions.
// Official AcroForm tooltips sometimes retain wording from older editions.
const labelOverrides = {
  'N-400': {
    P10_Line1_Citizen: 'Part 10. Request for a Fee Reduction. 1. My household income is less than or equal to 400% of the Federal Poverty Guidelines (see Instructions for required documentation).',
    P10_Line2_TotalHouseholdIn: 'Part 10. Request for a Fee Reduction. 2. Total household income.',
    P10_Line3_HouseHoldSize: 'Part 10. Request for a Fee Reduction. 3. My household size is:',
    P11_Line1_TotalChildren: 'Part 10. Request for a Fee Reduction. 4. Total number of household members earning income including yourself:',
    P10_Line5a: 'Part 10. Request for a Fee Reduction. 5.a. I am the head of household.',
    P10_Line5b_NameOfHousehold: 'Part 10. Request for a Fee Reduction. 5.b. Name of head of household (if you selected “No” in Item Number 5.a.).',
    P11_Line26d: 'Part 9. Additional Information About You. 26.d. If you answered “No” to Item Number 26.a., are you a former U.S. military service member who is currently residing outside of the U.S.?',
    P9_NobilityTitles: 'Part 9. Additional Information About You. 30.b. List titles or orders of nobility you are willing to give up at your naturalization ceremony.',
    P12_Line34: 'Part 9. Additional Information About You. 34. Are you willing to take the full Oath of Allegiance to the United States?',
  },
  'I-485': {
    Pt2Line11_CB: 'Part 1. Information About You. 11. When I last arrived in the United States:',
    Pt1Line11_Admitted: 'Part 1. Information About You. 11. I was inspected at a Port of Entry and admitted as (for example, exchange visitor, visitor, temporary worker, student).',
    Pt1Line11_Paroled: 'Part 1. Information About You. 11. I was inspected at a Port of Entry and paroled as (for example, humanitarian parole, Cuban parole).',
    Pt1Line11_Other: 'Part 1. Information About You. 11. Other (explain).',
    Pt9Line57_HouseholdSize: 'Part 9. General Eligibility and Inadmissibility Grounds. Public Charge. 57. Describe your family status (for example, your household size).',
  },
  'I-864A': {
    P5_SponsorName: "Part 5. Sponsor's Promise, Statement, Contact Information, Declaration, Certification, and Signature. I, THE SPONSOR (name).",
    P5_IntendingMigrants: "Part 5. Sponsor's Promise, Statement, Contact Information, Declaration, Certification, and Signature. Number of intending immigrants included in this contract.",
  },
};
const travelChoices = {
  '1': '1. Reentry permit - I am a lawful permanent resident or conditional permanent resident of the United States.',
  '2': '2. Refugee Travel Document - I now hold refugee or asylee status in the United States.',
  '3': '3. Refugee Travel Document - I am a lawful permanent resident as a direct result of refugee or asylee status.',
  '4': '4. TPS Travel Authorization Document - I am a TPS beneficiary in the United States.',
  '5': '5.A. Advance parole from inside the United States - pending Form I-485.',
  '6': '5.B. Advance parole from inside the United States - pending Form I-589.',
  '7': '5.C. Advance parole from inside the United States - pending initial Form I-821.',
  '8': '5.D. Advance parole from inside the United States - Deferred Enforced Departure.',
  '9': '5.E. Advance parole from inside the United States - approved Form I-821D.',
  '10': '5.F. Advance parole from inside the United States - approved Form I-914 or Form I-914, Supplement A.',
  '11': '5.G. Advance parole from inside the United States - approved Form I-918 or Form I-918, Supplement A.',
  '12': '5.H. Advance parole from inside the United States - current parolee under INA section 212(d)(5).',
  '13': '5.I. Advance parole from inside the United States - approved Form I-817.',
  '14': '5.J. Advance parole from inside the United States - pending Form I-687.',
  '15': '5.K. Advance parole from inside the United States - approved V Nonimmigrant Status.',
  '16': '5.L. Advance permission to travel - CNMI long-term residence.',
  '17': '5.M. Advance parole from inside the United States - other (explain).',
  '18': '6.A. Initial parole from outside the United States - Filipino World War II Veterans Parole (FWVP) Program.',
  '19': '6.B. Initial parole from outside the United States - Immigrant Military Members and Veterans Initiative (IMMVI).',
  '20': '6.C. Initial parole from outside the United States - Intergovernmental Parole Referral.',
  '21': '6.D. Initial parole from outside the United States - Family Reunification Task Force (FRTF) Process.',
  '22': '6.E. Initial parole from outside the United States - other specific program or process (list).',
  '23': '7. Initial parole from outside the United States - not under a specific parole program or process.',
  '24': '8.A. Initial parole in place from inside the United States - Military Parole in Place (PIP), only on my own behalf.',
  '25': '8.B. Initial parole in place from inside the United States - Family Reunification Task Force (FRTF) Process.',
  '26': '8.C. Initial parole in place from inside the United States - other specific program or process (list).',
  '27': '9. Initial parole in place from inside the United States - not under a specific program or process.',
  '28': '10.A. New period of parole (re-parole) - Family Reunification Parole Process.',
  '29': '10.B. New period of parole (re-parole) - certain Afghans paroled after July 31, 2021 (see form Instructions).',
  '30': '10.C. New period of parole (re-parole) - certain Ukrainian citizens and immediate family members paroled on or after February 11, 2022 (see form Instructions).',
  '31': '10.D. New period of parole (re-parole) - Filipino World War II Veterans Parole (FWVP) Program.',
  '32': '10.E. New period of parole (re-parole) - Immigrant Military Members and Veterans Initiative (IMMVI).',
  '33': '10.F. New period of parole (re-parole) - Central American Minors (CAM) Program.',
  '34': '10.G. New period of parole (re-parole) - Family Reunification Task Force (FRTF) Process.',
  '35': '10.H. New period of parole (re-parole) - Military Parole in Place (Military PIP).',
  '36': '10.I. New period of parole (re-parole) - other specific program or process (list).',
  '37': '11. New period of parole (re-parole) - not under a specific program or process.',
};
function correctedLabel(id, field) {
  let label=clean(field.label);
  const override=labelOverrides[id]?.[base(field)];
  if(override && !(id==='N-400' && base(field)==='P11_Line1_TotalChildren' && field.page!==11)) {
    const state=clean(field.exportStates?.[0]);
    label=override+(field.type==='/Btn' && ['Y','N'].includes(state)?` Select ${state==='Y'?'Yes':'No'}.`:'');
    if(id==='I-485' && base(field)==='Pt2Line11_CB') {
      const captions={ '11A':'I was inspected at a Port of Entry and admitted as (for example, exchange visitor, visitor, temporary worker, student).', '11B':'I was inspected at a Port of Entry and paroled as (for example, humanitarian parole, Cuban parole).', '11C':'I came into the United States without admission or parole.', '11D':'Other (explain).'};
      label += ` Select ${captions[state]}`;
    }
  }
  if(id==='N-400') {
    const roles=[[/Biographic Information/i,3],[/Information About Your Residence/i,4],[/Information About Your Marital History/i,5],[/Information About Your Children/i,6],[/Information About Your Employment/i,7],[/Time Outside the United States/i,8],[/Additional Information About You/i,9],[/Applicant's Contact Information/i,11],[/Interpreter's Contact Information/i,12],[/Person Preparing This Application/i,13]];
    for(const[re,part]of roles)if(re.test(label)){label=label.replace(/^Part\s*\d+[.]/,`Part ${part}.`);break;}
    if(base(field)==='P10_Line1_MaritalStatus' && clean(field.exportStates?.[0])==='S')label=label.replace(/go to Part 14\. Additional Information\.?/i,'go to Part 6. Information About Your Children.');
  }
  if(id==='I-131' && base(field)==='Part2_Line12_ClassofAdmission')label=label.replace(/^Part 1\./,'Part 2.');
  if(id==='I-131' && base(field)==='P2_Line24_Unit')label=label.replace(/^Part 1\. Petitioner Information\. 3\. Mailing /,'');
  if(id==='I-131A' && /Interpreter's/.test(label))label=label.replace(/^Part\s*\d+[.]/,'Part 5.');
  // A reference to Part 7 within processing directions is not the field's own part.
  if(id==='I-131A' && /^Part\s*\d+\. Additional Information/.test(label))label=label.replace(/^Part\s*\d+[.]/,'Part 7.');
  if(id==='I-131A' && /^(?:P3_Line|Pt3_)/.test(base(field)))label=label.replace(/^Part\s*\d+[.]/,'Part 3.');
  if(id==='I-131A' && /Person Preparing this Application/i.test(label))label=label.replace(/^Part\s*\d+[.]/,'Part 6.');
  if(id==='I-134' && /^Part 2\. Information about the Beneficiary/i.test(label))label=label.replace(/^Part 2\./,'Part 3.');
  if(id==='I-134' && field.page===2 && base(field)==='Part2_Item11_PostalCode')label='Part 2. Information About the Individual Agreeing to Financially Support the Beneficiary. 5. Current Physical Address. Enter the Postal Code.';
  if(id==='I-485' && /^Part 5\. Information About Your Marital History/.test(label))label=label.replace(/^Part 5\./,'Part 6.');
  if(id==='I-485' && /^Part 8\. Additional Information/.test(label))label=label.replace(/^Part 8\./,'Part 14.');
  if(id==='I-485' && base(field)==='Pt9Line56_CB' && clean(field.exportStates?.[0])==='1')label='Part 9. General Eligibility and Inadmissibility Grounds. Public Charge. 56. Select Refugee (Form I-590 or Form I-730).';
  if(id==='I-485' && base(field)==='Pt9Line56_CB' && clean(field.exportStates?.[0])==='23')label='Part 9. General Eligibility and Inadmissibility Grounds. Public Charge. 56. Select I do not fall under any of the exempt categories listed above and will complete Item Numbers 57. - 64. If you selected an exempt category in Item Number 56., go to Item Number 65.';
  if(id==='I-821' && /Biographic Information/.test(label))label=label.replace(/^Part\s*\d+[.]/,'Part 3.');
  if(id==='I-821' && /^Part 6\. Interpreter's/.test(label))label=label.replace(/^Part 6\./,'Part 9.');
  if(id==='I-864' && /^Part 1\. Information About You \(Sponsor\)/.test(label))label=label.replace(/^Part 1\./,'Part 2.');
  if(id==='N-565' && /^Part 6\./.test(label))label=label.replace(/After completing this section, go to Part 4\./,'After completing this section, go to Part 9.');
  return label;
}

function linesOf(items) {
  const lines = [];
  for (const item of items.filter(item => clean(item.str) && item.transform[5] > 40)) {
    const y = item.transform[5], x = item.transform[4];
    let line = lines.find(line => Math.abs(line.y - y) < 1.5);
    if (!line) { line = { y, items: [] }; lines.push(line); }
    line.items.push({ text: item.str, x, width: item.width, height: item.height });
  }
  return lines.sort((a,b) => b.y - a.y).map(line => ({ ...line, text: clean(line.items.sort((a,b)=>a.x-b.x).map(x=>x.text).join(' ')) }));
}
function headingFor(field, lines) {
  const centerX = (field.rect[0]+field.rect[2])/2;
  const candidates = lines.flatMap(line => line.items.filter(item => /^Part\s+\d+[.:]/i.test(item.text) && item.height >= 11).map(item=>({ ...item, y:line.y })));
  const above = candidates.filter(item=> item.y >= field.rect[3]-10 && item.x <= centerX);
  const heading = above.sort((a,b)=>a.y-b.y || b.x-a.x)[0];
  if (heading) return clean(heading.text);
  return `Page ${field.page}`;
}
function optionText(field, pageFields, lines) {
  const [x,y,right] = field.rect;
  const next = pageFields.filter(other=>other!==field && other.type==='/Btn' && Math.abs(other.rect[0]-x)<12 && other.rect[1]<y-3).sort((a,b)=>b.rect[1]-a.rect[1])[0];
  const lower = Math.max(next ? next.rect[3]+1 : y-62, y-62);
  const first = lines.find(line=>Math.abs(line.y-(y+2))<5);
  if (!first) return '';
  const nextBox = pageFields.filter(other=>other!==field && other.type==='/Btn' && Math.abs(other.rect[1]-y)<5 && other.rect[0]>right).sort((a,b)=>a.rect[0]-b.rect[0])[0];
  const limit = nextBox?.rect[0] ?? 600;
  const text = first.items.filter(item=>item.x>=right-1 && item.x<limit).map(item=>item.text).join(' ');
  if (/^(?:Yes|No)(?:[ .,(]|$)/i.test(clean(text))) return clean(text).match(/^(Yes|No)/i)[0];
  const tail = lines.filter(line=>line.y < first.y-2 && line.y>lower).flatMap(line=>line.items.filter(item=>item.x>=right-1&&item.x<limit).map(item=>item.text));
  return clean([text,...tail].join(' '));
}
function rawGroupKey(id, field) {
  let name = base(field).replace(/_(?:Yes|No)$/i, '_YesNo').replace(/_(?:Male|Female)$/i, '_Sex').replace(/_(?:Extend|Extends|DoesNotExtend|NotExtend)$/i, '_Extent').replace(/(_Race|checkbox7)_[A-Za-z]+$/, '$1');
  // Source-reviewed groups whose mutually exclusive choices use separate PDF names.
  const rules = {
    'I-130': [/^Pt4Line10_(?:YesNo|Unknown)$/, /^Pt1Line1_/, /^Pt1Line2_/, /^Pt2Line17_/, /^Pt2Line36_(?:USCitizen|LPR)$/, /^Pt2Line23[abc]_checkbox$/, /^Pt4Line54_/],
    'G-639': [/^Pt1Line1[A-F]_Checkbox$/, /^Pt1Line2_Checkbox[A-Q]$/, /^Pt1Line3_Checkbox[A-D]$/, /^Pt4Line3_Checkbox[A-F]$/],
    'I-751': [/^Pt3Line1[c-g]$/, /^Pt6Line4[abc]_chbx$/],
    'I-134': [/^Pt2Line12_(?:Date|NoDate)$/, /^Pt4Line1[ab]_Checkbox[ab]$/],
    'I-864': [/^P4_Line11[abc]_Checkbox$/],
    'I-821': [/^Part1_Item2_GrantedTPS[UI]$/, /^Part3_Item2_Race[A-Z]$/, /^Part4_Item9_TPS[YN]$/],
    'I-821D': [/^P1_Line[12]_Checkbox$/],
    'I-131': [/^P1_Line8A_[12]$/, /^P1_Line6B_[123]$/, /^P1_Line10E_[123]$/, /^P1_Line10H_[12]$/, /^P3_Line2_Race_/, /^P4_Line6a_/, /^P5_Line1_/],
    'I-131A': [/^Pt6_Line7b_(?:Extend|DoesNotExtend)$/],
    'N-565': [/^Pt3CheckBox(?:2a|[3-7]|8a)$/, /^Pt5CheckBox[AB]$/, /^Pt6CheckBox1[AB]$/, /^Pt4_Item1_/],
    'N-600': [/^Pt1Line1_(?:child|citzparent)$/, /^Pt2Line14B_(?:TravelDoc|Passport)Chbx$/, /^Pt3Line3_(?:Mother|Father)$/, /^Pt4Line3_(?:Mother|Father)$/],
  };
  for (let i=0;i<(rules[id]||[]).length;i++) if(rules[id][i].test(name)) name=`reviewed-${i}`;
  if (id==='I-485' && /^Pt2Line3[a-g]_/.test(base(field)) && !/Assoc/.test(base(field))) name='filing-category';
  // Same tree field names continue across printed pages for these single-choice lists.
  if(id==='N-565' && name==='reviewed-0')return 'replacement-reasons';
  if ((id==='I-131' && name==='CB_AppType') || (id==='I-485' && ['filing-category','Pt9Line56_CB'].includes(name))) return name;
  // The preparer's participation is separate from reading English / interpreter.
  if (/at my request.*prepar/i.test(field.label) && /(?:P4_Line1_Checkbox|P5Line5_Checkbox)/.test(name)) return `${field.name}-preparer`;
  return `${field.name.slice(0,field.name.lastIndexOf('.'))}.${name}`;
}

for (const [id, template] of Object.entries(manifest.templates)) {
  const bytes = fs.readFileSync(path.join(ROOT,'assets/uscis-print',template.filename));
  if(crypto.createHash('sha256').update(bytes).digest('hex') !== template.sha256) throw new Error(`Changed PDF: ${id}`);
  const prepared = await prepareFreePdf(bytes,id);
  const canonical = new Map(prepared.fields.map(field=>[field.name,field]));
  const source = inventory.forms[id];
  const doc = await getDocument({data:new Uint8Array(bytes),useSystemFonts:true}).promise;
  const pages = [];
  for(let p=1;p<=doc.numPages;p++) pages.push(linesOf((await(await doc.getPage(p)).getTextContent()).items));
  const input = source.fields.filter(field=>canonical.has(field.name)).sort(order);
  for(const field of input) {
    field.originalLabel=field.label;
    field.label=correctedLabel(id,field);
    field.actualHeading = headingFor(field,pages[field.page-1]);
    const oldPart=clean(field.label).match(/^Part\s*(\d+)/i)?.[1];
    const newPart=field.actualHeading.match(/^Part\s*(\d+)/i)?.[1];
    if(oldPart && newPart && oldPart!==newPart) audit.staleHeadings.push({id,name:field.name,page:field.page,heading:field.actualHeading,label:clean(field.label)});
  }
  const groups = new Map();
  for (const field of input.filter(field=>canonical.get(field.name).kind==='checkbox')) {
    const key=rawGroupKey(id,field);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(field);
  }
  const used=new Set(), fields=[];
  for(const field of input) {
    if(used.has(field.name))continue;
    const descriptor=canonical.get(field.name);
    const members=descriptor.kind==='checkbox'?groups.get(rawGroupKey(id,field)):[field];
    const label=clean(field.label);
    const question={id:`f-${slug(members.map(f=>f.name).join('|'))}`,label,kind:descriptor.kind==='text'?(descriptor.multiline?'textarea':'text'):descriptor.kind==='choice'?'select':descriptor.kind,required:false,pdfFields:[],source:{page:field.page,officialLabel:clean(field.originalLabel)}};
    if(descriptor.maxLength)question.maxLength=descriptor.maxLength;
    if(descriptor.kind==='checkbox'&&members.length>1) {
      const allLabels=members.map(f=>clean(f.label)).join(' ');
      const multi=(id==='I-751' && /^Pt3Line1[c-g]$/.test(base(field))) || (id==='N-565' && /^Pt3CheckBox(?:2a|[3-7]|8a)$/.test(base(field))) || (id==='G-639' && /^Pt1Line[23]_Checkbox/.test(base(field))) || /select (?:all|any) (?:the |of the following |boxes |applicable)|check (?:all|any)|applicable box\(es\)/i.test(allLabels) && !/select only one box/i.test(allLabels);
      question.kind=multi?'multiselect':'radio';
      question.options=members.map((f,index)=>{
        const actual=optionText(f,input.filter(other=>other.page===f.page),pages[f.page-1]);
        const state=clean(f.exportStates?.[0]);
        const tail=clean(f.label).match(/(?:Select(?:(?:\s+this)?\s+box)?(?:\s+for)?\s*:?|Check(?:\s+this)?\s+box(?:\s+(?:for|if))?\s*:?)\s+(.+)$/i)?.[1];
        const shortStates={APT:'Apartment',STE:'Suite',FLR:'Floor'};
        const markers=[...clean(f.label).matchAll(/\b(?:Select(?:\s+this)?(?:\s+[Bb]ox)?(?:\s+for)?|Check(?:\s+this)?\s+box(?:\s+(?:for|if))?)\s*:?\s+/g)];
        const last=markers.at(-1);
        const caption=last?clean(f.label).slice(last.index+last[0].length):tail;
        let optionLabel=/^(Yes|No)$/.test(actual)?actual:shortStates[state] || caption || clean(f.label);
        if(id==='I-131' && base(f)==='CB_AppType')optionLabel=travelChoices[state];
        if(id==='G-639' && base(f)==='Pt4Line3_CheckboxD')optionLabel='Other relationship to the subject of record (explain).';
        if(id==='G-639' && base(f)==='Pt4Line3_CheckboxF')optionLabel='No relationship to the subject of record - other (explain).';
        return {value:`option-${index+1}`,label:optionLabel};
      });
      for(let i=0;i<members.length;i++)question.pdfFields.push({name:members[i].name,option:question.options[i].value,exportValue:members[i].exportStates?.[0]});
      // All original wording remains available; common question text is separated
      // from option captions without interpreting legal eligibility.
      const withoutOption=label.replace(/\s+(?:Select(?!\s+(?:only|one|all|any|the application|your specific)\b)|Check(?:\s+this)?\s+box)(?:\s|:)[\s\S]*$/i,'').trim();
      if(withoutOption)question.label=withoutOption;
      if(id==='I-131' && base(field)==='CB_AppType')question.help='Read Part 1 of the official form and its instructions before choosing. The choices below preserve the printed item numbers; complete the details for the application type you select.';
      question.source.pages=[...new Set(members.map(f=>f.page))];
      audit.groups.push({id,page:field.page,names:members.map(f=>short(f)),kind:question.kind,options:question.options.map(o=>o.label)});
    }else {
      question.pdfFields=[{name:field.name}];
      if(descriptor.kind==='checkbox')audit.ungroupedCheckboxes.push({id,page:field.page,name:short(field),label});
      if(['choice','radio'].includes(descriptor.kind))question.options=[...new Set(descriptor.options.filter(option=>option.trim()))].map(option=>({value:option,label:clean(option)}));
    }
    const item=label.match(/(?:Item(?: Number)?\s*)?(\d+[.][ ]?[A-Za-z]?[.]?)\s+(?:Enter|Select|Check)/i)?.[1];
    if(item)question.source.item=clean(item);
    const part=clean(field.label).match(/^Part\s*(\d+)/i)?.[1];
    const printedHeading=part ? pages.flatMap(lines=>lines.flatMap(line=>line.items)).find(item=>new RegExp(`^Part\\s+${part}[.:]`).test(item.text) && item.height>=11) : undefined;
    question._heading=part?clean(printedHeading?.text || `Part ${part}`):field.actualHeading;
    question._first=field;
    fields.push(question);members.forEach(f=>used.add(f.name));
  }
  const findQuestion = name => fields.find(q=>q.pdfFields.some(m=>base({name:m.name})===name));
  const optionFor = (q, state) => q?.pdfFields.find(m=>clean(m.exportValue)===state)?.option;
  const conditionFor = (control, states) => {
    const c=findQuestion(control), values=states.map(state=>optionFor(c,state));
    if(!c||values.some(value=>!value))throw new Error(`Missing reviewed choices ${id}: ${control} / ${states}`);
    return values.length===1?{field:c.id,equals:values[0]}:{field:c.id,oneOf:values};
  };
  const addCondition = (q, condition) => {
    if(!q)throw new Error(`Missing reviewed conditional field in ${id}`);
    q.when=q.when?{all:[q.when,condition]}:condition;
  };
  const dependency = (target, control, state) => {
    addCondition(findQuestion(target),conditionFor(control,[state]));
  };
  const caption = (name, state, text) => {
    const q=findQuestion(name), value=state===null?q?.pdfFields.find(m=>base({name:m.name})===name)?.option:optionFor(q,state), option=q?.options.find(o=>o.value===value);
    if(!option)throw new Error(`Missing reviewed caption ${id}: ${name} / ${state}`);
    option.label=text;
  };
  // Explicit conditional instructions in the pinned printed forms.
  if(id==='I-131') {
    const details={P1_Line4:'4',P1_Line5A:'5',P1_Line5B:'6',P1_Line5C:'7',P1_Line5E:'9',P1_Line5F:'10',P1_Line5G:'11',P1_Line5H:'12',P1_Line5I:'13',P1_Line5J:'14',P1_Line5K:'15',P1_Line5L:'16',P1_Line5M:'17',P1_Line6A:'18',P1_Line6B_1:'19',P1_Line6C1:'20',P1_Line6C2:'20',P1_Line6D:'21',P1_Line6E:'22',P1_Line8A_1:'24',P1_Line8B:'25',P1_Line8C:'26',P1_Line10E_1:'32',P1_Line10H_1:'35',P1_Line10I:'36'};
    for(const [name,state]of Object.entries(details))dependency(name,'CB_AppType',state);
    const behalfTypes=Array.from({length:20},(_,i)=>String(i+18)).filter(state=>state!=='24');
    const firstThem=findQuestion('P2_Line16_FamilyName');
    const party={id:'parole-recipient',label:'Part 2. Information About Them. Are you applying for yourself or on behalf of someone else?',help:'Complete Items 16. - 27. only if you are requesting parole on behalf of someone other than yourself.',kind:'radio',required:true,pdfFields:[],options:[{value:'self',label:'I am applying for myself.'},{value:'other',label:'I am applying on behalf of someone else.'}],source:{page:6,officialLabel:'Information About Them (Complete this section only if you are applying on behalf of someone else.)'},when:conditionFor('CB_AppType',behalfTypes),_heading:firstThem._heading};
    fields.splice(fields.indexOf(firstThem),0,party);
    for(const q of fields.filter(q=>q.pdfFields.some(m=>/^(?:P2|Part2)_Line(?:1[6-9]|2[0-7])_/.test(base({name:m.name}))))) {
      addCondition(q,{field:party.id,equals:'other'});
      q.label=q.label.replace(/^Part 2\. Information About You\./,'Part 2. Information About Them.').replace(/Enter your Date of Birth/i,'Enter their Date of Birth').replace(/Provide your daytime telephone/i,'Provide their daytime telephone');
      q.help='Enter information about the person on whose behalf you are applying. Do not enter your own information in this section.';
    }
    addCondition(findQuestion('P1_Line12_DateOfAdmission'),conditionFor('CB_AppType',Array.from({length:10},(_,i)=>String(i+28))));
    for(const [part,states]of [[5,['1']],[6,['2','3']],[7,Array.from({length:13},(_,i)=>String(i+5))],[8,Array.from({length:20},(_,i)=>String(i+18))],[9,Array.from({length:10},(_,i)=>String(i+28))]]) {
      for(const q of fields.filter(q=>new RegExp(`^Part ${part}\\.`).test(q.label)))addCondition(q,conditionFor('CB_AppType',states));
    }
    findQuestion('P1_Line6B_1').label='Part 1. Application Type. 6.B. Immigrant Military Members and Veterans Initiative (IMMVI).';
    findQuestion('P1_Line8A_1').label='Part 1. Application Type. 8.A. Military Parole in Place (PIP), only on my own behalf, and I am a:';
    caption('P1_Line8A_1',null,'A current or former service member.');
    caption('P1_Line8A_2',null,'A spouse, parent, son, or daughter of a current or former service member.');
    findQuestion('P4_Line7a').label='Part 4. Processing Information. 7. Where do you want your Reentry Permit or Refugee Travel Document sent? (Select one.)';
    caption('P4_Line7a','A','7.a. To the U.S. address shown in Part 2., Item Number 3. of this application.');
    caption('P4_Line7a','B','7.b. To a U.S. Embassy, U.S. Consulate, USCIS international field office, or Department of Homeland Security (DHS) office overseas at:');
    for(const q of fields.filter(q=>q.pdfFields.some(m=>/^P4_Line(?:7|8|9)/.test(base({name:m.name})))))addCondition(q,conditionFor('CB_AppType',['1','2','3']));
    for(const name of ['P4_Line7b_CityOrTown','P4_Line7b_Country','P4_Line8_CB'])dependency(name,'P4_Line7a','B');
    for(const q of fields.filter(q=>q.pdfFields.some(m=>/^P4_Line9/.test(base({name:m.name})))))addCondition(q,conditionFor('P4_Line8_CB',['B']));
    for(const name of ['P4_Line2b_DateIssued','P4_Line2c_Disposition'])dependency(name,'P4_Line2a_YesNo','Y');
    for(const name of ['P4_Line3b_DateIssued','P4_Line3c_Disposition'])dependency(name,'P4_Line3a_YesNo','Y');
    for(const name of ['P4_Line5','P4_Line6b_ReceiptNumber'])dependency(name,'P4_Line4_YesNo','Y');
    for(const name of ['P4_Line6a_Name','P4_Line6a_Explanation'])addCondition(findQuestion(name),conditionFor('P4_Line5',['3','4']));
    dependency('P6_Line6a_YesNo','P6_Line5_YesNo','N');
    for(const name of ['P6_Line6b_CityOrTown','P6_Line6c_Country'])dependency(name,'P6_Line6a_YesNo','Y');
    // Initial parole outside the U.S. is explicitly defined by Part 1, Items 6–7.
    for(const name of ['P8_Line3a_DateOfIntendedArrival','P8_Line3b_CityOrTown','P8_Line3b_Country'])addCondition(findQuestion(name),conditionFor('CB_AppType',['18','19','20','21','22','23']));
  }
  if(id==='I-485') {
    for(const [name,state]of Object.entries({Pt1Line11_Admitted:'11A',Pt1Line11_Paroled:'11B',Pt1Line11_Other:'11D'}))dependency(name,'Pt2Line11_CB',state);
    const category=findQuestion('Pt2Line3a_CB');
    category.label='Part 2. Application Type or Filing Category. 3. I am applying based on the following category. Select only one category.';
    category.help='If you are filing as a derivative applicant, select the category under which the principal applicant is applying or has applied. See the Form I-485 Instructions, including the Additional Instructions for that category.';
    for(const [name,state]of Object.entries({Pt2Line3d_Asylum:'3d0',Pt2Line3d_Refugee:'3d1',Pt2Line1g_DV:'3g0',Pt2Line1g_OtherEligibility:'3g4'}))dependency(name,'Pt2Line3a_CB',state);
    addCondition(findQuestion('Pt2Line3b_CB140Assoc'),conditionFor('Pt2Line3a_CB',Array.from({length:8},(_,i)=>`3b${i+1}`)));
    for(const name of ['Pt2Relative_CB','Pt2RelativeType_CB'])dependency(name,'Pt2Line3b_CB140Assoc','Y');
    const charge=findQuestion('Pt9Line56_CB');
    charge.label='Part 9. General Eligibility and Inadmissibility Grounds. Public Charge. 56. Select only one exempt category, or select that you do not fall under any listed exempt category.';
    charge.help='If you select an exempt category, skip Item Numbers 57. - 64. Otherwise complete those items. See the Public Charge section of the official Instructions.';
    findQuestion('Pt9Line61_CB').label='Part 9. General Eligibility and Inadmissibility Grounds. Public Charge. 61. What is the highest level of education you have completed?';
    for(const q of fields.filter(q=>q.source.page>=19&&q.source.page<=20&&/Public Charge\.|Pt9Line61_diploma/.test(q.label+' '+q.pdfFields.map(m=>m.name).join(' '))&&q!==charge))addCondition(q,conditionFor('Pt9Line56_CB',['23']));
    for(const q of fields.filter(q=>q.pdfFields.some(m=>/^Pt8Line68c_/.test(base({name:m.name})))))dependency(base({name:q.pdfFields[0].name}),'Pt9Line63_YesNo','Y');
  }
  if(id==='N-400') {
    for(const name of ['P10_Line2_TotalHouseholdIn','P10_Line3_HouseHoldSize','P11_Line1_TotalChildren','P10_Line5a']) {
      const q=fields.find(q=>q.source.page===11&&q.pdfFields.some(m=>base({name:m.name})===name));
      const c=findQuestion('P10_Line1_Citizen');q.when={field:c.id,equals:optionFor(c,'Y')};
    }
    const head=findQuestion('P10_Line5a'), fee=findQuestion('P10_Line1_Citizen');
    findQuestion('P10_Line5b_NameOfHousehold').when={all:[{field:fee.id,equals:optionFor(fee,'Y')},{field:head.id,equals:optionFor(head,'N')}]};
    dependency('P12_Line26b','P12_Line26a','Y');
    dependency('P12_Line26c','P12_Line26a','Y');
    dependency('P11_Line26d','P12_Line26a','N');
    dependency('P12_Line30b','P12_Line30a','Y');
    dependency('P9_NobilityTitles','P12_Line30a','Y');
  }
  if(id==='G-639') {
    const request=fields.find(q=>q.pdfFields.some(m=>base({name:m.name})==='Pt1Line1A_Checkbox'));
    const choices=request.pdfFields.filter(m=>/Pt1Line1[BE]_Checkbox/.test(m.name)).map(m=>m.option);
    for(const q of fields.filter(q=>/^Part 4[.,]/.test(q.label)))q.when={field:request.id,oneOf:choices};
  }
  if(id==='I-751') {
    const joint=findQuestion('Pt3Line1'), waiver=findQuestion('Pt3Line1c');
    const route={id:'filing-basis',label:'Part 3. Basis for Petition',help:'The official form separates Joint Filing from Waiver or Individual Filing Request with “OR.” Select the section you are completing.',kind:'radio',required:true,pdfFields:[],options:[{value:'joint',label:'Joint Filing'},{value:'waiver',label:'Waiver or Individual Filing Request'}],source:{page:3,officialLabel:'Joint Filing OR Waiver or Individual Filing Request'},_heading:joint._heading};
    joint.when={field:route.id,equals:'joint'};waiver.when={field:route.id,equals:'waiver'};
    fields.splice(fields.indexOf(joint),0,route);
  }
  for(const q of fields) {
    if(!/If you marked the apartment, suite or floor box/i.test(q.label))continue;
    const f=input.find(f=>f.name===q.pdfFields[0]?.name);
    const units=fields.filter(c=>c.kind==='radio'&&c.source.page===q.source.page&&c.pdfFields.every(m=>['APT','STE','FLR'].includes(clean(m.exportValue))));
    const unit=units.find(c=>{const r=input.find(f=>f.name===c.pdfFields[0].name).rect;return Math.abs(r[1]-f.rect[1])<10;});
    if(unit)q.when={field:unit.id,oneOf:unit.options.map(o=>o.value)};
  }
  const sections=[];
  for(const question of fields) {
    const title=question._heading;
    const key=`page-${question.source.page}-${slug(title)}`;
    let section=sections.find(s=>s.id===key);
    if(!section){section={id:key,page:question.source.page,title,fields:[]};sections.push(section);}
    delete question._heading;delete question._first;section.fields.push(question);
  }
  const excluded=source.fields.filter(field=>!canonical.has(field.name)).map(field=>({name:field.name,page:field.page,reason:/barcode/i.test(field.name)?'Barcode retained from the official PDF.':/signature|dateofsign|(?:_|\.)(?:sign|sig)\[/i.test(field.name)||/signature|signed electronically/i.test(field.label)?'Signature or signing date: complete as directed on the printed official form.':'Official-use or non-input field retained from the official PDF.'}));
  const signing=excluded.filter(field=>/Signature/.test(field.reason)).map(field=>({role:'Required signer',page:field.page,instruction:clean(source.fields.find(f=>f.name===field.name).label),blankPdfFields:[field.name]}));
  forms[id]={id,title:titles[id],edition:source.edition,templateSha256:template.sha256,originalSha256:source.originalSha256,pageCount:template.pageCount,pdfUrl:template.sourcePdfUrl,sourceUrl:source.sourceUrl,instructionsUrl:source.instructionsUrl || source.sourceUrl,generalHelp:'Answer the official form questions that apply to you. You can leave an item blank and return to it. Follow the form instructions for items that do not apply and any additional information. Review every page of the completed PDF, supporting documents, and signing instructions before filing.',sections,signing,excluded,coverage:{officialFields:source.fields.length,editableFields:prepared.fields.length,mappedFields:used.size,protectedFields:excluded.length,questions:fields.length}};
  if(used.size!==prepared.fields.length)throw new Error(`Incomplete coverage: ${id}`);
  console.log(`${id}: ${used.size} fields, ${fields.length} questions, ${sections.length} sections`);
  await doc.cleanup();
}
fs.writeFileSync(path.join(ROOT,'data/uscis-guided-questionnaires.json'),JSON.stringify({schemaVersion:1,generation:'Pinned official PDF fields and page content; all-input interview, not an eligibility decision.',forms},null,2)+'\n');
fs.mkdirSync(path.join(ROOT,'tmp/guided-schema'),{recursive:true});
fs.writeFileSync(path.join(ROOT,'tmp/guided-schema/audit.json'),JSON.stringify(audit,null,2));
