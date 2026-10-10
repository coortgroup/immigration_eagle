#!/usr/bin/env python3
"""Build the manually mapped I-90 interview from the verified blank PDF inventory.

This mapping is specific to edition 01/20/25. Its coverage assertion concerns
input locations, not eligibility, evidence, or government acceptance.
"""
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
inventory = json.loads((ROOT / 'data/uscis-form-inventory.json').read_text())['forms']['I-90']
assert inventory['edition'] == '01/20/25', 'Re-review this mapping for a new edition.'
widgets = inventory['fields']
questions = []
used = set()


def widget(short, page=None):
    matches = [f for f in widgets if f['shortName'] == short and (page is None or f['page'] == page)]
    assert len(matches) == 1, (short, page, len(matches))
    return matches[0]


def mapping(short, **extra):
    f = widget(short)
    assert f['name'] not in used, f['name']
    used.add(f['name'])
    return {'name': f['name'], **extra}


def text(id, label, short, required=True, type='text', **extra):
    f = widget(short)
    result = {'id': id, 'label': label, 'type': type, 'required': required, 'pdfFields': [mapping(short)]}
    if f.get('maxLength'):
        result['maxLength'] = f['maxLength']
    if type == 'date':
        result.update({'placeholder': 'MM/DD/YYYY', 'maxLength': 10, 'validation': 'date'})
    result.update(extra)
    return result


def select(id, label, short, required=True):
    f = widget(short)
    options = []
    for v in f['options']:
        v = v if isinstance(v, list) else [v, v]
        if v[0].strip():
            options.append({'value': v[0], 'label': v[1]})
    return {'id': id, 'label': label, 'type': 'select', 'required': required, 'options': options, 'pdfFields': [mapping(short)]}


def choice(id, label, options, required=True, multi=False):
    result = {'id': id, 'label': label, 'type': 'multiselect' if multi else 'radio', 'required': required, 'options': [], 'pdfFields': []}
    for value, title, short in options:
        result['options'].append({'value': value, 'label': title})
        if short:
            f = widget(short)
            assert len(f['exportStates']) == 1, short
            result['pdfFields'].append(mapping(short, option=value, exportValue=f['exportStates'][0]))
    return result


def route(id, label, options):
    return choice(id, label, [(value, title, None) for value, title in options])


def q(id, part, item, title, help, fields, when=None, instructionPages=None):
    out = {'id': id, 'part': part, 'item': item, 'title': title, 'help': help, 'fields': fields,
           'source': {'formPages': sorted({widget_by_name[m['name']]['page'] for f in fields for m in f.get('pdfFields', [])}), 'instructionPages': instructionPages or []}}
    if when:
        out['when'] = when
    questions.append(out)
    return out


widget_by_name = {f['name']: f for f in widgets}
YES = [('yes', 'Yes'), ('no', 'No')]

q('alien-number', 1, '1', 'What is your Alien Registration Number (A-Number)?',
  'Your A-Number identifies your immigration record and appears on USCIS or DHS documents. Enter the digits after A. If you do not have one, the instructions say to enter N/A.',
  [text('alien_number', 'A-Number', 'P1_Line1_AlienNumber[0]', validation='a-number')], instructionPages=[3])
q('account-number', 1, '2', 'What is your USCIS Online Account Number, if any?',
  'This is different from your A-Number. Find it in your USCIS account profile or Account Access Notice; do not enter a receipt number.',
  [text('online_account', 'USCIS Online Account Number', 'P1_Line2_AcctIdentifier[0]', False, validation='online-account')], instructionPages=[3])
q('legal-name', 1, '3.a–3.c', 'What is your full legal name?',
  'Use your current full legal name. USCIS states that your card will be issued in this name. Enter N/A for a name component that does not apply.',
  [text('family_name', 'Family name (last name)', 'P1_Line3a_FamilyName[0]'), text('given_name', 'Given name (first name)', 'P1_Line3b_GivenName[0]'), text('middle_name', 'Middle name', 'P1_Line3c_MiddleName[0]')], instructionPages=[3])
