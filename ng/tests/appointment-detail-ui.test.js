'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('next/dist/build/swc');
const file = path.resolve(__dirname, '../../app/(dashboard)/patient/appointments/[id]/page.js');
const patient = { id: 'patient-a', role: 'patient', marketScope: 'US', accessLevel: 'pay_per_visit' };
const row = { id: 'appointment-a', status: 'scheduled', type: 'video', scheduledAt: '2030-01-01', reasonForVisit: 'Synthetic private appointment' };
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise,resolve,reject }; }
function text(n) { return Array.isArray(n) ? n.map(text).join('') : typeof n === 'string' ? n : n?.props ? text(n.props.children) : ''; }
function harness({ api = {}, payments = {}, shell = false, auth = { value: { user: patient, loading: false } }, params = { id: row.id }, confirmResult = true } = {}) {
  let cursor=0, dirty=false, tree; const slots=[], effects=[], pushes=[], toasts=[]; let confirms=0;
  const props = { appointmentId: row.id, accountKey: 'scope-a', session: { current: 'scope-a' }, user: patient };
  const react = {
    useState(initial) { const i=cursor++; slots[i] ||= { value: typeof initial==='function' ? initial() : initial }; return [slots[i].value, next => { slots[i].value=typeof next==='function'?next(slots[i].value):next; dirty=true; }]; },
    useRef(initial) { const i=cursor++; slots[i] ||= { value: { current: initial } }; return slots[i].value; },
    useEffect(fn,deps) { const i=cursor++,old=slots[i]; if(!old || deps.some((v,j)=>v!==old.deps[j])) { const next={deps}; slots[i]=next; effects.push(()=>{old?.cleanup?.();next.cleanup=fn();}); } },
  };
  const jsx=(type,props,key)=>({type,props,key});
  const dependencies = {
    react, 'react/jsx-runtime': { jsx,jsxs:jsx }, 'next/navigation': { useParams:()=>params, useRouter:()=>({push:url=>pushes.push(url)}) },
    'next/link': { __esModule:true, default:'a' }, 'lucide-react':new Proxy({},{get:(_,name)=>Symbol(name)}),
    '@/lib/api': { __esModule:true, default:{ get:async()=>({data:{success:true,appointment:row}}), ...api }, paymentsAPI:{ getAppointmentPayment:async()=>({data:{success:true,paymentRequired:true,paymentCompleted:false}}), ...payments } },
    '@/components/providers/AuthProvider': { useAuth:()=>auth.value }, '@/components/ui/button':{Button:'button'},
    '@/components/ui/card':{Card:'div',CardContent:'div',CardHeader:'div',CardTitle:'h2'},
    '@/lib/utils':{formatDateTime:String,formatTime:String}, '@/components/ui/use-toast':{toast:value=>toasts.push(value)},
  };
  const mod={exports:{}};
  const code=transformSync(fs.readFileSync(file,'utf8'),{filename:file,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}).code;
  vm.runInNewContext(code,{module:mod,exports:mod.exports,require:name=>{assert.ok(name in dependencies,name);return dependencies[name];},confirm:()=>{confirms++;return confirmResult;},console});
  const Component=shell?mod.exports.default:mod.exports.AppointmentDetailWorkspace;
  const view={props,pushes,toasts,confirms:()=>confirms, render(runEffects=true){do{cursor=0;dirty=false;tree=Component(props);if(runEffects)for(const f of effects.splice(0))f();}while(runEffects&&dirty);return tree;},
    find(type){const out=[];function walk(n){if(Array.isArray(n))return n.forEach(walk);if(!n||typeof n!=='object')return;if(n.type===type)out.push(n);walk(n.props?.children);}walk(tree);return out;},
    button(label){return view.find('button').find(n=>text(n.props.children).trim()===label);},text:()=>text(tree),unmount(){for(const slot of slots)slot?.cleanup?.();}};
  return view;
}
async function flush(view){await new Promise(resolve=>setImmediate(resolve));view.render();}
test('render boundary replaces account/appointment/role workspace before effects and hides PHI while signed out',()=>{
  const auth={value:{user:patient,loading:false}},params={id:row.id};const view=harness({shell:true,auth,params});
  const first=view.render();params.id='appointment-b';const moved=view.render(false);assert.notEqual(first.key,moved.key);assert.equal(first.props.session.current,moved.key);
  auth.value={user:{...patient,id:'patient-b'},loading:false};assert.notEqual(moved.key,view.render(false).key);
  auth.value={user:{...patient,role:'provider'},loading:false};assert.equal(view.render(false).props.role,'status');
  auth.value={user:null,loading:false};assert.equal(view.render(false).props.role,'status');
});
test('late appointment/payment reads after account navigation cannot expose old records or errors',async()=>{
  const detail=deferred(),payment=deferred();const view=harness({api:{get:()=>detail.promise},payments:{getAppointmentPayment:()=>payment.promise}});
  view.render();view.props.session.current='scope-b';detail.resolve({data:{success:true,appointment:row}});payment.reject(new Error('Old payment error'));
  await flush(view);assert.ok(!view.text().includes(row.reasonForVisit));assert.equal(view.toasts.length,0);
});
test('unavailable direct collection has no amount promise or payment action', async () => {
  let pays = 0;
  const view = harness({ payments: { payPerVisit: async () => { pays++; } } });
  view.render(); await flush(view);
  assert.equal(view.button('Pay $79 to Join'), undefined);
  assert.ok(view.text().includes('Direct payment collection is unavailable'));
  assert.equal(pays, 0);
});
test('server-approved coverage and test access allow joining without claiming a paid receipt', async () => {
  for (const testingBypassActive of [false, true]) {
    const view = harness({ payments: { getAppointmentPayment: async () => ({ data: { success: true, paymentRequired: false, paymentCompleted: false, coverageApproved: true, testingBypassActive } }) } });
    view.render(); await flush(view);
    assert.ok(view.button('Join Video Call'));
    assert.ok(!view.text().includes('Payment completed.'));
    assert.ok(view.text().includes(testingBypassActive ? 'not a payment receipt' : 'Coverage approved'));
  }
});
test('cancel repeats are synchronously guarded and late success cannot redirect newer navigation',async()=>{
  const pending=deferred();let writes=0;const view=harness({api:{put:()=>{writes++;return pending.promise;}}});view.render();await flush(view);
  const cancel=view.button('Cancel Appointment').props.onClick;const first=cancel();await cancel();assert.equal(writes,1);assert.equal(view.confirms(),1);
  view.unmount();pending.resolve({data:{success:true,appointment:{...row,status:'cancelled'}}});await first;assert.equal(view.pushes.length,0);assert.equal(view.toasts.length,0);
});
test('dismissed confirmation sends nothing and current confirmed cancellation redirects without refund claim',async()=>{
  let writes=0;const dismissed=harness({confirmResult:false,api:{put:async()=>{writes++;}}});dismissed.render();await flush(dismissed);await dismissed.button('Cancel Appointment').props.onClick();assert.equal(writes,0);
  const view=harness({api:{put:async()=>({data:{success:true,appointment:{...row,status:'cancelled'}}})}});view.render();await flush(view);await view.button('Cancel Appointment').props.onClick();await flush(view);
  assert.deepEqual(view.pushes,['/patient/appointments']);assert.equal(view.button('Cancel Appointment'),undefined);assert.ok(!JSON.stringify(view.toasts).toLowerCase().includes('refund'));
});
test('failed or mismatched cancellation acknowledgement does not redirect or invent cancelled status',async()=>{
  const view=harness({api:{put:async()=>({data:{success:true,appointment:{...row,id:'other',status:'cancelled'}}})}});view.render();await flush(view);await view.button('Cancel Appointment').props.onClick();await flush(view);
  assert.equal(view.pushes.length,0);assert.ok(view.button('Cancel Appointment'));assert.equal(view.toasts.at(-1).title,'Cancel Failed');
});
