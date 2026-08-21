'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, Bookmark, CheckCircle2, ChevronRight, Database,
  Download, FileSearch, Filter, Loader2, RotateCcw, Search, ShieldCheck,
  Upload, XCircle,
} from 'lucide-react';
import api from '@/lib/api';

const PROGRAMMES = ['maternal_health', 'child_health', 'referrals', 'primary_care', 'service_utilization'];
const TARGET_FIELDS = [
  ['recordKey', 'Unique record ID'], ['title', 'Plain-language record label'],
  ['indicatorKey', 'Indicator key'], ['observedValue', 'Observed value'],
  ['unit', 'Unit'], ['observationDate', 'Observation date'],
  ['referralStatus', 'Referral status'], ['dataQualityStatus', 'Data-quality status'],
];
const EMPTY_FILTERS = {
  q: '', facilityId: '', jurisdictionId: '', programmeArea: '', indicatorId: '',
  periodFrom: '', periodTo: '', dateFrom: '', dateTo: '', approvalStatus: 'approved',
  referralStatus: '', dataQualityStatus: '',
};

function messageFrom(error) {
  return error?.response?.data?.error || error?.message || 'The request could not be completed.';
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') return 'Missing — not zero';
  return String(value);
}

function flattenJurisdictions(value, output = []) {
  if (Array.isArray(value)) value.forEach((item) => flattenJurisdictions(item, output));
  else if (value && typeof value === 'object') {
    if (value.id && value.name) output.push(value);
    Object.values(value).forEach((child) => {
      if (child !== value.id && child !== value.name) flattenJurisdictions(child, output);
    });
  }
  return [...new Map(output.map((item) => [item.id, item])).values()];
}

function Field({ label, children }) {
  return <label className="grid gap-1.5 text-sm font-semibold text-slate-700"><span>{label}</span>{children}</label>;
}

function Select({ value, onChange, children, ariaLabel }) {
  return (
    <select aria-label={ariaLabel} value={value} onChange={onChange}
      className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200">
      {children}
    </select>
  );
}

function Input(props) {
  return <input {...props} className={`min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200 ${props.className || ''}`} />;
}

