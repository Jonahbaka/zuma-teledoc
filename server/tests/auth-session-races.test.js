'use strict';

const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const {transformSync}=require('next/dist/build/swc');
const express=require('express');const jwt=require('jsonwebtoken');
const root=path.resolve(__dirname,'../..');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const token=id=>'isolated.'+Buffer.from(JSON.stringify({userId:id})).toString('base64url')+'.test';
const user=id=>({id,role:'provider',marketScope:'US',mustChangePassword:true});
const response=id=>({data:{success:true,user:{...user(id),mustChangePassword:false},accessToken:token(id),refreshToken:'refresh-'+id}});
function compile(file,dependencies={},globals={}){
 const sandboxModule={exports:{}};const absolute=path.join(root,file);const compiled=transformSync(fs.readFileSync(absolute,'utf8'),{filename:absolute,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}).code;
 vm.runInNewContext(compiled,{module:sandboxModule,exports:sandboxModule.exports,URL,URLSearchParams,AbortController,atob,console,...globals,require(name){assert.ok(name in dependencies,'Unexpected dependency '+name);return dependencies[name];}});return sandboxModule.exports;
}
function storage(){const values=new Map();const writes=[];return{values,writes,getItem:key=>values.get(key)||null,setItem(key,value){writes.push(['set',key,value]);values.set(key,value);},removeItem(key){writes.push(['remove',key]);values.delete(key);}};}
function sessionFor(store,globals={}){return compile('lib/authSession.js',{}, {localStorage:store,setTimeout,clearTimeout,...globals});}
function hooks(){const slots=[];const effects=[];let cursor=0,dirty=false,tree;const react={
 createContext:()=>({Provider:Symbol('Provider')}),useContext:()=>{},
 useState(initial){const index=cursor++;if(!slots[index])slots[index]={value:typeof initial==='function'?initial():initial};return[slots[index].value,next=>{slots[index].value=typeof next==='function'?next(slots[index].value):next;dirty=true;}];},
 useRef(initial){const index=cursor++;if(!slots[index])slots[index]={value:{current:initial}};return slots[index].value;},
 useCallback(callback,dependencies){const index=cursor++;const previous=slots[index];if(!previous||dependencies.some((value,offset)=>value!==previous.dependencies[offset]))slots[index]={value:callback,dependencies};return slots[index].value;},
 useEffect(callback,dependencies){const index=cursor++;const previous=slots[index];if(!previous||dependencies.some((value,offset)=>value!==previous.dependencies[offset])){const next={dependencies,cleanup:null};slots[index]=next;effects.push(()=>{previous?.cleanup?.();next.cleanup=callback();});}},
 };return{react,jsx:{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},render(Component,runEffects=true){let count=0;do{cursor=0;dirty=false;tree=Component();if(runEffects)for(const effect of effects.splice(0))effect();assert.ok(++count<30,'Render must settle');}while(runEffects&&dirty);return tree;},find(type){const nodes=[];function visit(node){if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(visit);return;}if(node.type===type)nodes.push(node);visit(node.props?.children);}visit(tree);return nodes;},unmount(){for(const slot of slots)slot.cleanup?.();}};
}
function provider(api,store,session){const renderer=hooks();const redirects=[];const Component=compile('components/providers/AuthProvider.jsx',{
 react:renderer.react,'react/jsx-runtime':renderer.jsx,'next/navigation':{useRouter:()=>({replace:value=>redirects.push(value),push:value=>redirects.push(value)})},'@/lib/api':{__esModule:true,default:api},
 '@/lib/providerPortal':{getProviderLoginPath:()=>'/provider/login',toProviderPortalPath:()=>'/provider/dashboard'},'@/lib/careopsProfile':compile('lib/careopsProfile.js',{}, {process:{env:{NEXT_PUBLIC_DOCTARX_PRODUCT_PROFILE:'careops'}}}),'@/lib/authSession':session,
 },{localStorage:store,window:{location:{pathname:'/careops/login'}}}).AuthProvider;
 return{...renderer,redirects,render(runEffects=true){const tree=renderer.render(()=>Component({children:null}),runEffects);this.value=tree.props.value;return tree;}};
}

