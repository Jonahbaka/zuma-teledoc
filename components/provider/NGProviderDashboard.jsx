'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import {
  LayoutDashboard, Users, Activity, Settings, Bell, Search,
  Filter, Plus, MoreHorizontal, ArrowUpRight, ArrowDownRight,
  Clock, Calendar as CalendarIcon, Video, MapPin, Pill, Syringe,
  AlertTriangle, CheckCircle2, ChevronRight, X, FileText,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart, Bar, Line, Legend,
} from 'recharts';

/* ---------- mock data (replace with real API calls as needed) ---------- */
const admissionData = [
  { time: '08:00', admissions: 12, discharges: 5, capacity: 80, predicted: 15 },
  { time: '10:00', admissions: 19, discharges: 8, capacity: 85, predicted: 22 },
  { time: '12:00', admissions: 15, discharges: 14, capacity: 90, predicted: 18 },
  { time: '14:00', admissions: 22, discharges: 12, capacity: 95, predicted: 25 },
  { time: '16:00', admissions: 18, discharges: 20, capacity: 92, predicted: 20 },
  { time: '18:00', admissions: 14, discharges: 18, capacity: 88, predicted: 16 },
  { time: '20:00', admissions: 8, discharges: 10, capacity: 82, predicted: 10 },
];

const vitalsHistory = [
  { date: 'Mon', hr: 72, bpSys: 120 },
  { date: 'Tue', hr: 75, bpSys: 122 },
  { date: 'Wed', hr: 82, bpSys: 135 },
  { date: 'Thu', hr: 78, bpSys: 128 },
  { date: 'Fri', hr: 74, bpSys: 124 },
  { date: 'Sat', hr: 71, bpSys: 118 },
  { date: 'Sun', hr: 73, bpSys: 120 },
];

const patientData = [
  { id: 'PT-9821', name: 'Eleanor Pena', age: 64, gender: 'F', risk: 88, diagnosis: 'Heart Failure (CHF)', lastVisit: '2 hrs ago', status: 'Critical', nextAction: 'Cardio Consult', avatar: 'EP' },
  { id: 'PT-1045', name: 'Robert Fox', age: 45, gender: 'M', risk: 42, diagnosis: 'Type 2 Diabetes', lastVisit: '1 day ago', status: 'Stable', nextAction: 'A1C Lab Test', avatar: 'RF' },
  { id: 'PT-4428', name: 'Esther Howard', age: 28, gender: 'F', risk: 15, diagnosis: 'Routine Maternity', lastVisit: '3 days ago', status: 'Routine', nextAction: 'Ultrasound', avatar: 'EH' },
  { id: 'PT-2910', name: 'Kristin Watson', age: 52, gender: 'F', risk: 65, diagnosis: 'Severe Asthma', lastVisit: '5 hrs ago', status: 'Monitoring', nextAction: 'Pulm Review', avatar: 'KW' },
  { id: 'PT-8834', name: 'Cody Fisher', age: 71, gender: 'M', risk: 92, diagnosis: 'Post-op CABG', lastVisit: '10 mins ago', status: 'Critical', nextAction: 'Med Adjustment', avatar: 'CF' },
  { id: 'PT-3392', name: 'Jane Cooper', age: 34, gender: 'F', risk: 28, diagnosis: 'Hypertension', lastVisit: '1 week ago', status: 'Stable', nextAction: 'BP Check', avatar: 'JC' },
  { id: 'PT-7712', name: 'Cameron Williamson', age: 41, gender: 'M', risk: 55, diagnosis: 'Chronic Kidney Dis.', lastVisit: '2 days ago', status: 'Monitoring', nextAction: 'Nephrology', avatar: 'CW' },
];

/* ---------- small reusable pieces ---------- */