q('name-changed', 1, '4', 'Has your name legally changed since your Permanent Resident Card was issued?',
  'Choose the statement that matches your situation. A legal name change requires the supporting legal documents described in the instructions.',
  [choice('name_changed', 'Legal name change', [('yes','Yes','P1_checkbox4[0]'),('no','No','P1_checkbox4[1]'),('never-received','N/A — I never received my previous card','P1_checkbox4[2]')])], instructionPages=[3])
q('previous-card-name', 1, '5.a–5.c', 'What name is printed on your current Permanent Resident Card?',
  'Copy the name exactly as it appears on your existing card, even though your legal name has changed. Include evidence of the legal name change with your application.',
  [text('card_family_name','Family name (last name)','P1_Line5a_FamilyName[0]'),text('card_given_name','Given name (first name)','P1_Line5b_GivenName[0]'),text('card_middle_name','Middle name','P1_Line5c_MiddleName[0]')],
  when={'field':'name_changed','equals':'yes'}, instructionPages=[3])


def address(prefix, part, item, title, help, base, unit_base, naming, when=None, in_care=None, instructionPages=None):
    fields = []
    if in_care:
        fields.append(text(prefix+'_care_of','In care of name, if applicable',in_care,False))
    fields.append(text(prefix+'_street','Street number and name',base+naming['street']))
    fields.append(choice(prefix+'_unit_type','Apartment, suite or floor', [('none','No apartment, suite or floor',None),('apt','Apartment',unit_base+'[0]'),('ste','Suite',unit_base+'[1]'),('flr','Floor',unit_base+'[2]')]))
    unit = text(prefix+'_unit','Apartment, suite or floor number',base+naming['unit'],False)
    unit['requiredWhen'] = {'field':prefix+'_unit_type','oneOf':['apt','ste','flr']}
    fields += [unit,text(prefix+'_city','City or town',base+naming['city']),select(prefix+'_state','State (for a U.S. address)',base+naming['state'],False),text(prefix+'_zip','ZIP code (for a U.S. address)',base+naming['zip'],False,validation='zip'),text(prefix+'_province','Province (for a foreign address)',base+naming['province'],False),text(prefix+'_postal','Postal code (for a foreign address)',base+naming['postal'],False),text(prefix+'_country','Country',base+naming['country'])]
    return q(prefix+'-address',part,item,title,help,fields,when,instructionPages)


address('mail',1,'6.a–6.i','Where should USCIS mail correspondence?',
  'Provide your mailing address. USCIS generally sends cards only to a valid U.S. mailing address; the instructions give special directions for commuters. Complete the state and ZIP for a U.S. address, or province and postal code for a foreign address. Do not shorten an answer to fit; use Part 8 if needed.',
  'P1_Line6','P1_checkbox6c_Unit',{'street':'b_StreetNumberName[0]','unit':'c_AptSteFlrNumber[0]','city':'d_CityOrTown[0]','state':'e_State[0]','zip':'f_ZipCode[0]','province':'g_Province[0]','postal':'h_PostalCode[0]','country':'i_Country[0]'},in_care='P1_Line6a_InCareofName[0]',instructionPages=[3])
q('physical-different',1,'7.a–7.h','Is your physical address different from your mailing address?',
  'The printed form asks for a physical address only when it differs from your mailing address. Current commuters should provide their foreign physical residence address.',
  [route('physical_different','Different physical address?',YES)],instructionPages=[3])
address('physical',1,'7.a–7.h','Where do you physically live?',
  'Use the address where you live. Complete state and ZIP for a U.S. address, or province and postal code for a foreign address.',
  'P1_Line7','P1_checkbox7b_Unit',{'street':'a_StreetNumberName[0]','unit':'b_AptSteFlrNumber[0]','city':'c_CityOrTown[0]','state':'d_State[0]','zip':'e_ZipCode[0]','province':'f_Province[0]','postal':'g_PostalCode[0]','country':'h_Country[0]'},when={'field':'physical_different','equals':'yes'},instructionPages=[3])
q('sex',1,'8','Sex',
  'The instructions direct you to use the sex recorded on your birth certificate issued at or closest to birth, or the applicable secondary evidence provided to USCIS.',
  [choice('sex','Sex',[('male','Male','P1_Line8_male[0]'),('female','Female','P1_Line8_female[0]')])],instructionPages=[4])
