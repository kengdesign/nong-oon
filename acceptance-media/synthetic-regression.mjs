// Fixed, authored regression expectations, not provider transcripts or human gold.
export const cases=[
 {layout:'blister',kind:'printed_label',text:'TESTBLISTER 5 mg',known:{label:'TESTBLISTER',strength:'5 mg'}},
 {layout:'bottle',kind:'printed_label',text:'TESTBOTTLE 10 mg',known:{label:'TESTBOTTLE',strength:'10 mg'}},
 {layout:'sachet',kind:'printed_label',text:'TESTSACHET 20 mg',known:{label:'TESTSACHET',strength:'20 mg'}},
 {layout:'blister',kind:'printed_label',text:'Berlin 20 mg',known:{label:null,strength:null}},
 {layout:'blister',kind:'printed_label',text:'TESTBLISTER 5 mg\nTESTBOTTLE 10 mg',known:{label:null,strength:null}},
 {layout:'sachet',kind:'printed_label',text:'ชื่อยา: TESTSACHET\nความแรง: 20 mg',known:{label:'TESTSACHET',strength:'20 mg'}},
 {layout:'sachet',kind:'printed_label',text:'ชื่อยา: A\nชื่อยา: B',known:{label:null}},
 {layout:'bottle',kind:'printed_label',text:'TESTBOTTLE 10 mg\nเมื่อมีอาการ',known:{label:'TESTBOTTLE',times:null,useMode:'as_needed'}},
 {layout:'voice',kind:'voice',text:'ชื่อยา: TESTVOICE\nความแรง: 5 mg',known:{label:'TESTVOICE',strength:'5 mg'}},
 {layout:'voice',kind:'voice',text:'เวลา: 25:00',known:{times:null}},
 {layout:'voice',kind:'voice',text:'เวลา: 08:00\nเมื่อมีอาการ',known:{times:null,useMode:'as_needed'}},
 {layout:'voice',kind:'voice',text:'กินยาตอนเช้า',known:{label:null,times:null,dose:null}},
 {layout:'voice',kind:'voice',text:'อย่ากินยานี้เพิ่ม',known:{times:null,dose:null}},
 {layout:'voice',kind:'voice',text:'',known:{label:null,strength:null,times:null}},
 {layout:'bottle',kind:'printed_label',text:'EXP 2027-01\nLOT 12345',known:{label:null,startDate:null,endDate:null}},
];