test('AuthProvider cannot replace a newer account with late login tokens or old checkAuth401/logout/refresh completions',async()=>{
 const store=storage();const session=sessionFor(store);const requests=[];const api={get(){const pending=deferred();requests.push({kind:'me',...pending});return pending.promise;},post(url){const pending=deferred();requests.push({kind:url,...pending});return pending.promise;}};
 const view=provider(api,store,session);view.render();await turn();view.render();
 const first=view.value.login('A','unused',null,null,{redirect:false});const a=requests.at(-1);
 const second=view.value.login('B','unused',null,null,{redirect:false});const b=requests.at(-1);
 b.resolve(response('B'));await second;view.render();a.resolve(response('A'));await first;view.render();
 assert.equal(store.getItem('accessToken'),token('B'));assert.equal(view.value.user.id,'B');assert.equal(store.writes.some(row=>row[0]==='set'&&row[2]===token('A')),false);
 const checking=view.value.checkAuth();const read=requests.at(-1);const refreshing=view.value.refreshToken();const refresh=requests.at(-1);
 const logout=view.value.logout();const leaving=requests.at(-1);view.render();const next=view.value.login('C','unused',null,null,{redirect:false});const c=requests.at(-1);c.resolve(response('C'));await next;view.render();
 read.reject({response:{status:401}});refresh.resolve(response('B'));leaving.resolve({data:{success:true}});await Promise.all([checking,refreshing,logout]);view.render();
 assert.equal(store.getItem('accessToken'),token('C'));assert.equal(store.getItem('refreshToken'),'refresh-C');assert.equal(view.value.user.id,'C');view.unmount();
});