q('birth',1,'9–11','When and where were you born?',
  'Use MM/DD/YYYY for your date of birth. Provide the city, town or village and the country of your birth.',
  [text('birth_date','Date of birth','P1_Line9_DateOfBirth[0]',type='date'),text('birth_city','City, town or village of birth','P1_Line10_CityTownOfBirth[0]'),text('birth_country','Country of birth','P1_Line11_CountryofBirth[0]')],instructionPages=[4])
q('parents',1,'12–13','What are your parents’ first names?',
  'These items ask for given (first) names, not full names. If an answer is not available, do not guess; check the official instructions before printing.',
  [text('mother_given_name','Mother’s given name','P1_Line12_MotherGivenName[0]'),text('father_given_name','Father’s given name','P1_Line13_FatherGivenName[0]')],instructionPages=[4])
q('admission',1,'14–15','What are your class and date of admission?',
  'Your class is the three-character immigrant category on your Permanent Resident Card, for example IR2. The admission date is when you were granted permanent or conditional permanent resident status.',
  [text('admission_class','Class of admission','P1_Line14_ClassOfAdmission[0]'),text('admission_date','Date of admission','P1_Line15_DateOfAdmission[0]',type='date')],instructionPages=[4])
q('ssn',1,'16','What is your U.S. Social Security Number, if any?',
  'Enter nine digits if you have a U.S. Social Security Number.',
  [text('ssn','U.S. Social Security Number','P1_Line16_SSN[0]',False,validation='ssn')],instructionPages=[4])
q('status',2,'1.a–1.c','What is your current status?',
  'Choose one status. The printed form directs lawful permanent residents and commuters to Section A and conditional permanent residents to Section B. Read the I-90 instructions before continuing if conditional status is expiring within 90 days.',
  [choice('resident_status','Current status',[('lpr','Lawful Permanent Resident','P2_checkbox1[0]'),('commuter','Permanent Resident — In Commuter Status','P2_checkbox1[1]'),('conditional','Conditional Permanent Resident','P2_checkbox1[2]')])],instructionPages=[1,4])
reason_a = [
 ('2a','My previous card has been lost, stolen, or destroyed.','P2_checkbox2[5]'),
 ('2b','My previous card was issued but never received.','P2_checkbox2[6]'),
 ('2c','My existing card has been mutilated.','P2_checkbox2[7]'),
 ('2d','My existing card has incorrect data because of Department of Homeland Security (DHS) error.','P2_checkbox2[4]'),
 ('2e','My name or other biographic information has been legally changed since issuance of my existing card.','P2_checkbox2[0]'),
 ('2f','My existing card has already expired or will expire within six months.','P2_checkbox2[1]'),
 ('2g1','I have reached my 14th birthday and am registering as required. My existing card will expire AFTER my 16th birthday.','P2_checkbox2[2]'),
 ('2g2','I have reached my 14th birthday and am registering as required. My existing card will expire BEFORE my 16th birthday.','P2_checkbox2[3]'),
 ('2h1','I am a permanent resident who is taking up commuter status.','P2_checkbox2[11]'),
 ('2h2','I am a commuter who is taking up actual residence in the United States.','P2_checkbox2[9]'),
 ('2i','I have been automatically converted to lawful permanent resident status.','P2_checkbox2[10]'),
 ('2j','I have a prior edition of the Alien Registration Card, or I am applying to replace my current Permanent Resident Card for a reason that is not specified above.','P2_checkbox2[8]')]
q('reason-a',2,'2.a–2.j','What is your reason for applying? (Section A)',
  'Select only one reason and read its full instructions and evidence requirements. The instructions distinguish a card returned to USCIS as undeliverable from a lost card, and DHS error from other incorrect data. The age-14 reasons have additional timing conditions; do not choose based only on this short label.',
  [choice('reason_a','Reason for application',reason_a)],when={'field':'resident_status','oneOf':['lpr','commuter']},instructionPages=[4,5,6])
q('commuter-port',2,'2.h.1.a','Which U.S. port of entry do you use or plan to use?',
  'For reason 2.h.1, provide the city or town and state of your port of entry. Current commuters using a foreign mailing address are also directed by the instructions to provide this port for card pickup. Otherwise this item can remain blank.',
  [text('commuter_port','Port of entry — city or town and state','P2_Line2h1_CityandState[0]',False,requiredWhen={'field':'reason_a','equals':'2h1'})],when={'field':'resident_status','oneOf':['lpr','commuter']},instructionPages=[3,6])
