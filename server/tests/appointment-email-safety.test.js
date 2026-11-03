'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function fixture(){
 const sent=[];const mod={exports:{}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../services/email'),'utf8'),{module:mod,exports:mod.exports,process:{env:{SMTP_HOST:'smtp.example.invalid',SMTP_PORT:'587',SMTP_FROM:'synthetic@example.invalid',NEXT_PUBLIC_APP_URL:'https://example.invalid'}},require:name=>{
 if(name==='nodemailer')return{createTransport:()=>({sendMail:async mail=>{sent.push(mail);return{messageId:'synthetic'};}})};
 if(name==='../middleware/logger')return{info(){},error(){}};throw Error(name);
 }});return{sent,send:mod.exports.sendAppointmentNotification};
}
test('all standard appointment email types omit clinical narratives from HTML and text',async()=>{
 const f=fixture();for(const type of ['created','updated','reminder','cancelled'])await f.send({id:'visit',scheduledAt:'2030-01-01T12:00:00Z',type:'video',durationMinutes:30,patientFirstName:'Synthetic',patientLastName:'Patient',providerFirstName:'Synthetic',providerLastName:'Provider',reasonForVisit:'PRIVATE_REASON',patientNotes:'PRIVATE_PATIENT',providerNotes:'PRIVATE_PROVIDER',metadata:{triage:'PRIVATE_TRIAGE'}},{id:'recipient',email:'recipient@example.invalid',firstName:'Synthetic',role:'provider'},type);
 assert.equal(f.sent.length,4);for(const mail of f.sent){assert.equal(mail.to,'recipient@example.invalid');assert.ok(mail.html.includes('Video Consultation'));assert.ok(mail.html.includes('2030'));for(const secret of ['PRIVATE_REASON','PRIVATE_PATIENT','PRIVATE_PROVIDER','PRIVATE_TRIAGE'])assert.ok(!JSON.stringify(mail).includes(secret));}
});
test('appointment email escapes supplied display text and encodes appointment URL segments',async()=>{
 const f=fixture();await f.send({id:'visit/"<img src=x>',scheduledAt:'2030-01-01T12:00:00Z',type:'<img src=x>',durationMinutes:'<b>30</b>',providerFirstName:'<script>name</script>',providerLastName:'A&B'}, {id:'recipient',email:'recipient@example.invalid',firstName:'<img src=x>',role:'patient'},'created');
 const mail=f.sent[0];assert.ok(mail.html.includes('&lt;script&gt;name&lt;/script&gt; A&amp;B'));assert.ok(mail.html.includes('&lt;img src=x&gt;'));assert.ok(mail.html.includes('&lt;b&gt;30&lt;/b&gt;'));assert.ok(!mail.html.includes('<script>'));assert.ok(!mail.html.includes('<img src=x>'));assert.ok(mail.html.includes('/patient/appointments/visit%2F%22%3Cimg%20src%3Dx%3E'));assert.equal(mail.subject,'✅ Appointment Confirmed');
});