test('actual API cookie-write queue orders old login response before a new login and rejects stale cookie/token refresh',async()=>{
 const store=storage();const session=sessionFor(store);const started=[];const cookies=[];let requestHandler,successHandler,failureHandler;
 const api=async config=>{config.headers||={};const request=await requestHandler(config);const pending=deferred();started.push({request,...pending});try{const data=await pending.promise;if(/^\/auth\//.test(request.url))cookies.push(data.user?.id||'refresh');return successHandler({config:request,data});}catch(error){return failureHandler({...error,config:request});}};
 api.interceptors={request:{use(fn){requestHandler=fn;}},response:{use(success,failure){successHandler=success;failureHandler=failure;}}};
 const axios={create:()=>api,post(){throw new Error('No raw refresh is expected in this case');}};
 compile('lib/api.js',{axios,'@/lib/careopsProfile':compile('lib/careopsProfile.js',{}, {process:{env:{NEXT_PUBLIC_DOCTARX_PRODUCT_PROFILE:'careops'}}}),'@/lib/authSession':session},{process:{env:{}},window:{location:{hostname:'care.example.org',origin:'https://care.example.org',pathname:'/careops',href:''}},localStorage:store});
 const ga=session.beginAuthSessionTransition();const old=api({method:'post',url:'/auth/login',skipAuth:true,authGeneration:ga});old.catch(()=>{});await turn();assert.equal(started.length,1);
 const gb=session.beginAuthSessionTransition();const current=api({method:'post',url:'/auth/login',skipAuth:true,authGeneration:gb});await turn();assert.equal(started.length,1,'New cookie mutation waits for old HTTP response');
 started[0].resolve(response('A').data);await assert.rejects(old,{code:'AUTH_CONTEXT_CHANGED'});await turn();assert.equal(started.length,2);
 started[1].resolve(response('B').data);await current;assert.deepEqual(cookies,['A','B']);
 session.writeAuthSessionTokens(token('B'),'refresh-B');
 const pendingRefresh=api({method:'post',url:'/auth/refresh',authGeneration:gb});pendingRefresh.catch(()=>{});await turn();
 session.beginAuthSessionTransition();store.setItem('accessToken',token('C'));store.setItem('refreshToken','refresh-C');started[2].resolve(response('B').data);
 await assert.rejects(pendingRefresh,{code:'AUTH_CONTEXT_CHANGED'});assert.equal(store.getItem('accessToken'),token('C'));assert.equal(store.getItem('refreshToken'),'refresh-C');
});

test('independent browser runtimes share the origin-wide cookie lock and unsupported coordination fails closed',async()=>{
 const store=storage();let tail=Promise.resolve();
 const locks={async request(_name,{signal},callback){const previous=tail;let release;tail=new Promise(resolve=>{release=resolve;});await previous;try{if(signal.aborted)throw Object.assign(new Error('Aborted'),{name:'AbortError'});return await callback();}finally{release();}}};
 const a=sessionFor(store,{window:{},navigator:{locks}});const b=sessionFor(store,{window:{},navigator:{locks}});
 a.writeAuthSessionTokens(token('A'),'refresh-A');const first=await a.acquireAuthCookieWrite(a.authSessionGeneration());const order=['A logout HTTP'];
 const gb=b.beginAuthSessionTransition();b.writeAuthSessionTokens(null,null);let bStarted=false;
 const pending=b.acquireAuthCookieWrite(gb).then(release=>{bStarted=true;order.push('B login HTTP');return release;});
 await turn();assert.equal(bStarted,false,'B cannot send a cookie-setting login while A HTTP may still clear cookies');
 order.push('A cookies applied');first();const second=await pending;b.writeAuthSessionTokens(token('B'),'refresh-B');order.push('B cookies applied');second();
 assert.deepEqual(order,['A logout HTTP','A cookies applied','B login HTTP','B cookies applied']);
 const unsupported=sessionFor(storage(),{window:{},navigator:{}});await assert.rejects(unsupported.acquireAuthCookieWrite(),{code:'AUTH_COORDINATION_UNAVAILABLE'});
});

test('latest explicit tab sign-in supersedes an earlier tab before its delayed tokens can be stored',async()=>{
 const store=storage();const a=sessionFor(store);const b=sessionFor(store);const pending=[];
 const transport={post(){const request=deferred();pending.push(request);return request.promise;}};
 const viewA=provider(transport,store,a);const viewB=provider(transport,store,b);viewA.render();viewB.render();
 const first=viewA.value.login('A','unused',null,null,{redirect:false});const older=pending.at(-1);
 const latest=viewB.value.login('B','unused',null,null,{redirect:false});const current=pending.at(-1);
 older.resolve(response('A'));await first;assert.equal(store.getItem('accessToken'),null);
 current.resolve(response('B'));assert.equal((await latest).success,true);viewB.render();assert.equal(viewB.value.user.id,'B');assert.equal(store.getItem('accessToken'),token('B'));viewA.unmount();viewB.unmount();
});

test('automatic refresh uses a bounded transport timeout while holding the cookie lock',async()=>{
 const store=storage();const session=sessionFor(store);session.writeAuthSessionTokens(token('A'),'refresh-A');let before,failure,refreshOptions;
 const fake={interceptors:{request:{use(fn){before=fn;}},response:{use(_success,fn){failure=fn;}}}};
 const location={pathname:'/careops',href:''};
 compile('lib/api.js',{axios:{create:()=>fake,async post(_url,_body,options){refreshOptions=options;throw new Error('Isolated transport timeout');}},'@/lib/authSession':session,'@/lib/careopsProfile':{CAREOPS_PROFILE:true,isCareOpsSurface:()=>true,careOpsLoginPath:()=>'/careops/login'}},{process:{env:{}},window:{location},localStorage:store});
 const original=await before({method:'get',url:'/private',headers:{}});await assert.rejects(failure({config:original,response:{status:401}}));assert.equal(refreshOptions.timeout,30000);assert.equal(refreshOptions.headers.Authorization,'Bearer '+token('A'));
 const release=await session.acquireAuthCookieWrite(session.authSessionGeneration());release();
});

function passwordHarness(auth,api,store,session){const renderer=hooks();const redirects=[];const Component=compile('components/careops/CareOpsPasswordChange.jsx',{
 react:renderer.react,'react/jsx-runtime':renderer.jsx,'next/navigation':{useRouter:()=>({replace:value=>redirects.push(value)})},'@/components/providers/AuthProvider':{useAuth:()=>auth.value},'@/lib/api':{authAPI:api},'@/lib/careopsProfile':compile('lib/careopsProfile.js',{}, {process:{env:{NEXT_PUBLIC_DOCTARX_PRODUCT_PROFILE:'careops'}}}),'@/lib/authSession':session,
 },{localStorage:store,window:{location:{search:'?returnTo=%2Fcareops%2Fdelivery'}}}).default;
 return{...renderer,redirects,render(runEffects=true){return renderer.render(Component,runEffects);},fill(){for(const [index,value]of ['current','Corrected123!','Corrected123!'].entries()){renderer.find('input')[index].props.onChange({target:{value}});this.render();}},submit(){return renderer.find('form')[0].props.onSubmit({preventDefault(){}});}};
}
test('CareOps password completion cannot mutate a new owner before effects or navigate it after refresh',async()=>{
 for(const phase of ['response','refresh']){
  const store=storage();const session=sessionFor(store);const change=deferred();const refreshed=deferred();let updates=0;
  const auth={value:{user:user('A'),loading:false,isAuthenticated:true,updateUser(){updates++;},refreshUser:()=>refreshed.promise}};
  const view=passwordHarness(auth,{changePassword:()=>change.promise},store,session);view.render();view.fill();const submitting=view.submit();
  if(phase==='refresh'){change.resolve(response('A'));await turn();assert.equal(updates,1);}
  auth.value={...auth.value,user:user('B')};view.render(false);store.setItem('accessToken',token('B'));store.setItem('refreshToken','refresh-B');
  if(phase==='response')change.resolve(response('A'));else refreshed.resolve();await submitting;
  assert.equal(store.getItem('accessToken'),token('B'));assert.equal(store.getItem('refreshToken'),'refresh-B');assert.equal(view.redirects.length,0);assert.equal(updates,phase==='response'?0:1);view.unmount();
 }
});

test('independent tab runtimes synchronously block unconfirmed shared-storage identity and discard old responses',async()=>{
 const store=storage();store.setItem('accessToken',token('A'));store.setItem('refreshToken','refresh-A');
 const tabA=sessionFor(store);const tabB=sessionFor(store);const requests=[];
 const view=provider({get(){const pending=deferred();requests.push(pending);return pending.promise;}},store,tabA);
 view.render();requests[0].resolve(response('A'));await turn();view.render();assert.equal(view.value.user.id,'A');
 const pending=view.value.checkAuth();const previous=requests.at(-1);const original=tabA.authSessionGeneration();
 tabB.beginAuthSessionTransition();tabB.writeAuthSessionTokens(token('B'),'refresh-B');
 assert.notEqual(tabA.authSessionGeneration(),original);assert.throws(()=>tabA.assertAuthSessionConfirmed(),{code:'AUTH_CONTEXT_CHANGED'});
 assert.equal(view.value.getToken(),null,'No B socket token under the A view');
 await turn();view.render();assert.equal(view.value.user,null,'Other tab immediately loses its prior authenticated view');
 previous.resolve(response('A'));await pending;view.render();assert.equal(view.value.user,null);
 requests.at(-1).resolve(response('B'));await turn();view.render();assert.equal(view.value.user.id,'B');
 assert.doesNotThrow(()=>tabA.assertAuthSessionConfirmed());assert.equal(view.value.getToken(),token('B'));view.unmount();
});

test('actual retry request retains the original generation before reading a newer account token',async()=>{
 const store=storage();const session=sessionFor(store);session.writeAuthSessionTokens(token('A'),'refresh-A');let before;
 const fake={interceptors:{request:{use(fn){before=fn;}},response:{use(){}}}};
 compile('lib/api.js',{axios:{create:()=>fake},'@/lib/authSession':session,'@/lib/careopsProfile':{CAREOPS_PROFILE:true}},{process:{env:{}},window:{location:{}},localStorage:store});
 const original=await before({method:'get',url:'/private',headers:{}});assert.equal(original.headers.Authorization,'Bearer '+token('A'));
 session.beginAuthSessionTransition();session.writeAuthSessionTokens(token('B'),'refresh-B');
 await assert.rejects(before(original),{code:'AUTH_CONTEXT_CHANGED'});assert.equal(original.headers.Authorization,'Bearer '+token('A'));
});

test('external logout settles a genuinely empty anonymous context without leaving public requests blocked',async()=>{
 const store=storage();const session=sessionFor(store);const requests=[];
 const view=provider({post(){const pending=deferred();requests.push(pending);return pending.promise;}},store,session);view.render();
 const signing=view.value.login('A','unused',null,null,{redirect:false});requests.at(-1).resolve(response('A'));await signing;view.render();
 store.removeItem('accessToken');store.removeItem('refreshToken');session.authSessionGeneration();
 await turn();view.render();assert.equal(view.value.user,null);assert.equal(view.value.loading,false);assert.doesNotThrow(()=>session.assertAuthSessionConfirmed());view.unmount();
});

test('superseded cross-tab notification cannot cancel a newer explicit sign-in',async()=>{
 const store=storage();const session=sessionFor(store);const requests=[];
 const view=provider({get(){const pending=deferred();requests.push(pending);return pending.promise;},post(){const pending=deferred();requests.push(pending);return pending.promise;}},store,session);
 view.render();const first=view.value.login('A','unused',null,null,{redirect:false});requests.at(-1).resolve(response('A'));await first;view.render();
 store.setItem('accessToken',token('B'));store.setItem('refreshToken','refresh-B');
 const latest=view.value.login('C','unused',null,null,{redirect:false});const current=requests.at(-1);await turn();current.resolve(response('C'));
 assert.equal((await latest).success,true);view.render();assert.equal(view.value.user.id,'C');assert.equal(store.getItem('accessToken'),token('C'));view.unmount();
});

test('replacement MFA-pending or rejected sign-in never retains the previous rendered account',async()=>{
 for(const mfa of [true,false]){
  const store=storage();const session=sessionFor(store);const requests=[];
  const view=provider({post(){const pending=deferred();requests.push(pending);return pending.promise;}},store,session);view.render();
  const initial=view.value.login('A','unused',null,null,{redirect:false});requests.at(-1).resolve(response('A'));await initial;view.render();
  const replacement=view.value.login('B','unused',null,null,{redirect:false});view.render();assert.equal(view.value.user,null);
  if(mfa)requests.at(-1).resolve({data:{success:true,mfaRequired:true}});else requests.at(-1).reject({response:{status:401,data:{error:'Invalid credentials'}}});
  await replacement;view.render();assert.equal(view.value.user,null);assert.equal(store.getItem('accessToken'),null);assert.equal(store.getItem('refreshToken'),null);view.unmount();
 }
});

test('actual HTTP replacement login clears stale cookies on failure/MFA and explicit refresh cannot select another cookie account',async()=>{
 const source=fs.readFileSync(path.join(root,'server/routes/auth.js'),'utf8').replace(/\r\n/g,'\n');
 const setters=source.slice(source.indexOf('const setAuthCookies ='),source.indexOf('/**\n * POST /api/auth/register'));
 const login=source.slice(source.indexOf('const loginHandler ='),source.indexOf("router.post('/login', loginHandler);")+"router.post('/login', loginHandler);".length);
 const refreshStart=source.indexOf("router.post('/refresh'");const refresh=source.slice(refreshStart,source.indexOf('/**\n * POST /api/auth/logout',refreshStart));
 const logoutStart=source.indexOf("router.post('/logout'");const logout=source.slice(logoutStart,source.indexOf('/**\n * GET /api/auth/me',logoutStart));
 const secret='isolated-refresh-test-secret-not-used-outside-this-process';const tokenA=jwt.sign({userId:'A',type:'refresh'},secret);const tokenB=jwt.sign({userId:'B',type:'refresh'},secret);
 const router=express.Router();const queried=[];let validPassword=false;
 const person={id:'A',email:'isolated@example.invalid',role:'provider',is_active:true,mfa_enabled:true,password_hash:'isolated',failed_login_attempts:0};
 const context={router,process:{env:{NODE_ENV:'production',AUTH_COOKIE_DOMAIN_MODE:'host-only'}},authCookieDomain:()=>undefined,legacyAuthCookieDomain:()=>'.doctarx.com',
  validate:(_schema,body)=>body,loginSchema:{},db:{async query(sql,params){queried.push({sql,params});if(sql.includes('FROM refresh_tokens'))return{rows:[{id:'stored-token-A',user_id:'A'}]};if(sql.includes('FROM users'))return{rows:[person]};return{rows:[]};}},
  bcrypt:{compare:async()=>validPassword},auditLogin:async()=>{},logger:{info(){},error(){}},jwt,REFRESH_TOKEN_SECRET:secret,ACCESS_TOKEN_SECRET:secret,hash:value=>'hash:'+value,
  generateTokens:owner=>({accessToken:token(owner),refreshToken:'rotated-'+owner}),rotateMfaAttestation:()=>null,
  authenticate:(req,_res,next)=>{req.user={id:'A'};next();},auditLogout:async()=>{},
 };
 vm.runInNewContext(setters+'\n'+login+'\n'+refresh+'\n'+logout,context);
 const app=express();app.use(express.json());app.use((req,_res,next)=>{req.cookies={refreshToken:tokenB};next();});app.use(router);
 const server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});const base='http://127.0.0.1:'+server.address().port;
 try{
  for(const mfa of [false,true]){validPassword=mfa;const result=await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:person.email,password:'unused'})});assert.equal(result.status,mfa?200:401);const data=await result.json();if(mfa)assert.equal(data.mfaRequired,true);const cookies=result.headers.getSetCookie();assert.ok(cookies.some(value=>value.startsWith('accessToken=;')));assert.ok(cookies.some(value=>value.startsWith('refreshToken=;')));assert.ok(cookies.some(value=>value.startsWith('mfaVerified=;')));assert.equal(cookies.some(value=>value.startsWith('accessToken=isolated.')),false);}
  queried.length=0;const rotated=await fetch(base+'/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refreshToken:tokenA})});assert.equal(rotated.status,200);assert.equal((await rotated.json()).accessToken,token('A'));assert.equal(queried.find(row=>row.sql.includes('FROM refresh_tokens')).params[0],'hash:'+tokenA);
  queried.length=0;const missing=await fetch(base+'/refresh',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refreshToken:null})});assert.equal(missing.status,401);assert.equal(queried.length,0,'Explicit invalid A session never falls back to cookie B');
  queried.length=0;const mismatch=await fetch(base+'/refresh',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+jwt.sign({userId:'B'},secret)},body:JSON.stringify({refreshToken:tokenA})});assert.equal(mismatch.status,401);assert.equal(queried.length,0,'An intended B account cannot refresh A before any token mutation');
  queried.length=0;const leaving=await fetch(base+'/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refreshToken:tokenA})});assert.equal(leaving.status,200);const revocation=queried.find(row=>row.sql.includes('UPDATE refresh_tokens'));assert.match(revocation.sql,/user_id = \$2/);assert.equal(revocation.params[0],'hash:'+tokenA);assert.equal(revocation.params[1],'A');
  queried.length=0;const cookieOnly=await fetch(base+'/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(cookieOnly.status,200);const scoped=queried.find(row=>row.sql.includes('UPDATE refresh_tokens'));assert.equal(scoped.params[0],'hash:'+tokenB);assert.equal(scoped.params[1],'A','Cookie B cannot revoke a stored token owned by B under bearer A');
 }finally{await new Promise(resolve=>server.close(resolve));}
});
