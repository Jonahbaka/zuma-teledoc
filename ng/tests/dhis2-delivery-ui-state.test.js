'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {transformSync}=require('next/dist/build/swc');
const buttonType=Symbol('Button');
const actorA={id:'reviewer-a',role:'provider',marketScope:'NG'},actorB={id:'reviewer-b',role:'provider',marketScope:'NG'};
const reportA={id:'report-a',facility_name:'Authorized facility A',report_period:'2026-09',status:'sync_failed',permissions:{approve:true,export:true}};
const reportB={id:'report-b',facility_name:'Authorized facility B',report_period:'2026-10',status:'sync_failed',permissions:{approve:true,export:true}};
const jobA={id:'job-a',reportId:reportA.id,status:'failed',attempts:8,version:3,operatorRetryBudget:0,result:{code:'REQUIRES_REVIEW'}};
const pending=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const text=value=>Array.isArray(value)?value.map(text).join(''):typeof value==='string'?value:value?.props?text(value.props.children):'';
function harness(auth,api){
  const slots=[],effects=[];let cursor=0,dirty=false,tree;
  const react={
    useState(initial){const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return[slots[index].value,next=>{slots[index].value=typeof next==='function'?next(slots[index].value):next;dirty=true;}];},
    useRef(initial){const index=cursor++;if(!slots[index])slots[index]={value:{current:initial}};return slots[index].value;},
    useEffect(callback,dependencies){const index=cursor++,previous=slots[index];if(!previous||dependencies.some((value,offset)=>value!==previous.dependencies[offset])){const next={dependencies,cleanup:null};slots[index]=next;effects.push(()=>{previous?.cleanup?.();next.cleanup=callback();});}},
  };
  const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
  const dependencies={react,'react/jsx-runtime':jsx,'lucide-react':new Proxy({},{get:(_target,key)=>Symbol(String(key))}),
    '@/lib/api':{__esModule:true,default:api},'@/components/providers/AuthProvider':{useAuth:()=>auth.value},
    '@/components/branding/PortalPageHeader':{__esModule:true,default:Symbol('Header')},'@/components/ui/button':{Button:buttonType}};
  const filename=path.resolve(__dirname,'../../app/careops/delivery/page.jsx');
  const sourceModule={exports:{}};
  const compiled=transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}).code;
  vm.runInNewContext(compiled,{module:sourceModule,exports:sourceModule.exports,require(name){assert.ok(name in dependencies,name);return dependencies[name];},AbortController,crypto:{randomUUID:crypto.randomUUID},Date,Number,JSON});
  const Component=sourceModule.exports.default;
  const view={
    render(runEffects=true){let cycles=0;do{assert.ok(++cycles<30,'Finite component updates');cursor=0;dirty=false;tree=Component();if(runEffects)for(const effect of effects.splice(0))effect();}while(runEffects&&dirty);return tree;},
    find(type){const matches=[];function visit(node){if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(visit);return;}if(node.type===type)matches.push(node);visit(node.props?.children);}visit(tree);return matches;},
    button(label){return view.find(buttonType).find(node=>text(node.props.children).includes(label));},
    text:()=>JSON.stringify(tree),
    reason(value){view.find('textarea')[0].props.onChange({target:{value}});view.render();},
    review(){view.find('input').find(node=>node.props.type==='checkbox').props.onChange({target:{checked:true}});view.render();},
    unmount(){for(const slot of slots)slot.cleanup?.();},
  };return view;
}
const auth=user=>({value:{user,loading:false,isAuthenticated:true}});
async function flush(view){await new Promise(resolve=>setImmediate(resolve));view.render();}
function apiFor(reports=[reportA],jobs=[jobA]){
  return{async get(url){
    if(url==='/ng/public-health/reports')return{data:{reports}};
    const report=reports.find(row=>url.includes('/'+row.id));
    assert.ok(report,'Expected report URL '+url);
    if(url.endsWith('/delivery'))return{data:{deliveries:jobs.filter(job=>job.reportId===report.id)}};
    return{data:{report,values:[{id:'value-'+report.id,display_name:'Recorded aggregate '+report.id,value:0}]}};
  },async post(){throw new Error('No command expected');}};
}
async function open(view,index=0){view.find(buttonType).filter(node=>text(node.props.children)==='Review delivery')[index].props.onClick();view.render();await flush(view);}

test('DHIS2 view waits for current auth and synchronously hides prior scope before cleanup',async()=>{
  const current=auth(actorA);current.value.loading=true;let reads=0;const api=apiFor();const original=api.get;api.get=(...args)=>{reads++;return original(...args);};
  const view=harness(current,api);view.render();assert.equal(reads,0);
  current.value.loading=false;view.render();await flush(view);await open(view);
  assert.ok(view.text().includes('Authorized facility A'));view.reason('Private operator reasoning');
  current.value={user:{...actorB,marketScope:'US'},loading:false,isAuthenticated:true};view.render(false);
  assert.ok(!view.text().includes('Authorized facility A'));assert.ok(!view.text().includes('Private operator reasoning'));
  await flush(view);assert.equal(view.find('textarea').length,0);
});

test('late account and report-detail responses cannot replace the newly selected reporting context',async()=>{
  const current=auth(actorA),first=pending();const calls=[];
  const view=harness(current,{get(url,options){calls.push({url,options});return calls.length===1?first.promise:Promise.resolve({data:{reports:[]}});}});
  view.render();current.value=auth(actorB).value;view.render(false);
  first.resolve({data:{reports:[reportA]}});await flush(view);
  assert.ok(!view.text().includes('Authorized facility A'));assert.equal(calls.length,2);
  const detail=pending(),api=apiFor([reportA,reportB],[]),base=api.get;
  api.get=(url,options)=>url.includes('/report-a')?detail.promise:base(url,options);
  const second=harness(auth(actorA),api);second.render();await flush(second);
  second.find(buttonType).filter(node=>text(node.props.children)==='Review delivery')[0].props.onClick();second.render();
  await open(second,1);
  detail.resolve({data:{report:reportA,values:[],deliveries:[]}});await flush(second);
  assert.ok(second.text().includes('Recorded aggregate report-b'));assert.ok(!second.text().includes('Recorded aggregate report-a'));
});

