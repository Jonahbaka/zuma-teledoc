'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';

const fieldClass = 'block w-full rounded border bg-white p-2 text-slate-900';
function Field({ name, label, type = 'text', required = true }) {
  return <label className="block text-sm">{label}<input className={fieldClass} name={name} type={type} required={required} maxLength={4000} /></label>;
}
function OrderActions({ order, submit, busy }) {
  const [kind, setKind] = useState('');
  const allowed = { recorded:['collect','cancel'],collected:['reject','result','cancel'],rejected:['collect','cancel'],resulted:order.requiresAcknowledgment?['acknowledge','amend']:['amend'],cancelled:[] }[order.status] || [];
  const action = allowed.includes(kind) ? kind : allowed[0] || '';
  if (!action) return null;
  const isResult = ['result','amend'].includes(action);
  return <form className="space-y-3" onSubmit={event => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
    const payload = { ...values, kind:action, expectedRevision:order.revision };
    if (action === 'collect') payload.collectedAt = new Date(String(values.collectedAt)).toISOString();
    if (isResult) {
      payload.critical = values.critical === 'on'; payload.reviewedSourceReport = values.reviewedSourceReport === 'on';
      if (values.criticalDueAt) payload.criticalDueAt = new Date(String(values.criticalDueAt)).toISOString(); else delete payload.criticalDueAt;
      if (!values.handoffPlan) delete payload.handoffPlan;
    }
    if (action === 'acknowledge') payload.resultRevision = order.resultRevision;
    void submit(order.id, payload);
  }}>
    <label className="block text-sm">Record next step<select className={fieldClass} value={action} onChange={event=>setKind(event.target.value)} disabled={busy}>
      {allowed.map(value=><option key={value} value={value}>{({collect:'Record specimen collection',reject:'Record specimen rejection',cancel:'Cancel local order',result:'Record reviewed result',amend:'Append corrected result',acknowledge:'Acknowledge critical result and action'})[value]}</option>)}
    </select></label>
    <fieldset disabled={busy} key={action} className="space-y-2">
      {action==='collect' && <><Field name="specimenReference" label="Specimen reference"/><Field name="collectedAt" label="Collection date and time" type="datetime-local"/><Field name="notes" label="Collection and identification notes"/></>}
      {['cancel','reject'].includes(action) && <Field name="reason" label="Reason"/>}
      {isResult && <><Field name="sourceLaboratory" label="Source laboratory"/><Field name="sourceReportId" label="Source report reference"/><Field name="value" label="Result as reported"/><Field name="unit" label="Reported units" required={false}/><Field name="referenceRange" label="Reported reference range" required={false}/>
        {action==='amend' && <Field name="correctionReason" label="Reason for correction"/>}
        <label className="block"><input name="reviewedSourceReport" type="checkbox" required/> I reviewed the source report and its patient, order and specimen match.</label>
        <label className="block"><input name="critical" type="checkbox"/> This report requires critical-result handoff.</label>
        <Field name="criticalDueAt" label="Clinician-selected handoff deadline (required for a critical result)" type="datetime-local" required={false}/><Field name="handoffPlan" label="Handoff and escalation plan (required for a critical result)" required={false}/>
      </>}
      {action==='acknowledge' && <><Field name="contactOutcome" label="Who was contacted and the outcome"/><Field name="actionTaken" label="Clinical action taken"/></>}
      <button className="rounded border px-4 py-2" type="submit">Save recorded step</button>
    </fieldset>
  </form>;
}
function FictionalLabPanel({ encounterId }) {
  const [orders,setOrders]=useState([]), [message,setMessage]=useState(''), [busy,setBusy]=useState(false);
  const mounted=useRef(false), pending=useRef(false), intent=useRef(null), readGeneration=useRef(0);
  const base=`/clinical-labs/${encodeURIComponent(encounterId)}/orders`;
  const load=useCallback(async()=>{
    const generation=++readGeneration.current;
    try { const response=await api.get(base); if(mounted.current && generation===readGeneration.current){setOrders(response.data.data);setMessage('Recorded orders loaded. No orders have been transmitted to a laboratory.');} }
    catch {if(mounted.current && generation===readGeneration.current){setOrders([]);setMessage('Lab workflow unavailable. A current clinician-owned encounter and fictional test accounts are required.');}}
  },[base]);
  useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;};},[load]);
  async function submit(id,payload) {
    if(pending.current)return;pending.current=true;setBusy(true);
    const fingerprint=JSON.stringify({id,payload});
    if(intent.current?.fingerprint!==fingerprint)intent.current={fingerprint,key:crypto.randomUUID()};
    try {
      await api.post(id?`${base}/${id}/events`:base,{...payload,requestKey:intent.current.key});
      if(!mounted.current)return;intent.current=null;await load();
    }catch{if(mounted.current)setMessage('Save could not be confirmed. Refresh the recorded history before retrying. Your previous report has not been overwritten.');}
    finally{pending.current=false;if(mounted.current)setBusy(false);}
  }
  return <section className="space-y-4 rounded border bg-white p-4" aria-label="Fictional manual laboratory workflow">
    <h2 className="text-xl font-semibold">Manual laboratory workflow — fictional accounts only</h2>
    <p>For local workflow verification. The treating clinician owns every recorded result and critical handoff. No external laboratory transmission, automatic alert or patient release is performed.</p>
    <p role="status">{message}</p><button className="rounded border px-4 py-2" onClick={load} disabled={busy}>Refresh recorded history</button>
    <form className="space-y-2" onSubmit={event=>{event.preventDefault();void submit(null,Object.fromEntries(new FormData(event.currentTarget)));}}>
      <fieldset disabled={busy}><legend>Record a local order</legend><Field name="testName" label="Test name"/><Field name="testCode" label="Source catalogue code"/><Field name="reason" label="Clinical reason"/><button className="mt-2 rounded border px-4 py-2" type="submit">Save local order</button></fieldset>
    </form>
    {orders.map(order=><article key={order.id} className="space-y-3 rounded border p-3"><h3 className="font-semibold">{order.testName} — {order.status}</h3>
      {order.requiresAcknowledgment && <p role="alert" className="font-semibold text-red-800">Critical result awaiting your acknowledgment and documented action. Due {new Date(order.criticalDueAt).toLocaleString()}.</p>}
      <details><summary>Recorded history ({order.events.length})</summary><ol>{order.events.map(event=><li key={event.id} className="my-2">{event.kind} · {new Date(event.createdAt).toLocaleString()}{event.value && <p>{event.value} {event.unit} — {event.referenceRange}</p>}{event.actionTaken && <p>{event.actionTaken}</p>}{event.reason && <p>{event.reason}</p>}</li>)}</ol></details>
      <OrderActions order={order} submit={submit} busy={busy}/></article>)}
  </section>;
}
export default function ManualLabPanel({ encounterId }) {
  const { user } = useAuth();
  if (process.env.NODE_ENV === 'production' || !user?.id) return null;
  return <FictionalLabPanel key={`${user.id}:${encounterId}`} encounterId={encounterId}/>;
}