q('reason-b',2,'3.a–3.e','What is your reason for applying? (Section B)',
  'Select one reason for replacing a conditional resident card. Read its complete instructions and evidence requirements. I-90 is not the process to remove conditions on residence.',
  [choice('reason_b','Reason for application',[
   ('3a','My previous card has been lost, stolen, or destroyed.','P2_checkbox3[4]'),('3b','My previous card was issued but never received.','P2_checkbox3[0]'),('3c','My existing card has been mutilated.','P2_checkbox3[1]'),('3d','My existing card has incorrect data because of Department of Homeland Security (DHS) error.','P2_checkbox3[2]'),('3e','My name or other biographic information has legally changed since issuance of my existing card.','P2_checkbox3[3]')])],when={'field':'resident_status','equals':'conditional'},instructionPages=[1,6,7])
q('processing-locations',3,'1–2','Where did you apply, and where was your visa issued or status granted?',
  'Provide the location of the U.S. Embassy, consulate or USCIS office for each item. These may be different locations.',
  [text('applied_location','Location where you applied for an immigrant visa or adjustment of status','P3_Line1_LocationAppliedVisa[0]'),text('granted_location','Location where your visa was issued or adjustment of status was granted','P3_Line2_LocationIssuedVisa[0]')],instructionPages=[7])
q('entry-route',3,'3.a–3.a.1','Did you enter the United States with an immigrant visa?',
  'The form asks for your destination and port of entry if you entered with an immigrant visa. If you were granted adjustment of status, it directs you to Item 4.',
  [route('immigrant_visa_entry','Entered with an immigrant visa?',YES)],instructionPages=[7])
q('entry-details',3,'3.a–3.a.1','What were your destination and port of entry when admitted?',
  'Give your destination in the United States at admission. For the port, provide the city or town and state and identify the type, such as airport, bridge or tunnel, as the instructions direct.',
  [text('entry_destination','Destination in the United States at admission','P3_Line3a_Destination[0]'),text('entry_port','Port of entry — city or town and state','P3_Line3a1_CityandState[0]')],when={'field':'immigrant_visa_entry','equals':'yes'},instructionPages=[7])
q('removal',3,'4','Have you ever been in exclusion, deportation, or removal proceedings or ordered removed from the United States?',
  'Answer the question as written. If Yes, the form requires a detailed explanation in Part 8. This app does not decide the legal effect of an answer.',
  [choice('removal_history','Answer',[('yes','Yes','P3_checkbox4[1]'),('no','No','P3_checkbox4[0]')])],instructionPages=[8])
q('abandonment',3,'5','Since you were granted permanent residence, have you ever filed Form I-407 or otherwise been judged to have abandoned your status?',
  'Form I-407 records abandonment of lawful permanent resident status. If Yes, provide a detailed explanation in Part 8.',
  [choice('abandonment_history','Answer',[('yes','Yes','P3_checkbox5[1]'),('no','No','P3_checkbox5[0]')])],instructionPages=[8])
q('ethnicity',3,'6','What is your ethnicity?',
  'Select one category from the official form. The instructions define Hispanic or Latino as Cuban, Mexican, Puerto Rican, South or Central American, or other Spanish culture or origin, regardless of race.',
  [choice('ethnicity','Ethnicity',[('hispanic','Hispanic or Latino','P3_checkbox6[1]'),('not-hispanic','Not Hispanic or Latino','P3_checkbox6[0]')])],instructionPages=[8])
q('race',3,'7','Which racial categories apply to you?',
  'The official form allows more than one selection. Use the category definitions in the instructions when needed.',
  [choice('race','Select all applicable categories',[('white','White','P3_checkbox7_White[0]'),('asian','Asian','P3_checkbox7_Asian[0]'),('black','Black or African American','P3_checkbox7_Black[0]'),('american-indian','American Indian or Alaska Native','P3_checkbox7_Indian[0]'),('pacific-islander','Native Hawaiian or Other Pacific Islander','P3_checkbox7_Hawaiian[0]')],multi=True)],instructionPages=[8])