function Button({ children, tone = 'primary', className = '', ...props }) {
  const tones = {
    primary: 'bg-emerald-700 text-white hover:bg-emerald-800',
    secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
    danger: 'bg-rose-700 text-white hover:bg-rose-800',
  };
  return <button {...props} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50 ${tones[tone]} ${className}`}>{children}</button>;
}

export default function GovernmentDataWorkspace() {
  const [tab, setTab] = useState('search');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sources, setSources] = useState([]);
  const [jurisdictions, setJurisdictions] = useState([]);
  const [indicators, setIndicators] = useState([]);
  const [recent, setRecent] = useState([]);
  const [views, setViews] = useState([]);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [searchResult, setSearchResult] = useState({ records: [], total: 0 });
  const [suggestions, setSuggestions] = useState([]);
  const [viewName, setViewName] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [importForm, setImportForm] = useState({
    sourceId: '', jurisdictionId: '', facilityId: '', programmeArea: '', reportingPeriod: '',
  });
  const [sourceForm, setSourceForm] = useState({ name: '', sourceType: 'csv', jurisdictionId: '', facilityId: '', programmeArea: '' });
  const [batchReport, setBatchReport] = useState(null);

  const facilities = useMemo(() => [...new Map(sources.filter((item) => item.facility_id).map((item) => [item.facility_id, { id: item.facility_id, name: item.facility_name || item.facility_id }])).values()], [sources]);

  const refreshReferenceData = useCallback(async () => {
    const [sourceResponse, hierarchyResponse, indicatorResponse, recentResponse, viewResponse] = await Promise.all([
      api.get('/ng/government-data/sources'),
      api.get('/ng/governance/hierarchy'),
      api.get('/ng/public-health/indicators'),
      api.get('/ng/government-data/search/recent'),
      api.get('/ng/government-data/saved-views'),
    ]);
    setSources(sourceResponse.data.sources || []);
    setJurisdictions(flattenJurisdictions(hierarchyResponse.data));
    setIndicators(indicatorResponse.data.indicators || []);
    setRecent(recentResponse.data.searches || []);
    setViews(viewResponse.data.views || []);
  }, []);

  useEffect(() => {
    refreshReferenceData().catch((requestError) => setError(messageFrom(requestError))).finally(() => setLoading(false));
  }, [refreshReferenceData]);

  const search = useCallback(async (nextFilters = filters) => {
    setBusy('search'); setError('');
    try {
      const response = await api.get('/ng/government-data/search', { params: nextFilters });
      setSearchResult(response.data);
      const recentResponse = await api.get('/ng/government-data/search/recent');
      setRecent(recentResponse.data.searches || []);
    } catch (requestError) { setError(messageFrom(requestError)); }
    finally { setBusy(''); }
  }, [filters]);

  useEffect(() => {
    if (filters.q.trim().length < 2) { setSuggestions([]); return undefined; }
    const timer = window.setTimeout(() => {
      api.get('/ng/government-data/search/autocomplete', { params: { q: filters.q } })
        .then((response) => setSuggestions(response.data.suggestions || []))
        .catch(() => setSuggestions([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [filters.q]);

  function updateFilter(key, value) { setFilters((current) => ({ ...current, [key]: value })); }
  function updateImport(key, value) {
    setImportForm((current) => ({ ...current, [key]: value }));
    if (key === 'sourceId') {
      const source = sources.find((item) => item.id === value);
      if (source) setImportForm((current) => ({ ...current, sourceId: value, jurisdictionId: source.jurisdiction_id, facilityId: source.facility_id || '', programmeArea: source.programme_area || current.programmeArea }));
    }
  }

  async function previewFile() {
    if (!file) { setError('Choose a CSV, XLSX, or JSON file first.'); return; }
    setBusy('preview'); setError(''); setNotice('');
    try {
      const body = new FormData(); body.append('file', file);
      const response = await api.post('/ng/government-data/imports/preview', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      setPreview(response.data); setMapping({});
    } catch (requestError) { setError(messageFrom(requestError)); }
    finally { setBusy(''); }
  }

  async function createSource(event) {
    event.preventDefault(); setBusy('source'); setError('');
    try {
      await api.post('/ng/government-data/sources', sourceForm);
      await refreshReferenceData();
      setNotice('The scoped source is ready to use.');
      setSourceForm((current) => ({ ...current, name: '' }));
    } catch (requestError) { setError(messageFrom(requestError)); }
    finally { setBusy(''); }
  }

  async function uploadImport() {
    if (!file || !preview || !importForm.sourceId) { setError('Select a source and preview a file before importing.'); return; }
    setBusy('upload'); setError(''); setNotice('');
    try {
      let mappingId = '';
      const selectedFields = Object.fromEntries(Object.entries(mapping).filter(([, sourceField]) => sourceField));
      if (Object.keys(selectedFields).length) {
        const mapped = await api.post(`/ng/government-data/sources/${importForm.sourceId}/mappings`, { name: `${file.name} mapping`, fieldMap: selectedFields });
        mappingId = mapped.data.mapping.id;
      }
      const body = new FormData();
      body.append('file', file);
      Object.entries({ ...importForm, mappingId }).forEach(([key, value]) => { if (value) body.append(key, value); });
      const response = await api.post('/ng/government-data/imports/upload', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      const report = await api.get(`/ng/government-data/imports/${response.data.batch.id}`);
      setBatchReport(report.data);
      setNotice(response.data.duplicateUpload ? 'This exact upload already exists; its original batch was reopened without creating duplicates.' : 'Source rows are staged. Validate them before submission.');
    } catch (requestError) { setError(messageFrom(requestError)); }
    finally { setBusy(''); }
  }

  async function batchAction(action, payload = {}) {
    if (!batchReport?.batch?.id) return;
    setBusy(action); setError(''); setNotice('');
    try {
      await api.post(`/ng/government-data/imports/${batchReport.batch.id}/${action}`, payload);
      const report = await api.get(`/ng/government-data/imports/${batchReport.batch.id}`);
      setBatchReport(report.data);
      setNotice(`${action.charAt(0).toUpperCase()}${action.slice(1)} completed.`);
    } catch (requestError) { setError(messageFrom(requestError)); }
    finally { setBusy(''); }
  }

  async function exportRecords(format) {
    setBusy(`export-${format}`); setError('');
    try {
      const response = await api.get(`/ng/government-data/search/export/${format}`, { params: filters, responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `doctarx-government-records.${format}`; anchor.click();
      URL.revokeObjectURL(url);
    } catch (requestError) { setError(messageFrom(requestError)); }
    finally { setBusy(''); }
  }

  async function saveCurrentView() {
    if (!viewName.trim()) { setError('Give this saved view a name.'); return; }
    setBusy('save-view'); setError('');
    try {
      await api.post('/ng/government-data/saved-views', { name: viewName, filters });
      const response = await api.get('/ng/government-data/saved-views'); setViews(response.data.views || []); setViewName('');
      setNotice('View saved.');
    } catch (requestError) { setError(messageFrom(requestError)); }
    finally { setBusy(''); }
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-slate-50"><Loader2 className="h-8 w-8 animate-spin text-emerald-700" /><span className="ml-3 font-semibold text-slate-700">Checking government access…</span></div>;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-slate-950 text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">DoctaRx Nigeria · protected workspace</p><h1 className="mt-2 text-2xl font-black sm:text-3xl">Government data intake and search</h1><p className="mt-2 max-w-3xl text-sm text-slate-300">Import, validate, approve, reconcile, search, and export records inside your assigned jurisdiction.</p></div>
          <div className="flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm"><ShieldCheck className="h-5 w-5 text-emerald-300" /> MFA and scoped audit controls active</div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {error && <div role="alert" className="mb-4 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div>{error}<div className="mt-2"><Link className="font-bold underline" href="/login">Open secure sign-in</Link></div></div></div>}
        {notice && <div role="status" className="mb-4 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900"><CheckCircle2 className="h-5 w-5" />{notice}</div>}
        <div className="mb-6 flex gap-2" role="tablist" aria-label="Government data tools">
          {[['search', FileSearch, 'Search approved records'], ['import', Upload, 'Import and approve']].map(([key, Icon, label]) => <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold ${tab === key ? 'bg-slate-950 text-white' : 'border border-slate-300 bg-white text-slate-700'}`}><Icon className="h-4 w-4" />{label}</button>)}
        </div>

        {tab === 'search' ? <section className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <label className="text-sm font-bold text-slate-800" htmlFor="government-search">What are you looking for?</label>
            <div className="relative mt-2 flex gap-2"><Search className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-slate-400" /><Input id="government-search" value={filters.q} onChange={(event) => updateFilter('q', event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') search(); }} placeholder="Search facilities, indicators, programmes, or record labels" className="w-full pl-12 text-base" /><Button onClick={() => search()} disabled={busy === 'search'}>{busy === 'search' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}Search</Button></div>
            {suggestions.length > 0 && <div className="mt-2 grid rounded-xl border border-slate-200 bg-white p-2 shadow-lg">{suggestions.map((suggestion) => <button key={suggestion} onClick={() => { updateFilter('q', suggestion); setSuggestions([]); }} className="rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-100">{suggestion}</button>)}</div>}
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Facility"><Select ariaLabel="Facility filter" value={filters.facilityId} onChange={(event) => updateFilter('facilityId', event.target.value)}><option value="">All authorized facilities</option>{facilities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
              <Field label="Area Council / jurisdiction"><Select ariaLabel="Jurisdiction filter" value={filters.jurisdictionId} onChange={(event) => updateFilter('jurisdictionId', event.target.value)}><option value="">All authorized areas</option>{jurisdictions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
              <Field label="Programme"><Select ariaLabel="Programme filter" value={filters.programmeArea} onChange={(event) => updateFilter('programmeArea', event.target.value)}><option value="">All programmes</option>{PROGRAMMES.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</Select></Field>
              <Field label="Indicator"><Select ariaLabel="Indicator filter" value={filters.indicatorId} onChange={(event) => updateFilter('indicatorId', event.target.value)}><option value="">All indicators</option>{indicators.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}</Select></Field>
              <Field label="Reporting period from"><Input type="month" value={filters.periodFrom} onChange={(event) => updateFilter('periodFrom', event.target.value)} /></Field>
              <Field label="Reporting period to"><Input type="month" value={filters.periodTo} onChange={(event) => updateFilter('periodTo', event.target.value)} /></Field>
              <Field label="Observation date from"><Input type="date" value={filters.dateFrom} onChange={(event) => updateFilter('dateFrom', event.target.value)} /></Field>
              <Field label="Observation date to"><Input type="date" value={filters.dateTo} onChange={(event) => updateFilter('dateTo', event.target.value)} /></Field>
              <Field label="Approval status"><Select ariaLabel="Approval status" value={filters.approvalStatus} onChange={(event) => updateFilter('approvalStatus', event.target.value)}><option value="approved">Approved</option><option value="pending">Pending</option><option value="rejected">Rejected</option></Select></Field>
              <Field label="Referral status"><Select ariaLabel="Referral status" value={filters.referralStatus} onChange={(event) => updateFilter('referralStatus', event.target.value)}><option value="">All referral statuses</option><option value="pending">Pending</option><option value="completed">Completed</option><option value="unresolved">Unresolved</option></Select></Field>
              <Field label="Data-quality status"><Select ariaLabel="Data quality" value={filters.dataQualityStatus} onChange={(event) => updateFilter('dataQualityStatus', event.target.value)}><option value="">All quality statuses</option><option value="valid">Valid</option><option value="warning">Needs review</option><option value="invalid">Invalid</option></Select></Field>
            </div>
            <div className="mt-5 flex flex-wrap gap-2"><Button onClick={() => search()}><Filter className="h-4 w-4" />Apply filters</Button><Button tone="secondary" onClick={() => { setFilters(EMPTY_FILTERS); setSearchResult({ records: [], total: 0 }); }}><RotateCcw className="h-4 w-4" />Clear all</Button>{['csv', 'xlsx', 'pdf'].map((format) => <Button key={format} tone="secondary" onClick={() => exportRecords(format)} disabled={busy === `export-${format}`}><Download className="h-4 w-4" />{format === 'xlsx' ? 'Excel' : format.toUpperCase()}</Button>)}</div>
          </div>

          <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 px-5 py-4"><h2 className="font-black">Approved records</h2><p className="text-sm text-slate-500">{searchResult.total.toLocaleString()} results in your authorized scope</p></div><div className="overflow-x-auto" role="region" aria-label="Approved government records" tabIndex={0}><table className="w-full min-w-[780px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{['Record', 'Facility / Area', 'Programme / Indicator', 'Period', 'Value', 'Quality'].map((label) => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody>{searchResult.records.map((row) => <tr key={row.id} className="border-t border-slate-100"><td className="px-4 py-4 font-bold">{row.title}<div className="mt-1 text-xs font-normal text-slate-500">{row.record_key}</div></td><td className="px-4 py-4">{row.facility_name || 'All facilities'}<div className="text-xs text-slate-500">{row.area_council}</div></td><td className="px-4 py-4">{row.programme_area?.replaceAll('_', ' ')}<div className="text-xs text-slate-500">{row.indicator_name || 'No indicator'}</div></td><td className="px-4 py-4">{row.reporting_period}</td><td className="px-4 py-4 font-semibold">{formatValue(row.observed_value)} {row.unit || ''}</td><td className="px-4 py-4"><span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800">{row.data_quality_status}</span></td></tr>)}{!searchResult.records.length && <tr><td colSpan="6" className="px-5 py-12 text-center text-slate-500">Run a search to see approved records. Missing observations will be labelled, never shown as zero.</td></tr>}</tbody></table></div></div>
            <aside className="space-y-4"><div className="rounded-2xl border border-slate-200 bg-white p-4"><h2 className="flex items-center gap-2 font-black"><Bookmark className="h-4 w-4" />Saved views</h2><div className="mt-3 flex gap-2"><Input aria-label="Saved view name" placeholder="View name" value={viewName} onChange={(event) => setViewName(event.target.value)} className="min-w-0" /><Button onClick={saveCurrentView} className="px-3">Save</Button></div><div className="mt-3 grid gap-1">{views.map((view) => <button key={view.id} onClick={() => { setFilters({ ...EMPTY_FILTERS, ...view.filters_json }); search({ ...EMPTY_FILTERS, ...view.filters_json }); }} className="flex items-center justify-between rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-100">{view.name}<ChevronRight className="h-4 w-4" /></button>)}</div></div><div className="rounded-2xl border border-slate-200 bg-white p-4"><h2 className="font-black">Recent searches</h2><div className="mt-3 grid gap-1">{recent.map((item) => <button key={item.id} onClick={() => { setFilters({ ...EMPTY_FILTERS, ...item.filters_json }); search({ ...EMPTY_FILTERS, ...item.filters_json }); }} className="rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-100"><span className="font-semibold">{item.query_text}</span><span className="block text-xs text-slate-500">{item.result_count} results</span></button>)}</div></div></aside>
          </div>
        </section> : <section className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
          <div className="space-y-5">
            <form onSubmit={createSource} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-black">1. Register a scoped source</h2><p className="mt-1 text-sm text-slate-500">Programme administrators can register invitation-controlled sources.</p><div className="mt-4 grid gap-3"><Field label="Source name"><Input required value={sourceForm.name} onChange={(event) => setSourceForm({ ...sourceForm, name: event.target.value })} /></Field><Field label="Source format"><Select ariaLabel="Source format" value={sourceForm.sourceType} onChange={(event) => setSourceForm({ ...sourceForm, sourceType: event.target.value })}>{['csv', 'xlsx', 'json', 'api', 'dhis2'].map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</Select></Field><Field label="Jurisdiction"><Select ariaLabel="New source jurisdiction" required value={sourceForm.jurisdictionId} onChange={(event) => setSourceForm({ ...sourceForm, jurisdictionId: event.target.value })}><option value="">Select jurisdiction</option>{jurisdictions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field><Field label="Programme (optional)"><Select ariaLabel="New source programme" value={sourceForm.programmeArea} onChange={(event) => setSourceForm({ ...sourceForm, programmeArea: event.target.value })}><option value="">All programmes</option>{PROGRAMMES.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</Select></Field><Button type="submit" disabled={busy === 'source'}><Database className="h-4 w-4" />Register source</Button></div></form>
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-black">2. Select scope and source</h2><div className="mt-4 grid gap-3"><Field label="Registered source"><Select ariaLabel="Registered source" required value={importForm.sourceId} onChange={(event) => updateImport('sourceId', event.target.value)}><option value="">Select source</option>{sources.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.source_type.toUpperCase()}</option>)}</Select></Field><Field label="Jurisdiction"><Select ariaLabel="Import jurisdiction" value={importForm.jurisdictionId} onChange={(event) => updateImport('jurisdictionId', event.target.value)}><option value="">Select jurisdiction</option>{jurisdictions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field><Field label="Facility (optional for aggregate data)"><Select ariaLabel="Import facility" value={importForm.facilityId} onChange={(event) => updateImport('facilityId', event.target.value)}><option value="">All facilities</option>{facilities.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field><Field label="Programme"><Select ariaLabel="Import programme" value={importForm.programmeArea} onChange={(event) => updateImport('programmeArea', event.target.value)}><option value="">Select programme</option>{PROGRAMMES.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</Select></Field><Field label="Reporting period"><Input type="month" value={importForm.reportingPeriod} onChange={(event) => updateImport('reportingPeriod', event.target.value)} /></Field></div></div>
          </div>
          <div className="space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="font-black">3. Upload and preview</h2><p className="mt-1 text-sm text-slate-500">CSV, XLSX, or JSON; maximum 10,000 rows and 15 MB.</p><div className="mt-4 flex flex-col gap-3 sm:flex-row"><Input aria-label="Source file" type="file" accept=".csv,.xlsx,.json,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { setFile(event.target.files?.[0] || null); setPreview(null); }} className="w-full pt-2" /><Button onClick={previewFile} disabled={busy === 'preview'}><FileSearch className="h-4 w-4" />Preview</Button></div>{preview && <div className="mt-5"><div className="rounded-xl bg-slate-50 p-3 text-sm"><strong>{preview.rowCount.toLocaleString()}</strong> rows · {preview.sourceType.toUpperCase()} · {preview.headers.length} fields</div><div className="mt-4"><h3 className="font-bold">4. Map source fields</h3><p className="text-sm text-slate-500">Choose the source column for each plain-language target. Unmapped fields remain source evidence only.</p><div className="mt-3 grid gap-3 sm:grid-cols-2">{TARGET_FIELDS.map(([target, label]) => <Field key={target} label={label}><Select ariaLabel={`${label} mapping`} value={mapping[target] || ''} onChange={(event) => setMapping({ ...mapping, [target]: event.target.value })}><option value="">Not mapped</option>{preview.headers.map((header) => <option key={header} value={header}>{header}</option>)}</Select></Field>)}</div></div><div className="mt-4 overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[600px] text-left text-xs"><thead className="bg-slate-50"><tr>{preview.headers.slice(0, 8).map((header) => <th key={header} className="px-3 py-2">{header}</th>)}</tr></thead><tbody>{preview.preview.slice(0, 5).map((row, index) => <tr key={index} className="border-t border-slate-100">{preview.headers.slice(0, 8).map((header) => <td key={header} className="max-w-48 truncate px-3 py-2">{formatValue(row[header])}</td>)}</tr>)}</tbody></table></div><Button onClick={uploadImport} disabled={busy === 'upload'} className="mt-4"><Upload className="h-4 w-4" />Stage import</Button></div>}</div>
            {batchReport && <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-black">5–14. Validate, reconcile, approve, and commit</h2><p className="text-sm text-slate-500">Batch {batchReport.batch.id}</p></div><span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-bold uppercase text-white">{batchReport.batch.status}</span></div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{[['Rows', batchReport.batch.row_count], ['Valid', batchReport.batch.valid_count], ['Duplicates', batchReport.batch.duplicate_count], ['Quarantined', batchReport.batch.quarantined_count]].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 p-3"><div className="text-xs font-bold uppercase text-slate-500">{label}</div><div className="mt-1 text-2xl font-black">{value}</div></div>)}</div>{batchReport.findings.length > 0 && <div className="mt-4 max-h-64 overflow-auto rounded-xl border border-amber-200 bg-amber-50 p-3"><h3 className="font-bold text-amber-900">Plain-language validation findings</h3>{batchReport.findings.map((finding) => <div key={finding.id} className="mt-2 text-sm text-amber-900"><strong>Row {batchReport.rows.find((row) => row.id === finding.import_row_id)?.source_row_number}:</strong> {finding.plain_language_message}</div>)}</div>}<div className="mt-4 flex flex-wrap gap-2">{['previewed', 'validated'].includes(batchReport.batch.status) && <Button onClick={() => batchAction('validate')}><CheckCircle2 className="h-4 w-4" />Validate and reconcile</Button>}{batchReport.batch.status === 'validated' && <Button onClick={() => batchAction('submit')}>Submit for approval</Button>}{batchReport.batch.status === 'submitted' && <><Button onClick={() => batchAction('approve')}>Approve (checker)</Button><Button tone="danger" onClick={() => batchAction('reject', { notes: 'Rejected during government data review.' })}><XCircle className="h-4 w-4" />Reject</Button></>}{batchReport.batch.status === 'approved' && <Button onClick={() => batchAction('commit')}>Commit official records</Button>}{batchReport.batch.status === 'committed' && <Button tone="danger" onClick={() => { const reason = window.prompt('Enter the audited rollback reason'); if (reason) batchAction('rollback', { reason }); }}><RotateCcw className="h-4 w-4" />Roll back safely</Button>}<Button tone="secondary" onClick={() => window.open(`/api/ng/government-data/imports/${batchReport.batch.id}/dhis2-export`, '_blank')}><Download className="h-4 w-4" />DHIS2 preview</Button></div><p className="mt-4 text-xs leading-5 text-slate-500">The uploader cannot approve their own batch. Invalid rows stay quarantined. Duplicate rows never enter official records. Rollback preserves source and audit lineage.</p></div>}
          </div>
        </section>}
      </div>
    </main>
  );
}
