'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('next/dist/build/swc');
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise,resolve,reject }; }
function compile(file, dependencies) {
  const filename = path.resolve(__dirname, '../..', file), sourceModule = { exports: {} };
  const code = transformSync(fs.readFileSync(filename,'utf8'), { filename, jsc: { parser: { syntax:'ecmascript',jsx:true }, transform:{ react:{runtime:'automatic'} } },module:{type:'commonjs'} }).code;
  vm.runInNewContext(code,{module:sourceModule,exports:sourceModule.exports,URLSearchParams, require(name) { assert.ok(name in dependencies,name); return dependencies[name]; }}); return sourceModule.exports;
}
const root='components/ng/referral-network/';
const patient={id:'patient-a',role:'patient',marketScope:'NG'};
function harness(file, drn, { exportName='default', props={}, auth={value:{user:patient,loading:false}} }={}) {
  let cursor=0,dirty=false,tree; const slots=[],effects=[];
  const react={ useState(initial) { const i=cursor++; slots[i] ||= {value:typeof initial==='function'?initial():initial}; return [slots[i].value,next=>{ slots[i].value=typeof next==='function'?next(slots[i].value):next;dirty=true; }]; },
    useRef(initial){ const i=cursor++;slots[i] ||= {value:{current:initial}};return slots[i].value; },
    useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((v,j)=>v!==old.deps[j])){const next={deps};slots[i]=next;effects.push(()=>{old?.cleanup?.();next.cleanup=fn();});}}
  };
  const jsx=(type,props,key)=>({type,props,key});
  const deps={react,'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':new Proxy({},{get:(_,n)=>Symbol(n)}),
    '@/components/providers/AuthProvider':{useAuth:()=>auth.value},'../drnApi':{drn,statusBadge:()=>'',urgencyBadge:()=>'',fmtNaira:String}};
  for(const tab of ['Overview','Marketplace','Compose','Inbox','Outbox','Agents','Heatmap','Commissions']) deps[`./tabs/${tab}Tab`]={__esModule:true,default:Symbol(tab)};
  const Component=compile(root+file,deps)[exportName];
  const view={render(runEffects=true){do{cursor=0;dirty=false;tree=Component(props);if(runEffects)for(const fn of effects.splice(0))fn();}while(runEffects&&dirty);return tree;},
    find(type){const out=[];function walk(n){if(Array.isArray(n))return n.forEach(walk);if(!n||typeof n!=='object')return;if(n.type===type)out.push(n);walk(n.props?.children);}walk(tree);return out;},
    text:()=>JSON.stringify(tree), button(label){return view.find('button').find(n=>strings(n.props.children).trim()===label);},unmount(){for(const s of slots)s?.cleanup?.();}};return view;
}
function strings(n){return Array.isArray(n)?n.map(strings).join(''):typeof n==='string'?n:n?.props?strings(n.props.children):'';}
async function flush(view){await new Promise(r=>setImmediate(r));view.render();}
const referral=(extras={})=>({id:'ref-a',ref_code:'Synthetic',specialty:'cardiology',status:'received',reason:'Synthetic reason',patient_name:'Synthetic patient',allowed_transitions:['accepted'],...extras});
const list=(drn,options={})=>harness('tabs/ReferralList.jsx',drn,{exportName:'ReferralWorklist',...options});