q('height',3,'8','What is your height in feet and inches?',
  'Use feet and inches, not meters or centimeters. Select the values that best match your height.',
  [select('height_feet','Feet','P3_Line8_HeightFeet[0]'),select('height_inches','Inches','P3_Line8_HeightInches[0]')],instructionPages=[8])
weight_fields = [mapping('P3_Line9_HeightInches'+str(i)+'[0]',transform='digit'+str(i)) for i in range(1,4)]
q('weight',3,'9','What is your weight in pounds?',
  'Use three digits, adding a leading zero if needed (for example, 095). The instructions say to enter 000 if unknown, below 30 pounds, or above 699 pounds. Do not enter kilograms.',
  [{'id':'weight','label':'Weight in pounds','type':'text','required':True,'maxLength':3,'validation':'weight','pdfFields':weight_fields}],instructionPages=[8])
q('eye-color',3,'10','What is your eye color?',
  'Select the single category that best describes your eyes.',
  [choice('eye_color','Eye color',[(v,v,'P3_checkbox10['+str(i)+']') for i,v in enumerate(['Blue','Green','Hazel','Pink','Maroon','Brown','Black','Unknown / Other','Gray'])])],instructionPages=[8])
q('hair-color',3,'11','What is your hair color?',
  'Select the single category that best describes your hair.',
  [choice('hair_color','Hair color',[(v,v,'P3_checkbox11['+str(i)+']') for i,v in enumerate(['Bald (No hair)','Blond','Gray','Sandy','Unknown / Other','White','Red','Brown','Black'])])],instructionPages=[8])
q('accommodation',4,'1','Are you requesting an accommodation because of a disability or impairment?',
  'Choose Yes if you are requesting an accommodation. For appointment arrangements, also follow the instructions on your appointment notice or USCIS accommodation guidance.',
  [choice('accommodation','Request an accommodation?',[('yes','Yes','P4_checkbox1[1]'),('no','No','P4_checkbox1[0]')])],instructionPages=[2])
q('accommodation-types',4,'1.a–1.c','Which accommodation requests apply?',
  'Select all applicable categories, then describe what you request. Use Part 8 if more space is needed.',
  [choice('accommodation_types','Select all that apply',[('hearing','I am deaf or hard of hearing','P4_checkbox1a[0]'),('vision','I am blind or have low vision','P4_checkbox1b[0]'),('other','I have another disability or impairment','P4_checkbox1c[0]')],multi=True)],when={'field':'accommodation','equals':'yes'},instructionPages=[2])
for kind,letter,title,help in [('hearing','a','What accommodation do you request for hearing?','If requesting a sign-language interpreter, identify the language, such as American Sign Language.'),('vision','b','What accommodation do you request for vision?','Describe the accommodation you are requesting.'),('other','c','What other disability or impairment and accommodation should USCIS know about?','Describe the nature of the disability or impairment and the accommodation requested.')]:
    q('accommodation-'+kind,4,'1.'+letter,title,help,[text('accommodation_'+kind,'Accommodation request','P4_Line1'+letter+'_AccomodationRequested[0]',type='textarea')],when={'field':'accommodation_types','includes':kind},instructionPages=[2])
q('applicant-statement',5,'1.a–1.b','Which applicant statement is true?',
  'Read all form questions and instructions before choosing. These are your statements on the government form; the app must not select one for you. Read the Penalties section of the instructions before signing.',
  [choice('applicant_statement','Select one statement',[('english','I can read and understand English, and I have read and understand every question and instruction on this application and my answer to every question.','P5_Checkbox1a[0]'),('interpreter','The interpreter named in Part 6 read to me every question and instruction and my answer to every question in a language in which I am fluent, and I understood everything.','P5_Checkbox1b[0]')])],instructionPages=[8,10])
q('interpreter-language',5,'1.b','Which language did the interpreter use?',
  'Use the language in which the interpreter read every question, instruction and answer. This same language is repeated in the interpreter’s certification in Part 6.',
  [text('interpreter_language','Language','P5_Line1b_Language[0]',maxLength=18)],when={'field':'applicant_statement','equals':'interpreter'},instructionPages=[8])
q('preparer-used',5,'2','Did another person prepare this application at your request?',
  'Select Yes only if the preparer named in Part 7 prepared the application based only on information you provided or authorized. Anyone acting as preparer must complete Part 7 and sign it; the app does not supply a person’s certification.',
  [choice('preparer_used','Another person prepared the application',[('yes','Yes','P5_Checkbox2[0]'),('no','No',None)])],instructionPages=[8,9])
