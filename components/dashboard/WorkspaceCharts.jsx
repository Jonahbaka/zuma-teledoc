'use client';

import { useState } from 'react';
import { BarChart3, PieChart, CalendarDays, ArrowUpRight } from 'lucide-react';
import { appointmentSeries, appointmentStatuses, documentationDistribution, consultationDistribution } from '@/lib/workspace-charts.cjs';
import { WorkspaceState } from './WorkspaceElements';

const COLORS = { blue: '#3e5bce', violet: '#7750c9', amber: '#ae670c', rose: '#b33d70', slate: '#78849b' };

export function DistributionChart({ title, description, items, loading, error, onRetry, variant = 'donut' }) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  let offset = 0;
  return <section className="workspace-chart" aria-label={title}>
    <div className="workspace-chart-heading"><span className="workspace-chart-icon"><PieChart aria-hidden="true" /></span><div><h2>{title}</h2><p>{description}</p></div></div>
    {loading || error ? <WorkspaceState loading={loading} error={error} onRetry={onRetry} /> : total === 0 ? <WorkspaceState empty="No records to chart yet. This chart updates when records are available." /> : <>
      {variant === 'donut' ? <div className="workspace-donut-layout"><div className="workspace-donut">
        <svg viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="78" fill="none" stroke="#edf0f8" strokeWidth="23" />{items.filter(item => item.count > 0).map(item => {
          const length = item.count / total * 100, start = offset; offset += length;
          return <circle key={item.label} cx="100" cy="100" r="78" fill="none" stroke={COLORS[item.tone]} strokeWidth="23" pathLength="100" strokeDasharray={`${length} ${100 - length}`} strokeDashoffset={-start} transform="rotate(-90 100 100)" />;
        })}</svg><div><strong>{total}</strong><span>records</span></div>
      </div><dl className="workspace-chart-legend">{items.map(item => <div key={item.label}><dt><span aria-hidden="true" style={{ backgroundColor: COLORS[item.tone] }} />{item.label}</dt><dd>{item.count}</dd></div>)}</dl></div> : <div className="workspace-horizontal-bars">{items.map(item => <div key={item.label}><dl><dt>{item.label}</dt><dd>{item.count}</dd></dl><div className="workspace-bar-track" aria-hidden="true"><span style={{ width: `${item.count / Math.max(...items.map(value => value.count), 1) * 100}%`, background: COLORS[item.tone] }} /></div></div>)}</div>}
      <p className="workspace-chart-caption">Calculated from the records in this view.</p>
    </>}
  </section>;
}

export function AppointmentChart({ section, loading, onRetry, now, period, onPeriodChange }) {
  const aggregate = appointmentSeries(section?.rows, now || new Date(), period);
  const max = Math.max(1, ...aggregate.series.map(day => day.count));
  return <section className="workspace-chart workspace-chart-visits" aria-label="Scheduled visits chart">
    <div className="workspace-chart-heading"><span className="workspace-chart-icon"><BarChart3 aria-hidden="true" /></span><div><h2>Scheduled visits</h2><p>By appointment date · your local time</p></div><label className="workspace-chart-period"><span className="sr-only">Chart date range</span><select aria-label="Chart date range" value={period} onChange={event => onPeriodChange(Number(event.target.value))}><option value={7}>Next 7 days</option><option value={14}>Next 14 days</option></select></label></div>
    {loading || section?.error ? <WorkspaceState loading={loading} error={section?.error} onRetry={onRetry} /> : !section?.rows?.length ? <WorkspaceState empty="No appointments to chart yet. Your schedule will appear here after booking." /> : <>
      <div className="workspace-chart-total"><strong>{aggregate.total}</strong><span>appointment{aggregate.total === 1 ? '' : 's'} in this range</span><CalendarDays aria-hidden="true" /></div>
      <div className="workspace-plot-scroll" tabIndex={period === 14 ? 0 : undefined} role="region" aria-label={`Appointments over the next ${period} days`}><div className={`workspace-bar-chart ${period === 14 ? 'workspace-bar-chart-wide' : ''}`} style={{ '--chart-columns': period }}>
        {aggregate.series.map((day, index) => <div key={day.key} className="workspace-bar-column"><div className="workspace-bar-space"><span className="workspace-bar-number">{day.count}</span><div className={`workspace-bar ${index === 0 ? 'workspace-bar-today' : ''}`} style={{ height: `${day.count / max * 150}px` }} aria-hidden="true" /></div><span className="workspace-bar-day">{day.weekday}</span><span className="workspace-bar-date">{day.day}</span><span className="sr-only">{day.label}: {day.count} appointments</span></div>)}
      </div></div>
      <div className="workspace-chart-foot"><span><span className="workspace-legend-dot" aria-hidden="true" />Appointments in this view</span><span>{aggregate.outsideRange} outside range{aggregate.undated > 0 ? ` · ${aggregate.undated} without a date` : ''}</span></div>
    </>}
  </section>;
}

export default function WorkspaceCharts({ appointments, notes, loading, onRetry, updatedAt, provider = false, expanded = false }) {
  const [period, setPeriod] = useState(7);
  return <div className="workspace-charts-group">
    <div className="workspace-charts-label"><span>YOUR ACTIVITY, VISUALIZED</span><span><ArrowUpRight className="h-4 w-4" aria-hidden="true" />Updates when you refresh</span></div>
    <div className="workspace-charts-grid"><AppointmentChart section={appointments} loading={loading} onRetry={onRetry} now={updatedAt} period={period} onPeriodChange={setPeriod} /><DistributionChart title={provider ? 'Documentation' : 'Your visit mix'} description={provider ? 'Signing status of recent notes' : 'How your appointments are scheduled'} items={provider ? documentationDistribution(notes?.rows) : consultationDistribution(appointments?.rows)} loading={loading} error={provider ? notes?.error : appointments?.error} onRetry={onRetry} /></div>
    {expanded && <div className="workspace-charts-grid"><DistributionChart title="Scheduling status" description="All appointment records in this view" items={appointmentStatuses(appointments?.rows)} loading={loading} error={appointments?.error} onRetry={onRetry} variant="bars" /><DistributionChart title="Consultation types" description="Video, phone and other appointments" items={consultationDistribution(appointments?.rows)} loading={loading} error={appointments?.error} onRetry={onRetry} /></div>}
  </div>;
}
