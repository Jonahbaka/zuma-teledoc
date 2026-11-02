'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { transformSync } = require('next/dist/build/swc');
const file = path.resolve(__dirname, '../../app/(dashboard)/patient/appointments/book/page.js');
const patient={id:'patient-a',role:'patient',marketScope:'NG'};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function text(n){return Array.isArray(n)?n.map(text).join(''):typeof n==='string'?n:n?.props?text(n.props.children):'';}
function harness({post=async()=>({data:{success:true,appointment:{id:'saved-a'}}}),get=async()=>({data:{success:true,providers:[]}}),shell=false,storage=new Map(),auth={value:{user:patient,loading:false}}}={}) {
  let cursor=0,dirty=false,tree;const slots=[],effects=[],pushes=[],toasts=[],writes=[],reads=[];
  const props={market:'NG',session:{current:'scope-a'},accountKey:'scope-a'};
  const react={useState(initial){const i=cursor++;slots[i]||={value:typeof initial==='function'?initial():initial};return[slots[i].value,v=>{slots[i].value=typeof v==='function'?v(slots[i].value):v;dirty=true;}];},
    useRef(v){const i=cursor++;slots[i]||={value:{current:v}};return slots[i].value;},
    useCallback(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>v!==old.deps[j]))slots[i]={value:fn,deps};return slots[i].value;},
    useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>v!==old.deps[j])){const next={deps};slots[i]=next;effects.push(()=>{old?.cleanup?.();next.cleanup=fn();});}}};
  const jsx=(type,props,key)=>({type,props,key});
  const deps={react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'next/navigation':{useRouter:()=>({push:p=>pushes.push(p)})},
    '@/components/providers/AuthProvider':{useAuth:()=>auth.value},'lucide-react':new Proxy({},{get:(_,n)=>Symbol(n)}),
    '@/lib/api':{__esModule:true,default:{get:(...a)=>{reads.push(a[0]);return get(...a);},post:(...a)=>{writes.push(a);return post(...a);}},triageAPI:{}},
    '@/lib/doctaService':{DoctaService:{runAITriage:async()=>({})}},'@/components/ui/button':{Button:'button'},'@/components/ui/input':{Input:'input'},'@/components/ui/label':{Label:'label'},
    '@/components/ui/card':{Card:'div',CardContent:'div',CardDescription:'div',CardHeader:'div',CardTitle:'h2'},'@/components/ui/use-toast':{toast:t=>toasts.push(t)},'@/components/branding/DoctaRxLogo':{__esModule:true,default:'logo'}};
  const mod={exports:{}};
  const code=transformSync(fs.readFileSync(file,'utf8'),{filename:file,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}).code;
  vm.runInNewContext(code,{module:mod,exports:mod.exports,require:n=>{assert.ok(n in deps,n);return deps[n];},crypto,console,sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}});
  const Component=shell?mod.exports.default:mod.exports.BookingWorkspace;
  const view={props,pushes,toasts,writes,reads,render(runEffects=true){let turns=0;do{assert.ok(turns++<20);cursor=0;dirty=false;tree=Component(props);if(runEffects)for(const f of effects.splice(0))f();}while(runEffects&&dirty);return tree;},
    set(i,v){slots[i].value=v;},find(type){const out=[];function walk(n){if(Array.isArray(n))return n.forEach(walk);if(!n?.props)return;if(n.type===type)out.push(n);walk(n.props.children);}walk(tree);return out;},button(label){return view.find('button').find(n=>text(n).trim()===label);},text:()=>text(tree),unmount(){for(const s of slots)s?.cleanup?.();}};
  return view;
}
async function flush(view){await new Promise(r=>setImmediate(r));view.render();}
async function ready(view){view.render();await flush(view);view.set(0,6);view.set(2,{id:'primary_care',name:'Synthetic category',specialties:['General Practice']});view.set(3,'Synthetic symptoms');view.set(13,'2030-01-02');view.render();await flush(view);view.set(14,'12:00');view.set(11,true);view.render();}
test('booking shell immediately isolates account/market and hides workspace on logout',()=>{
 const auth={value:{user:patient,loading:false}},view=harness({shell:true,auth});const a=view.render();auth.value={user:{...patient,id:'patient-b'},loading:false};const b=view.render(false);assert.notEqual(a.key,b.key);assert.equal(a.props.session.current,b.key);auth.value={user:null,loading:false};assert.equal(view.render(false).props.role,'status');
});
test('same-render repeated booking sends once with request UUID; confirmed appointment is not recreated',async()=>{
 const pending=deferred(),view=harness({post:()=>pending.promise});await ready(view);const submit=view.button('Request Consultation').props.onClick;const a=submit();await submit();assert.equal(view.writes.length,1);assert.match(view.writes[0][1].clientRequestId,/^[0-9a-f-]{36}$/);pending.resolve({data:{success:true,appointment:{id:'saved-a'}}});await a;view.render();await submit();assert.equal(view.writes.length,1);assert.ok(view.text().includes('saved-a'));assert.equal(view.pushes.length,1);
});
test('ambiguous create blocks retry and instructs reconciliation without resubmitting',async()=>{
 const view=harness({post:async()=>{throw new Error('Synthetic network loss');}});await ready(view);const submit=view.button('Request Consultation').props.onClick;await submit();view.render();await submit();assert.equal(view.writes.length,1);assert.ok(view.text().includes('Booking outcome is uncertain'));assert.ok(view.button('Check my appointments'));assert.equal(view.pushes.length,0);
});
test('confirmed rejection retains key for identical retry, changing intent rotates key',async()=>{
 const view=harness({post:async()=>{throw {response:{status:409,data:{error:'Slot unavailable'}}};}});await ready(view);await view.button('Request Consultation').props.onClick();view.render();await view.button('Request Consultation').props.onClick();assert.equal(view.writes[0][1].clientRequestId,view.writes[1][1].clientRequestId);view.set(3,'Changed synthetic symptoms');view.render();view.set(11,true);view.render();await view.button('Request Consultation').props.onClick();assert.notEqual(view.writes[1][1].clientRequestId,view.writes[2][1].clientRequestId);
});
test('navigation before late booking acknowledgement prevents toast, redirect and follow-on PHI writes',async()=>{
 const pending=deferred(),view=harness({post:()=>pending.promise});await ready(view);const write=view.button('Request Consultation').props.onClick();view.button('Cancel').props.onClick();pending.resolve({data:{success:true,appointment:{id:'old-account-saved'}}});await write;assert.equal(view.pushes.length,1);assert.equal(view.toasts.length,0);assert.equal(view.writes.length,1);assert.ok(!view.text().includes('old-account-saved'));
});
test('late provider list from previous account is discarded',async()=>{
 const pending=deferred(),view=harness({get:()=>pending.promise});view.render();view.props.session.current='scope-b';pending.resolve({data:{success:true,providers:[{id:'private-provider',firstName:'Private'}]}});await flush(view);assert.ok(!view.text().includes('Private'));
});
test('coverage step collects no insurance/files and calls no nonexistent endpoints',async()=>{
 const view=harness();view.render();await flush(view);view.set(0,5);view.render();assert.ok(view.text().includes('Insurance saving and document uploads are unavailable'));assert.equal(view.find('input').filter(n=>n.props.type==='file').length,0);assert.ok(!view.reads.includes('/users/me/insurance'));assert.equal(view.writes.length,0);
});