q('preparer-name',5,'2','What is the name of the person who prepared the application?',
  'Use the same preparer you will identify in Part 7. That person must review, sign and date their certification.',
  [text('preparer_full_name','Name of preparer','P5_Line2_NameofRepresentative[0]')],when={'field':'preparer_used','equals':'yes'},instructionPages=[8,9])
q('applicant-contact',5,'3–5','What are your contact details?',
  'Provide your daytime telephone number, and your mobile telephone number and email address if you have them.',
  [text('applicant_phone','Daytime telephone number','P5_Line3_DaytimePhoneNumber[0]',validation='phone'),text('applicant_mobile','Mobile telephone number, if any','P5_Line4_MobilePhoneNumber[0]',False,validation='phone'),text('applicant_email','Email address, if any','P5_Line5_EmailAddress[0]',False,validation='email')],instructionPages=[8])
interpreter_when = {'field':'applicant_statement','equals':'interpreter'}
q('interpreter-name',6,'1.a–2','Who interpreted the application for you?',
  'The actual interpreter must provide this information, review the interpreter’s certification, and sign and date Part 6. Include the business or organization name if applicable.',
  [text('interpreter_family_name','Interpreter’s family name','P6_Line1a_InterpretersFamilyName[0]'),text('interpreter_given_name','Interpreter’s given name','P6_Line1b_InterpretersGivenName[0]'),text('interpreter_business','Interpreter’s business or organization, if any','P6_Line2_NameofBusinessor[0]',False)],when=interpreter_when,instructionPages=[8])
other_naming = {'street':'a_StreetNumberName[0]','unit':'b_AptSteFlrNumber[0]','city':'c_CityTown[0]','state':'d_State[0]','zip':'e_ZipCode[0]','province':'f_Province[0]','postal':'g_PostalCode[0]','country':'h_Country[0]'}
address('interpreter',6,'3.a–3.h','What is the interpreter’s mailing address?',
  'Use the interpreter’s address. Complete the fields applicable to a U.S. or foreign address.',
  'P6_Line3','P6_checkbox3b_Unit',other_naming,when=interpreter_when,instructionPages=[8])
q('interpreter-contact',6,'4–6','What are the interpreter’s contact details?',
  'The interpreter provides a daytime telephone number and mobile number and email address if any.',
  [text('interpreter_phone','Daytime telephone number','P6_Line4_InterpretersDaytimePhoneNumber[0]',validation='phone'),text('interpreter_mobile','Mobile telephone number, if any','P6_Line4_InterpretersDaytimePhoneNumber[1]',False,validation='phone'),text('interpreter_email','Email address, if any','P6_Line5_InterpretersEmailAddress[0]',False,validation='email')],when=interpreter_when,instructionPages=[8])
preparer_when = {'field':'preparer_used','equals':'yes'}
q('preparer-details',7,'1.a–2','What are the preparer’s name and business details?',
  'The actual person who prepared the form must provide their information. If the same person was also the interpreter, both Parts 6 and 7 must be completed.',
  [text('preparer_family_name','Preparer’s family name','P7_Line1a_FamilyName[0]'),text('preparer_given_name','Preparer’s given name','P7_Line1b_PreparersGivenName[0]'),text('preparer_business','Preparer’s business or organization, if any','P7_Line2_NameofBusinessor[0]',False)],when=preparer_when,instructionPages=[9])
address('preparer',7,'3.a–3.h','What is the preparer’s mailing address?',
  'Use the preparer’s address. Complete the fields applicable to a U.S. or foreign address.',
  'P7_Line3','P7_checkbox3b_Unit',other_naming,when=preparer_when,instructionPages=[9])
q('preparer-contact',7,'4–6','What are the preparer’s contact details?',
  'The preparer provides a daytime telephone number and mobile number and email address if any.',
  [text('preparer_phone','Daytime telephone number','P7_Line4_PreparersDaytimePhoneNumber[0]',validation='phone'),text('preparer_mobile','Mobile telephone number, if any','P7_Line5_PreparersFaxNumber[0]',False,validation='phone'),text('preparer_email','Email address, if any','P7_Line6_PreparersEmailAddress[0]',False,validation='email')],when=preparer_when,instructionPages=[9])