test('DRN transport uses guarded api.request and preserves body, query and errors',async()=>{
  const calls=[];const body={ok:true,referrals:[]};let fail=false;
  const {drn}=compile(root+'drnApi.js',{'@/lib/api':{__esModule:true,default:{async request(config){calls.push(config);if(fail)throw {response:{status:403,data:{error:'Denied',code:'FORBIDDEN'}}};return {data:body};}}}});
  assert.equal(await drn.listReferrals({status:'sent',absent:null}),body);
  assert.equal(calls[0].url,'/ng/referral-network/referrals?status=sent');assert.equal(calls[0].method,'GET');
  await drn.transition('ref-a',{to_status:'accepted'});assert.equal(calls[1].method,'POST');assert.equal(calls[1].data.to_status,'accepted');assert.equal(calls[1].body,undefined);
  fail=true;await assert.rejects(drn.getReferral('ref-a'),e=>e.status===403&&e.message==='Denied'&&e.body.code==='FORBIDDEN');
});
test('portal and worklist shells gate auth and synchronously replace account/role-keyed children',()=>{
  for(const file of ['ReferralNetworkPortal.jsx','tabs/ReferralList.jsx']){
    const auth={value:{user:patient,loading:true}},view=harness(file,{}, {auth});
    assert.equal(view.render().props.role,'status');
    auth.value={user:patient,loading:false};const a=view.render();
    auth.value={user:{...patient,id:'patient-b'},loading:false};const b=view.render(false);assert.notEqual(a.key,b.key);
    auth.value={user:{...patient,role:'provider'},loading:false};assert.notEqual(a.key,view.render(false).key);
    auth.value={user:{...patient,marketScope:'US'},loading:false};assert.equal(view.render().props.role,'status');
    auth.value={user:null,loading:false};assert.equal(view.render().props.role,'status');
  }
});
test('worklist exposes only explicit server action hints and labels unlinked identity',async()=>{
  const view=list({async listReferrals(){return {ok:true,referrals:[referral({allowed_transitions:[]}),referral({id:'ref-b',patient_user_id:'patient-a',allowed_transitions:['cancelled']})]};}});
  view.render();await flush(view);assert.equal(view.button('accepted'),undefined);assert.equal(view.button('received'),undefined);assert.ok(view.button('cancelled'));
  assert.ok(view.text().includes('Unlinked patient details—not identity verified'));assert.ok(view.text().includes('Linked patient record'));
});
test('older refresh cannot replace confirmed mutation and same-render repeated action writes once',async()=>{
  const pending=deferred(),mutation=deferred();let reads=0,writes=0;
  const view=list({listReferrals(){return ++reads===1?Promise.resolve({ok:true,referrals:[referral()]}):pending.promise;},transition(){writes++;return mutation.promise;}});
  view.render();await flush(view);const refresh=view.button('Refresh').props.onClick();view.render();
  const click=view.button('accepted').props.onClick;const first=click();await click();assert.equal(writes,1);
  mutation.resolve({ok:true,referral:referral({status:'accepted',allowed_transitions:['scheduled']})});await first;await flush(view);
  pending.resolve({ok:true,referrals:[referral()]});await refresh;await flush(view);
  assert.ok(view.button('scheduled'));assert.equal(view.button('accepted'),undefined);
});
test('failed or unconfirmed mutation never invents success state and missing updated hints clear controls',async()=>{
  let result={ok:false};const view=list({async listReferrals(){return {ok:true,referrals:[referral()]};},async transition(){return result;}});
  view.render();await flush(view);await view.button('accepted').props.onClick();await flush(view);assert.ok(view.text().includes('could not be confirmed'));assert.ok(view.button('accepted'));
  result={ok:true,referral:referral({status:'accepted',allowed_transitions:undefined})};await view.button('accepted').props.onClick();await flush(view);assert.equal(view.button('accepted'),undefined);assert.equal(view.button('scheduled'),undefined);
});
test('late read or mutation from prior mode/account cannot change new worklist',async()=>{
  const first=deferred(),post=deferred();let reads=0;const props={mode:'inbox',session:{current:'a'},accountKey:'a'};
  const view=list({listReferrals(){reads++;return reads===1?first.promise:Promise.resolve({ok:true,referrals:[referral({id:'ref-b',reason:'New mode'})]});},transition(){return post.promise;}},{props});
  view.render();props.mode='outbox';view.render();await flush(view);first.resolve({ok:true,referrals:[referral({reason:'Stale private row'})]});await flush(view);assert.equal(view.text().includes('Stale private row'),false);
  const send=view.button('accepted').props.onClick();props.session.current='b';post.resolve({ok:true,referral:referral({id:'ref-b',reason:'Old account result',status:'accepted'})});await send;await flush(view);assert.equal(view.text().includes('Old account result'),false);
  view.unmount();
});
test('unmounted worklist ignores delayed failure',async()=>{
  const read=deferred();const view=list({listReferrals:()=>read.promise});view.render();view.unmount();read.reject(new Error('Late private error'));await flush(view);assert.equal(view.text().includes('Late private error'),false);
});
const draftRow = () => referral({status:'draft',allowed_transitions:['sent']});
const matchRow = { id:'listing-a',organization_id:'org-a',title:'Synthetic listing',specialty:'cardiology',reasons:['Synthetic match'] };
function compose(drn){return harness('tabs/ComposeTab.jsx',drn);}
async function prepareCompose(view){
  view.render();view.find('input').find(n=>n.props.placeholder).props.onChange({target:{value:'Synthetic reason'}});view.render();
  await view.button('Find matches').props.onClick();await flush(view);view.find('li')[0].props.onClick();view.render();
}
const matching = async()=>({ok:true,matches:[matchRow]});
test('composer same-render clicks create once and retains confirmed draft before failed send; retry checks same ID',async()=>{
  const pending=deferred();let creates=0,sends=0,gets=0;
  const view=compose({match:matching,createReferral(body){creates++;assert.equal(body.destination_listing,'listing-a');assert.equal(body.service_fee_naira,undefined);return pending.promise;},
    async transition(id){assert.equal(id,'ref-a');if(++sends===1)throw new Error('Lost send acknowledgement');return {ok:true,referral:referral({status:'sent'})};},
    async getReferral(id){gets++;assert.equal(id,'ref-a');return {ok:true,referral:draftRow()};}});
  await prepareCompose(view);const click=view.button('Send referral').props.onClick;const first=click();await click();assert.equal(creates,1);
  pending.resolve({ok:true,referral:draftRow()});await first;await flush(view);
  assert.ok(view.text().includes('draft saved'));assert.ok(view.text().includes('Send not confirmed'));assert.equal(view.text().includes('receiving facility has been notified'),false);
  assert.equal(view.button('Send referral'),undefined);
  await view.button('Check status and retry sending saved draft').props.onClick();await flush(view);
  assert.equal(creates,1);assert.equal(sends,2);assert.equal(gets,1);assert.ok(view.text().includes('sent'));
});
test('composer reconciles an uncertain send already sent without repeating creation or transition',async()=>{
  let creates=0,sends=0;
  const view=compose({match:matching,async createReferral(){creates++;return {ok:true,referral:draftRow()};},async transition(){sends++;throw new Error('Lost response');},async getReferral(){return {ok:true,referral:referral({status:'sent'})};}});
  await prepareCompose(view);await view.button('Send referral').props.onClick();await flush(view);
  await view.button('Check status and retry sending saved draft').props.onClick();await flush(view);
  assert.equal(creates,1);assert.equal(sends,1);assert.equal(view.button('Check status and retry sending saved draft'),undefined);
});
test('ambiguous creation cannot be resubmitted and directs user to Outbox without fabricating a draft',async()=>{
  let creates=0;const view=compose({match:matching,async createReferral(){creates++;throw new Error('Connection lost');}});
  await prepareCompose(view);const click=view.button('Send referral').props.onClick;await click();await flush(view);await click();
  assert.equal(creates,1);assert.equal(view.button('Send referral').props.disabled,true);assert.ok(view.text().includes('Check Outbox'));assert.equal(view.text().includes('draft saved'),false);
});
test('composer clears stale match selection on changed criteria and discards delayed old matching response',async()=>{
  const pending=deferred();let matches=0;
  const view=compose({match(){return ++matches===1?matching():pending.promise;}});
  await prepareCompose(view);assert.equal(view.button('Send referral').props.disabled,false);
  view.find('input').find(n=>n.props.value==='cardiology').props.onChange({target:{value:'neurology'}});view.render();assert.equal(view.button('Send referral').props.disabled,true);assert.equal(view.find('li').length,0);
  const request=view.button('Find matches').props.onClick();view.render();
  view.find('input').find(n=>n.props.value==='neurology').props.onChange({target:{value:'cardiology'}});view.render();
  pending.resolve({ok:true,matches:[matchRow]});await request;await flush(view);assert.equal(view.find('li').length,0);
});
test('composer unmount after confirmed creation cannot issue a follow-on send or publish saved data',async()=>{
  const pending=deferred();let sends=0;const view=compose({match:matching,createReferral:()=>pending.promise,async transition(){sends++;}});
  await prepareCompose(view);const request=view.button('Send referral').props.onClick();view.render();view.unmount();
  pending.resolve({ok:true,referral:draftRow()});await request;await flush(view);assert.equal(sends,0);assert.equal(view.text().includes('draft saved'),false);
});
test('composer QR requests are synchronously guarded and available only after confirmed sending',async()=>{
  const pending=deferred();let qr=0;const view=compose({match:matching,async createReferral(){return {ok:true,referral:draftRow()};},async transition(){return {ok:true,referral:referral({status:'sent'})};},mintQr(){qr++;return pending.promise;}});
  await prepareCompose(view);assert.equal(view.button('Mint patient QR slip'),undefined);await view.button('Send referral').props.onClick();await flush(view);
  const click=view.button('Mint patient QR slip').props.onClick;const request=click();await click();assert.equal(qr,1);
  pending.resolve({token:'synthetic-token',prefix:'synthetic',expires_at:'2099-01-01'});await request;await flush(view);assert.ok(view.text().includes('synthetic-token'));
});


test('ordinary patient/provider referral landing does not request privileged KPI or agent panels', () => {
 for(const role of ['patient','provider']) {
  const view=harness('ReferralNetworkPortal.jsx',{}, {exportName:'ReferralNetworkWorkspace',props:{role,initialTab:'overview'}});
  view.render();assert.equal(view.button('Overview'),undefined);assert.equal(view.button('Agents'),undefined);assert.equal(view.button('Commissions'),undefined);
  assert.ok(view.button('Compose'));assert.ok(view.button(role==='provider'?'Inbox':'Outbox').props.className.includes('border-blue-600'));
 }
 const admin=harness('ReferralNetworkPortal.jsx',{}, {exportName:'ReferralNetworkWorkspace',props:{role:'admin'}});
 admin.render();assert.ok(admin.button('Overview'));assert.equal(admin.button('Compose'),undefined);
});