test('opaque unresolved marker survives remount, blocks fresh submission and stores no clinical details',async()=>{
 const storage=new Map(),view=harness({storage,post:async()=>{throw Error('Lost response');}});await ready(view);await view.button('Request Consultation').props.onClick();
 const marker=JSON.parse([...storage.values()][0]);assert.deepEqual(Object.keys(marker),['requestId']);assert.match(marker.requestId,/^[0-9a-f-]{36}$/);assert.ok(!JSON.stringify([...storage]).includes('Synthetic symptoms'));
 view.unmount();const reload=harness({storage});await ready(reload);await reload.button('Request Consultation').props.onClick();assert.equal(reload.writes.length,0);assert.ok(reload.button('Check my appointments'));
});
test('confirmed save and definite rejection clear markers; intent conflicts retain them',async()=>{
 for(const outcome of ['saved','rejected','conflict']){const storage=new Map(),view=harness({storage,post:async()=>{if(outcome==='saved')return{data:{success:true,appointment:{id:'saved'}}};throw{response:{status:409,data:{code:outcome==='conflict'?'BOOKING_INTENT_CONFLICT':'APPOINTMENT_CONFLICT'}}};}});await ready(view);await view.button('Request Consultation').props.onClick();assert.equal(storage.size,outcome==='conflict'?1:0);}
});
test('unavailable session storage fails closed before sending a booking',async()=>{
 const storage={get(){throw Error('Disabled');}},view=harness({storage});await ready(view);await view.button('Request Consultation').props.onClick();assert.equal(view.writes.length,0);assert.ok(view.text().includes('Booking is unavailable'));
});

test('reload reconciles opaque request to confirmed saved ID without posting or redirecting',async()=>{
 const id=crypto.randomUUID(),requestId=crypto.randomUUID(),storage=new Map([['doctarx:booking-unresolved:scope-a',JSON.stringify({requestId})]]);
 const view=harness({storage,get:async url=>url.includes('/booking-requests/')?{data:{success:true,appointment:{id,status:'scheduled'}}}:{data:{providers:[]}}});
 await ready(view);assert.ok(view.reads.includes(`/appointments/booking-requests/${requestId}`));assert.equal(storage.size,0);assert.ok(view.text().includes(id));assert.equal(view.writes.length,0);assert.equal(view.pushes.length,0);
});
test('missing lookup retains barrier and explicit retry reconciles once without booking',async()=>{
 const id=crypto.randomUUID(),requestId=crypto.randomUUID(),storage=new Map([['doctarx:booking-unresolved:scope-a',JSON.stringify({requestId})]]);let count=0;const pending=deferred();
 const view=harness({storage,get:async url=>{if(!url.includes('/booking-requests/'))return{data:{providers:[]}};if(++count===1)throw{response:{status:404}};return pending.promise;}});await ready(view);assert.equal(storage.size,1);
 const retry=view.button('Check saved request').props.onClick;const work=retry();await retry();assert.equal(count,2);pending.resolve({data:{success:true,appointment:{id}}});await work;view.render();assert.equal(storage.size,0);assert.ok(view.text().includes(id));assert.equal(view.writes.length,0);
});
test('late request reconciliation after account change neither reveals saved ID nor clears marker',async()=>{
 const id=crypto.randomUUID(),requestId=crypto.randomUUID(),storage=new Map([['doctarx:booking-unresolved:scope-a',JSON.stringify({requestId})]]),pending=deferred();
 const view=harness({storage,get:url=>url.includes('/booking-requests/')?pending.promise:Promise.resolve({data:{providers:[]}})});view.render();view.props.session.current='scope-b';pending.resolve({data:{success:true,appointment:{id}}});await flush(view);assert.equal(storage.size,1);assert.ok(!view.text().includes(id));assert.equal(view.writes.length,0);
});