test('operator command retains exact retry identity, blocks duplicate click and treats lost acknowledgement as uncertain',async()=>{
  const posts=[],api=apiFor();api.post=(url,body,options)=>{const call={...pending(),url,body,options};posts.push(call);return call.promise;};
  const view=harness(auth(actorA),api);view.render();await flush(view);await open(view);view.review();view.reason(' Reviewed retained delivery ');
  const first=view.button('Schedule one reconciliation check').props.onClick();
  view.button('Schedule one reconciliation check').props.onClick();view.render();assert.equal(posts.length,1);
  assert.equal(view.button('Close delivery with reason').props.disabled,true);
  posts[0].reject(new Error('Lost response'));await first;await flush(view);
  assert.ok(view.text().includes('A failed response does not prove that no change occurred'));
  const second=view.button('Schedule one reconciliation check').props.onClick();posts[1].reject(new Error('Unavailable'));await second;await flush(view);
  assert.equal(posts[1].options.headers['Idempotency-Key'],posts[0].options.headers['Idempotency-Key']);
  assert.deepEqual(JSON.parse(JSON.stringify(posts[0].body)),{action:'reconcile',expectedVersion:3,reason:'Reviewed retained delivery'});
  view.reason('Different operational reason');const third=view.button('Schedule one reconciliation check').props.onClick();posts[2].reject(new Error('Unavailable'));await third;await flush(view);
  assert.notEqual(posts[2].options.headers['Idempotency-Key'],posts[0].options.headers['Idempotency-Key']);
});

test('late operator success after account change cannot publish confirmation or refresh a foreign report',async()=>{
  const current=auth(actorA),deferred=pending(),api=apiFor();let reads=0;const base=api.get;
  api.get=(...args)=>{reads++;return base(...args);};api.post=()=>deferred.promise;
  const view=harness(current,api);view.render();await flush(view);await open(view);view.review();view.reason('Reviewed current evidence');
  const outgoing=view.button('Schedule one reconciliation check').props.onClick();
  current.value=auth(actorB).value;view.render(false);
  deferred.resolve({data:{success:true,delivery:{...jobA,operatorRetryBudget:1,version:4}}});await outgoing;
  assert.ok(!view.text().includes('One reconciliation check is scheduled'));
  await flush(view);assert.ok(!view.text().includes('Reviewed current evidence'));assert.ok(reads>=3);
});

test('mismatched evidence and unavailable listings stay distinct from verified empty reports',async()=>{
  let outage=true;const api=apiFor(),base=api.get;api.get=(url,options)=>outage?Promise.reject(new Error('Unavailable')):base(url,options);
  const view=harness(auth(actorA),api);view.render();await flush(view);
  assert.ok(view.text().includes('Reports unavailable'));assert.ok(!view.text().includes('No reports are available'));
  outage=false;view.button('Try again').props.onClick();view.render();await flush(view);await open(view);
  assert.ok(view.text().includes('Remote values confirmed')===false);
  const invalid=apiFor();const normal=invalid.get;invalid.get=(url,options)=>url.endsWith('/delivery')?Promise.resolve({data:{deliveries:[{...jobA,reportId:reportB.id}]}}):normal(url,options);
  const other=harness(auth(actorA),invalid);other.render();await flush(other);await open(other);
  assert.ok(other.text().includes('could not be loaded'));assert.equal(other.find('textarea').length,0);
  const empty=harness(auth(actorA),apiFor([],[]));empty.render();await flush(empty);assert.ok(empty.text().includes('No reports are available'));
});

test('scheduled/terminal delivery states never imply acceptance or offer another submission',async()=>{
  for(const job of [{...jobA,status:'queued',attempts:0},{...jobA,status:'confirmed'},{...jobA,resolution:{code:'closed_unresolved',reason:'Closed after review'}}]){
    const view=harness(auth(actorA),apiFor([reportA],[job]));view.render();await flush(view);await open(view);
    assert.equal(view.button('Schedule approved report delivery'),undefined);
    if(job.status==='confirmed'||job.resolution){assert.equal(view.button('Schedule one reconciliation check'),undefined);assert.equal(view.button('Close delivery with reason'),undefined);}
    if(job.status==='queued')assert.ok(!view.text().includes('Remote values confirmed'));
  }
});

test('a lost-acknowledgement replay reports the current retained outcome rather than inventing a pending check',async()=>{
  for(const status of ['confirmed','failed']){
    const jobs=[{...jobA}],api=apiFor([reportA],jobs);let requests=0;
    api.post=async()=>{
      requests++;
      if(requests===1)throw new Error('Original acknowledgement was lost');
      jobs[0]={...jobA,status,version:5,operatorRetryBudget:0};
      return{data:{success:true,replayed:true,delivery:jobs[0]}};
    };
    const view=harness(auth(actorA),api);view.render();await flush(view);await open(view);view.review();view.reason('Reviewed retained evidence');
    await view.button('Schedule one reconciliation check').props.onClick();await flush(view);
    await view.button('Schedule one reconciliation check').props.onClick();await flush(view);
    assert.ok(!view.text().includes('One reconciliation check is scheduled'));
    assert.ok(view.text().includes(status==='confirmed'?'No additional check is scheduled by this reply':'this reply does not schedule another check'));
  }
});
