'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { estimateAdministrativeTime } from '@/lib/growth/workflow-planner.cjs';

export default function WorkflowPlanner() {
  const id = useId();
  const [values, setValues] = useState({ enquiries: '100', minutes: '6', targetPercent: '20' });
  const result = Object.values(values).some(value => value.trim() === '') ? null : estimateAdministrativeTime(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Number(value)])));
  const fields = [
    ['enquiries', 'Administrative enquiries per week', 10000, 1],
    ['minutes', 'Average staff minutes per enquiry', 120, 0.5],
    ['targetPercent', 'Your target reduction (%)', 100, 1],
  ];
  return <section aria-labelledby={id + '-heading'} className="my-14 rounded-3xl border border-border bg-muted/40 p-6 md:p-10">
    <div className="grid gap-8 lg:grid-cols-2">
      <div>
        <p className="text-sm font-bold uppercase tracking-widest text-foreground">Build a measurable pilot</p>
        <h2 id={id + '-heading'} className="mt-3 text-3xl font-bold">What would a better workflow be worth?</h2>
        <p className="mt-4 leading-7 text-muted-foreground">Start with a staff task such as scheduling or answering appointment questions. Use your own estimates to set a target you can measure during a pilot.</p>
        <p id={id + '-note'} className="mt-4 text-sm leading-6 text-muted-foreground">Illustrative planning only. The starting values are examples, not customer results or promised savings. This calculation stays in your browser. Do not enter patient information.</p>
      </div>
      <div>
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
          {fields.map(([key, label, max, step]) => <div key={key}>
            <label className="block text-sm font-semibold" htmlFor={id + '-' + key}>{label}</label>
            <input id={id + '-' + key} type="number" inputMode="decimal" min="0" max={max} step={step} value={values[key]} aria-describedby={id + '-note'} onChange={event => setValues(current => ({ ...current, [key]: event.target.value }))} className="mt-2 min-h-11 w-full rounded-lg border border-border bg-background px-3 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" />
          </div>)}
        </div>
        <div role="status" aria-live="polite" aria-atomic="true" className="mt-6 rounded-2xl bg-background p-5">
          {result ? <><p className="text-sm text-muted-foreground">Estimated current administrative time</p><p className="mt-1 text-2xl font-bold">{result.baselineHours.toFixed(1)} hours / week</p><p className="mt-3 text-sm">Your target would free <strong>{result.targetHours.toFixed(1)} hours per week</strong> if achieved.</p></> : <p>Enter a whole enquiry count from 0–10,000, 0–120 minutes, and a target from 0–100% to calculate.</p>}
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">Formula: enquiries × minutes ÷ 60. Target hours = current hours × target percentage. Confirm any improvement against observed work.</p>
      </div>
    </div>
    <Link href="/contact" className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground">Discuss a workflow pilot</Link>
  </section>;
}