const Badge = ({ children, variant = 'gray' }) => {
  const v = {
    red: 'bg-rose-50 text-rose-700 border-rose-200',
    orange: 'bg-amber-50 text-amber-700 border-amber-200',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    gray: 'bg-slate-100 text-slate-700 border-slate-200',
    purple: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  };
  return (
    <span className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${v[variant]}`}>
      {children}
    </span>
  );
};

const RiskBar = ({ score }) => {
  const color = score > 75 ? 'bg-rose-500' : score > 40 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="flex items-center w-full max-w-[120px]">
      <span className="text-xs font-bold w-6 mr-2">{score}</span>
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white/95 border border-slate-200 p-3 rounded-lg shadow-xl text-sm">
      <p className="font-bold text-slate-900 mb-2">{label}</p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center justify-between space-x-4 mb-1">
          <div className="flex items-center text-slate-600">
            <div className="w-2 h-2 rounded-full mr-2" style={{ backgroundColor: entry.color }} />
            <span className="capitalize">{entry.name}</span>
          </div>
          <span className="font-bold text-slate-900">{entry.value}</span>
        </div>
      ))}
    </div>
  );
};

/* ---------- Patient Drawer ---------- */
function PatientDrawer({ patient, onClose, onStartCall }) {
  if (!patient) return null;
  return (
    <div className="fixed inset-y-0 right-0 w-[500px] bg-white shadow-2xl border-l border-slate-200 z-[60] flex flex-col">
      <div className="px-6 py-5 border-b border-slate-200 flex justify-between items-start bg-slate-50/50">
        <div className="flex items-center space-x-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center text-xl font-extrabold shadow-sm border border-indigo-200">
            {patient.avatar}
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">{patient.name}</h2>
            <div className="flex items-center text-sm text-slate-500 mt-1 space-x-2">
              <span>{patient.id}</span><span>•</span>
              <span>{patient.age}y {patient.gender}</span><span>•</span>
              <Badge variant={patient.risk > 75 ? 'red' : patient.risk > 40 ? 'orange' : 'green'}>
                {patient.status}
              </Badge>
            </div>
          </div>
        </div>
        <button onClick={onClose} className="p-2 bg-white hover:bg-slate-100 rounded-full text-slate-500 border border-slate-200 shadow-sm">
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500" />
          <div className="flex items-start">
            <Activity size={20} className="text-indigo-600 mr-3 mt-0.5 shrink-0" />
            <div>
              <h4 className="text-sm font-bold text-indigo-900 mb-1">AI Clinical Insight</h4>
              <p className="text-sm text-indigo-800/80 leading-relaxed">
                Patient exhibits a 15% increase in baseline heart rate over the last 48 hours. Combined with {patient.diagnosis}, model predicts a 68% chance of readmission within 7 days. Recommend med reconciliation.
              </p>
            </div>
          </div>
        </div>

        <div>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Vitals Trend (7 Days)</h3>
          </div>
          <div className="h-48 bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={vitalsHistory} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748B' }} dy={10} />
                <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748B' }} />
                <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748B' }} />
                <Tooltip content={<CustomTooltip />} />
                <Line yAxisId="left" type="monotone" dataKey="hr" name="Heart Rate" stroke="#EF4444" strokeWidth={3} dot={{ r: 4, fill: '#EF4444' }} activeDot={{ r: 6 }} />
                <Line yAxisId="right" type="monotone" dataKey="bpSys" name="BP Systolic" stroke="#3B82F6" strokeWidth={3} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl">
            <div className="flex items-center text-slate-500 mb-2">
              <Syringe size={16} className="mr-2" />
              <span className="text-xs font-bold uppercase tracking-wider">Primary Dx</span>
            </div>
            <p className="font-semibold text-slate-900 text-sm">{patient.diagnosis}</p>
          </div>
          <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl">
            <div className="flex items-center text-slate-500 mb-2">
              <CalendarIcon size={16} className="mr-2" />
              <span className="text-xs font-bold uppercase tracking-wider">Next Enc.</span>
            </div>
            <p className="font-semibold text-slate-900 text-sm">{patient.nextAction}</p>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4">Active Medications</h3>
          <div className="space-y-3">
            {['Lisinopril 10mg - QD', 'Metoprolol 25mg - BID', 'Atorvastatin 40mg - QHS'].map((med, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg shadow-sm">
                <div className="flex items-center">
                  <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center mr-3">
                    <Pill size={14} className="text-blue-600" />
                  </div>
                  <span className="text-sm font-medium text-slate-800">{med}</span>
                </div>
                <CheckCircle2 size={16} className="text-emerald-500" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="p-4 border-t border-slate-200 bg-slate-50 grid grid-cols-2 gap-3">
        <button className="flex items-center justify-center py-2.5 bg-white border border-slate-300 rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-50 shadow-sm">
          <FileText size={16} className="mr-2" /> View Chart
        </button>
        <button
          onClick={onStartCall}
          className="flex items-center justify-center py-2.5 bg-indigo-600 rounded-lg text-sm font-bold text-white hover:bg-indigo-700 shadow-sm"
        >
          <Video size={16} className="mr-2" /> Telehealth Call
        </button>
      </div>
    </div>
  );
}

/* ---------- Command Center ---------- */
function CommandCenter() {
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { title: 'Current Census', value: '248', sub: '82% Capacity', trend: '+12', isPositive: false, icon: Users, color: 'blue' },
          { title: 'Critical Patients', value: '42', sub: '16 ICU / 26 Ward', trend: '-3', isPositive: true, icon: AlertTriangle, color: 'rose' },
          { title: 'Avg Wait Time', value: '14m', sub: 'Emergency Dept', trend: '-2m', isPositive: true, icon: Clock, color: 'emerald' },
          { title: 'Pending Discharges', value: '28', sub: 'By 5:00 PM', trend: '+5', isPositive: true, icon: ArrowUpRight, color: 'indigo' },
        ].map((kpi, i) => (
          <div key={i} className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm relative overflow-hidden group hover:border-slate-300 transition-colors">
            <div className={`absolute top-0 right-0 w-24 h-24 bg-${kpi.color}-50 rounded-bl-full -mr-4 -mt-4 opacity-50`} />
            <div className="flex justify-between items-start mb-4 relative z-10">
              <div className="flex items-center space-x-2">
                <div className={`p-2 bg-${kpi.color}-100 text-${kpi.color}-600 rounded-lg`}>
                  <kpi.icon size={18} />
                </div>
                <span className="text-sm font-bold text-slate-500">{kpi.title}</span>
              </div>
            </div>
            <div className="flex items-baseline space-x-3 relative z-10">
              <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">{kpi.value}</h2>
              <span className={`flex items-center text-sm font-bold ${kpi.isPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
                {kpi.isPositive ? <ArrowDownRight size={14} className="mr-0.5" /> : <ArrowUpRight size={14} className="mr-0.5" />}
                {kpi.trend}
              </span>
            </div>
            <p className="text-xs font-medium text-slate-400 mt-1">{kpi.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center">
            <div>
              <h3 className="text-base font-bold text-slate-900">Patient Flow &amp; Capacity Forecast</h3>
              <p className="text-xs text-slate-500 mt-1">Real-time tracking of admissions vs. discharges</p>
            </div>
            <div className="flex bg-slate-100 p-1 rounded-lg">
              <button className="px-3 py-1 text-xs font-bold bg-white shadow-sm rounded-md text-slate-800">Today</button>
              <button className="px-3 py-1 text-xs font-bold text-slate-500 hover:text-slate-800">Week</button>
            </div>
          </div>
          <div className="p-6 flex-1 min-h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={admissionData} margin={{ top: 20, right: 20, bottom: 20, left: -20 }}>
                <defs>
                  <linearGradient id="colorCapacityNG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#818CF8" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#818CF8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 12 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 12 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '12px', fontWeight: 'bold', color: '#475569' }} />
                <Area type="monotone" dataKey="capacity" name="System Capacity" fill="url(#colorCapacityNG)" stroke="#818CF8" strokeWidth={2} strokeDasharray="5 5" />
                <Bar dataKey="admissions" name="Admissions" fill="#3B82F6" radius={[4, 4, 0, 0]} maxBarSize={40} />
                <Bar dataKey="discharges" name="Discharges" fill="#10B981" radius={[4, 4, 0, 0]} maxBarSize={40} />
                <Line type="monotone" dataKey="predicted" name="AI Prediction" stroke="#F59E0B" strokeWidth={3} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-base font-bold text-slate-900">Priority Triage</h3>
              <Badge variant="red">3 Critical</Badge>
            </div>
            <div className="space-y-3">
              {[
                { room: 'ER-A', issue: 'Chest Pain / STEMI Protocol', time: '2m ago', color: 'rose' },
                { room: 'ICU-4', issue: 'Desaturation Alarm', time: '5m ago', color: 'rose' },
                { room: 'Wrd-2', issue: 'Fall Risk Alert', time: '12m ago', color: 'amber' },
              ].map((alert, i) => (
                <div key={i} className={`p-3 rounded-xl border border-${alert.color}-100 bg-${alert.color}-50/50 flex items-start space-x-3`}>
                  <div className={`mt-0.5 w-2 h-2 rounded-full bg-${alert.color}-500 animate-pulse`} />
                  <div className="flex-1">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-extrabold text-slate-800">{alert.room}</span>
                      <span className={`text-[10px] font-bold text-${alert.color}-600`}>{alert.time}</span>
                    </div>
                    <p className="text-xs font-medium text-slate-600 mt-0.5">{alert.issue}</p>
                  </div>
                </div>
              ))}
            </div>
            <button className="w-full mt-4 py-2 text-sm font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors">
              View All Alerts
            </button>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <h3 className="text-base font-bold text-slate-900 mb-4">Upcoming Consults</h3>
            <div className="relative pl-4 border-l-2 border-slate-100 space-y-6">
              {[
                { time: '09:00', pt: 'Eleanor Pena', type: 'Video', icon: Video, color: 'blue' },
                { time: '09:30', pt: 'Robert Fox', type: 'In-Person', icon: MapPin, color: 'emerald' },
                { time: '10:15', pt: 'Kristin Watson', type: 'Urgent', icon: AlertTriangle, color: 'rose' },
              ].map((appt, i) => (
                <div key={i} className="relative">
                  <div className={`absolute -left-[25px] w-4 h-4 rounded-full bg-white border-2 border-${appt.color}-500 ring-4 ring-white`} />
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-sm font-bold text-slate-900">{appt.pt}</p>
                      <div className="flex items-center text-xs text-slate-500 mt-1">
                        <appt.icon size={12} className="mr-1" /> {appt.type}
                      </div>
                    </div>
                    <span className="text-xs font-bold text-slate-600 bg-slate-100 px-2 py-1 rounded">{appt.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Patient Directory ---------- */
function PatientDirectory({ onSelectPatient }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm animate-in fade-in duration-500 flex flex-col h-[calc(100vh-140px)]">
      <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Population Health Grid</h2>
          <p className="text-sm text-slate-500">Manage active patients with risk stratification.</p>
        </div>
        <div className="flex items-center space-x-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              placeholder="Search patients, IDs..."
              className="pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none w-64"
            />
          </div>
          <button className="px-4 py-2 text-sm font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg flex items-center shadow-sm">
            <Filter size={16} className="mr-2" /> Filters
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-slate-50/30">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 bg-slate-100/90 backdrop-blur-md z-10 shadow-sm">
            <tr className="text-xs font-extrabold text-slate-500 uppercase tracking-wider">
              <th className="px-6 py-4 border-b border-slate-200">Patient Details</th>
              <th className="px-6 py-4 border-b border-slate-200">Primary Diagnosis</th>
              <th className="px-6 py-4 border-b border-slate-200 w-48">Acuity Risk Score</th>
              <th className="px-6 py-4 border-b border-slate-200">Current Status</th>
              <th className="px-6 py-4 border-b border-slate-200 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {patientData.map((patient, i) => (
              <tr key={i} className="hover:bg-indigo-50/30 transition-colors group cursor-pointer" onClick={() => onSelectPatient(patient)}>
                <td className="px-6 py-4">
                  <div className="flex items-center">
                    <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 font-bold mr-4 shrink-0 group-hover:bg-indigo-100 group-hover:text-indigo-700 transition-colors">
                      {patient.avatar}
                    </div>
                    <div>
                      <div className="font-bold text-slate-900 text-sm">{patient.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5 font-medium">ID: {patient.id} • {patient.age}y {patient.gender}</div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="text-sm font-semibold text-slate-800">{patient.diagnosis}</div>
                  <div className="text-xs text-slate-400 mt-0.5 flex items-center">
                    <Clock size={12} className="mr-1" /> Last visit {patient.lastVisit}
                  </div>
                </td>
                <td className="px-6 py-4"><RiskBar score={patient.risk} /></td>
                <td className="px-6 py-4">
                  <Badge variant={patient.risk > 75 ? 'red' : patient.risk > 40 ? 'orange' : 'green'}>
                    {patient.status}
                  </Badge>
                </td>
                <td className="px-6 py-4 text-right">
                  <button className="text-indigo-600 hover:bg-indigo-50 p-2 rounded-lg font-bold text-sm inline-flex items-center opacity-0 group-hover:opacity-100">
                    View 360 <ChevronRight size={16} className="ml-1" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="p-4 border-t border-slate-200 bg-white flex items-center justify-between text-sm text-slate-500">
        <span>Showing 1 to {patientData.length} of 2,451 patients</span>
        <div className="flex space-x-1">
          <button className="px-3 py-1 border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-50" disabled>Prev</button>
          <button className="px-3 py-1 border border-slate-200 bg-indigo-50 text-indigo-700 font-bold rounded">1</button>
          <button className="px-3 py-1 border border-slate-200 rounded hover:bg-slate-50">2</button>
          <button className="px-3 py-1 border border-slate-200 rounded hover:bg-slate-50">3</button>
          <button className="px-3 py-1 border border-slate-200 rounded hover:bg-slate-50">Next</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Main export ---------- */
export default function NGProviderDashboard() {
  const router = useRouter();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('command');
  const [selectedPatient, setSelectedPatient] = useState(null);

  const initials = user
    ? `${(user.first_name || user.firstName || 'D')[0]}${(user.last_name || user.lastName || 'R')[0]}`.toUpperCase()
    : 'DR';
  const displayName = user
    ? `Dr. ${user.last_name || user.lastName || user.name || 'Provider'}`
    : 'Dr. Provider';
  const specialty = user?.specialty || user?.specialization || 'Provider';

  const NavItem = ({ id, icon: Icon, label }) => {
    const active = activeTab === id;
    return (
      <button
        onClick={() => { setActiveTab(id); setSelectedPatient(null); }}
        className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-200 ${active ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 font-medium'}`}
      >
        <Icon size={20} className={active ? 'text-white' : 'text-slate-400'} />
        <span className={`text-sm ${active ? 'font-bold' : ''}`}>{label}</span>
      </button>
    );
  };

  return (
    /* fixed overlay so this full-screen UI renders on top of any parent layout wrapper */
    <div className="fixed inset-0 z-50 flex h-screen w-screen bg-[#F8FAFC] font-sans text-slate-900 overflow-hidden">
      {selectedPatient && (
        <div
          className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-[55] transition-opacity"
          onClick={() => setSelectedPatient(null)}
        />
      )}

      {/* Left Sidebar */}
      <aside className="w-[260px] bg-white border-r border-slate-200 flex flex-col z-10 shadow-sm shrink-0">
        <div className="h-20 flex items-center px-6 border-b border-slate-100">
          <div className="w-10 h-10 bg-gradient-to-br from-indigo-600 to-indigo-800 rounded-xl flex items-center justify-center mr-3 shadow-lg shadow-indigo-200">
            <Activity size={24} className="text-white" />
          </div>
          <div>
            <span className="font-extrabold tracking-tight text-xl text-slate-900 block leading-none">DoctaRx</span>
            <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest mt-1 block">Nigeria · Provider</span>
          </div>
        </div>

        <div className="p-4 space-y-1.5 flex-1 mt-2">
          <div className="px-4 text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Dashboards</div>
          <NavItem id="command" icon={LayoutDashboard} label="Command Center" />
          <NavItem id="population" icon={Users} label="Population Health" />
          <NavItem id="documents" icon={FileText} label="Clinical Records" />

          <div className="px-4 text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 mt-6">Workspace</div>
          <NavItem id="schedule" icon={CalendarIcon} label="Schedule" />
          <button
            onClick={() => router.push('/ng/provider/call')}
            className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-200 text-slate-500 hover:bg-slate-100 hover:text-slate-900 font-medium"
          >
            <Video size={20} className="text-slate-400" />
            <span className="text-sm">Telehealth Center</span>
          </button>
        </div>

        <div className="p-4 border-t border-slate-100 m-4 bg-slate-50 rounded-2xl border flex items-center">
          <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 font-bold border-2 border-white shadow-sm shrink-0 mr-3">
            {initials}
          </div>
          <div className="overflow-hidden">
            <p className="text-sm font-bold text-slate-900 truncate">{displayName}</p>
            <p className="text-xs font-medium text-slate-500 truncate">{specialty}</p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <header className="h-20 bg-white/80 backdrop-blur-xl border-b border-slate-200 flex items-center justify-between px-8 z-10 shrink-0">
          <div className="flex items-center">
            <h1 className="text-xl font-extrabold text-slate-800 mr-4">
              {activeTab === 'command' && 'Command Center'}
              {activeTab === 'population' && 'Population Directory'}
              {activeTab !== 'command' && activeTab !== 'population' && 'Module Viewer'}
            </h1>
            {activeTab === 'command' && (
              <span className="flex items-center text-xs font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-100">
                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full mr-2 animate-pulse" /> Live Updates
              </span>
            )}
          </div>
          <div className="flex items-center space-x-4">
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="text"
                placeholder="Global Search (Ctrl+K)"
                className="w-64 bg-slate-100 border border-transparent focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 rounded-full py-2 pl-10 pr-4 text-sm font-medium outline-none"
              />
            </div>
            <button className="relative p-2 text-slate-400 hover:bg-slate-100 rounded-full">
              <Bell size={20} />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-rose-500 border-2 border-white rounded-full" />
            </button>
            <button className="flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-lg shadow-sm">
              <Plus size={16} className="mr-2" /> New Order
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-8 relative">
          {activeTab === 'command' && <CommandCenter />}
          {activeTab === 'population' && <PatientDirectory onSelectPatient={setSelectedPatient} />}
          {activeTab !== 'command' && activeTab !== 'population' && (
            <div className="flex flex-col items-center justify-center h-full text-slate-400">
              <Settings size={48} className="mb-4 opacity-20" />
              <p className="text-lg font-medium text-slate-500">Module under configuration.</p>
            </div>
          )}
        </div>
      </main>

      <PatientDrawer
        patient={selectedPatient}
        onClose={() => setSelectedPatient(null)}
        onStartCall={() => router.push('/ng/provider/call')}
      />
    </div>
  );
}