q('preparer-statement',7,'7.a–7.b','Which statement applies to the preparer?',
  'The preparer must choose the statement that is true and review the certification before signing. Do not imply attorney status without that person’s confirmation.',
  [choice('preparer_status','Preparer’s statement',[('non-attorney','I am not an attorney or accredited representative but prepared this application on behalf of the applicant and with the applicant’s consent.','P7_checkbox7[0]'),('attorney','I am an attorney or accredited representative.','P7_checkbox7[1]')])],when=preparer_when,instructionPages=[9])
q('preparer-representation',7,'7.b','Does the preparer’s representation extend beyond preparing this form?',
  'The attorney or accredited representative must select the applicable option. The instructions explain when a separate Form G-28 may be required.',
  [choice('preparer_representation','Scope of representation',[('extends','Extends beyond preparing this application','P7_checkbox7Extend[0]'),('does-not-extend','Does not extend beyond preparing this application','P7_checkbox7Extend[1]')])],when={'all':[preparer_when,{'field':'preparer_status','equals':'attorney'}]},instructionPages=[9])

# All five official additional-information areas are accessible. Required
# explanations are cross-validated by part/item reference, never silently made up.
additional_specs = [('3','P8_Line3',0),('4','P8_Line5',1),('5','P8_Line4',0),('6','P8_Line5',0),('7','P8_Line5',2)]
for pos,(item,stem,index) in enumerate(additional_specs,1):
    suffix=f'[{index}]'
    q('additional-'+str(pos),8,item+'.a–'+item+'.d','Additional information '+str(pos),
      'Use this area if you need more room or must explain an answer. Enter the printed page, part and item that your explanation concerns. A Yes to Part 3, Item 4 or 5 requires a detailed explanation. If these five areas are not enough, the official instructions allow a separate sheet with your name, A-Number, page/part/item reference, signature and date.',
      [text('additional_'+str(pos)+'_page','Page number',stem+'a_PageNumber'+suffix,False),text('additional_'+str(pos)+'_part','Part number',stem+'b_PartNumber'+suffix,False),text('additional_'+str(pos)+'_item','Item number',stem+'c_ItemNumber'+suffix,False),text('additional_'+str(pos)+'_text','Additional information',stem+'d_AdditionalInfo'+suffix,False,type='textarea')],instructionPages=[2,8])

derived = []
for short,from_field,when in [
 ('P1_Line3a_FamilyName[1]','family_name',None),('P1_Line3b_GivenName[1]','given_name',None),('P1_Line3c_MiddleName[1]','middle_name',None),('P1_Line1_AlienNumber[1]','alien_number',None),('P6_Language[0]','interpreter_language',interpreter_when)]:
    d = {**mapping(short),'fromField':from_field}
    if when:
        d['when'] = when
    derived.append(d)

signing = []
for role,part,page,short,date,when in [
 ('Applicant',5,4,'P5_Line6a_SignatureofApplicant[0]','P5_Line6b_DateofSignature[0]',None),
 ('Interpreter',6,5,'P6_Line6a_Signature[0]','P6_Line6b_DateofSignature[0]',interpreter_when),
 ('Preparer',7,6,'P7_Line8a_SignatureofPreparer[0]','P7_Line8b_DateofSignature[0]',preparer_when)]:
    signing.append({'role':role,'part':part,'page':page,'instruction':f'{role}: review the full certification on printed page {page}, then sign in ink and enter the signing date. The app leaves both spaces blank. A typed name is not a signature.', 'blankPdfFields':[mapping(short)['name'],mapping(date)['name']],**({'when':when} if when else {})})
excluded = []
for field in widgets:
    if field['name'] not in used:
        assert field['disposition'] == 'barcode', field['name']
        used.add(field['name'])
        excluded.append({'name':field['name'],'reason':'USCIS barcode. Do not collect, generate or populate.'})
assert used == set(widget_by_name), (len(used),len(widget_by_name))

instructions_url = inventory['instructionsUrl']
with urllib.request.urlopen(urllib.request.Request(instructions_url,headers={'User-Agent':'Mozilla/5.0'}),timeout=45) as response:
    instruction_bytes = response.read()
assert instruction_bytes.startswith(b'%PDF-')
Path('/tmp/fillout-uscis-inventory/i-90instr.pdf').write_bytes(instruction_bytes)
output = {
 'schemaVersion':1,'id':'I-90','formId':'I-90','title':'Application to Replace Permanent Resident Card',
 'edition':inventory['edition'],'originalSha256':inventory['originalSha256'],
 'sourceUrl':inventory['sourceUrl'],'pdfUrl':inventory['sourcePdfUrl'],'instructionsUrl':instructions_url,
 'instructionsSha256':hashlib.sha256(instruction_bytes).hexdigest(),
 'sourceVerifiedAt':inventory['sourceVerification']['verifiedAt'],
 'coverageStatus':'mapped-input-locations',
 'coverageDescription':'Every widget in the verified seven-page blank I-90 has an explicit input mapping, derived-copy mapping, signing disposition or barcode exclusion. This establishes input-location coverage, not legal eligibility, evidence sufficiency or filing acceptance.',
 'generalHelp':'Answer fully and accurately. Follow the official directions for items that do not apply: generally N/A for a text response and None for a numeric zero/none, unless the item directs otherwise. Use Part 8 or a signed additional sheet if an answer does not fit. Review every page of the generated form, all instructions and supporting evidence before signing.',
 'questions':questions,'derived':derived,'signing':signing,'excluded':excluded,
 'printFields':[
   {'name':f['name'],'type':f['type'],'maxLength':f['maxLength'],
    'disposition':('barcode' if f['name'] in {e['name'] for e in excluded} else 'signature' if f['name'] in {n for s in signing for n in s['blankPdfFields']} else 'derived' if f['name'] in {d['name'] for d in derived} else 'answer'),
    'approvedForPrint':f['name'] not in {e['name'] for e in excluded} | {n for s in signing for n in s['blankPdfFields']}}
   for f in widgets
 ],
 'validationRules':[
   {'type':'additional-information','when':{'field':'removal_history','equals':'yes'},'requiredReference':{'page':'3','part':'3','item':'4'},'message':'Add a detailed explanation for Part 3, Item 4 in Part 8.'},
   {'type':'additional-information','when':{'field':'abandonment_history','equals':'yes'},'requiredReference':{'page':'3','part':'3','item':'5'},'message':'Add a detailed explanation for Part 3, Item 5 in Part 8.'},
   {'type':'additional-information-completeness','prefix':'additional_','count':5,'message':'Each additional-information entry needs a page, part, item and explanation.'},
   {'type':'address-completeness','prefixes':['mail','physical','interpreter','preparer'],'message':'For a U.S. address, enter state and ZIP code; for a foreign address, complete the applicable province/postal fields.'}
 ],
 'coverage':{'officialWidgets':len(widgets),'mappedAnswerWidgets':sum(len(f['pdfFields']) for q in questions for f in q['fields']),'derivedWidgets':len(derived),'blankSignatureAndDateWidgets':sum(len(s['blankPdfFields']) for s in signing),'excludedBarcodes':len(excluded)},
 'reviewNotes':[
   'Checkboxes are explicitly grouped using visible question labels. Each PDF checkbox retains its exact export state; do not write yes/no strings directly into PDF buttons.',
   'Read-only XFA-dependent fields remain included when they are applicant inputs. Their conditions are represented by interview rules rather than Adobe JavaScript.',
   'Weight is collected as one three-digit value and mapped to the three official digit widgets.',
   'The original field names for interpreter mobile phone, preparer mobile phone and Part 8 repeated entries do not match their printed numbering; mapping follows official tooltips and visible page text.',
   'Signature and signature-date fields are intentionally blank for the actual signer after printing. Preparer and interpreter certifications must not be inferred from AI use.',
   'The form page includes a never-received-card name-change option even though the instructions describe that branch differently; the interview preserves the printed form options.',
   'No field value may be silently truncated; PDF output must stop if an answer does not fit and direct the user to Part 8 or an additional sheet.'
 ]
}
(ROOT / 'data/uscis-i90-questionnaire.json').write_text(json.dumps(output,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({'questions':len(questions),'answerFields':sum(len(q['fields']) for q in questions),'coverage':output['coverage']},indent=2))
