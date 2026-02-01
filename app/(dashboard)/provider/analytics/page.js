'use client';

import { useState, useEffect } from 'react';
import { 
  BarChart3, TrendingUp, Activity, Users, Heart, Brain, 
  Pill, AlertTriangle, CheckCircle, ArrowUpRight, ArrowDownRight,
  Filter, Download, RefreshCw
} from 'lucide-react';
import api from '@/lib/api';

// Mock data for demonstration (would come from /api/interop/analytics endpoints)
const treatmentEfficacyData = [
  { 
    condition_code: 'E11', 
    condition_name: 'Type 2 Diabetes',
    medication_class: 'antidiabetic',
    medication_name: 'Metformin + Diet Plan',
    sample_size: 847,
    success_rate: 78.5,
    avg_recovery_days: 90,
    readmission_rate: 8.2,
    adherence_score: 82,
    outcome_delta: -1.2, // HbA1c drop
    recommendation_score: 85.3
  },
  { 
    condition_code: 'I10', 
    condition_name: 'Hypertension',
    medication_class: 'antihypertensive',
    medication_name: 'Lisinopril + Lifestyle',
    sample_size: 1245,
    success_rate: 82.3,
    avg_recovery_days: 60,
    readmission_rate: 5.1,
    adherence_score: 79,
    outcome_delta: -18, // BP drop (mmHg)
    recommendation_score: 88.7
  },
  { 
    condition_code: 'F32', 
    condition_name: 'Major Depression',
    medication_class: 'antidepressant',
    medication_name: 'Sertraline + CBT',
    sample_size: 523,
    success_rate: 71.2,
    avg_recovery_days: 120,
    readmission_rate: 12.4,
    adherence_score: 68,
    outcome_delta: -8.5, // PHQ-9 score drop
    recommendation_score: 74.1
  },
  { 
    condition_code: 'J06', 
    condition_name: 'Upper Respiratory',
    medication_class: 'antibiotic',
    medication_name: 'Azithromycin (Z-Pack)',
    sample_size: 2341,
    success_rate: 94.1,
    avg_recovery_days: 7,
    readmission_rate: 2.3,
    adherence_score: 91,
    outcome_delta: 0,
    recommendation_score: 95.2
  },
];

const populationHealthData = [
  { age_bracket: 'pediatric', gender: 'all', condition_category: 'respiratory', patient_count: 342, chronic_rate: 8.5 },
  { age_bracket: '18-35', gender: 'all', condition_category: 'mental_health', patient_count: 567, chronic_rate: 22.3 },
  { age_bracket: '36-50', gender: 'all', condition_category: 'endocrine', patient_count: 423, chronic_rate: 35.7 },
  { age_bracket: '51-65', gender: 'all', condition_category: 'cardiovascular', patient_count: 612, chronic_rate: 42.1 },
  { age_bracket: '65+', gender: 'all', condition_category: 'musculoskeletal', patient_count: 389, chronic_rate: 58.4 },
];

const providerPerformanceData = [
  { specialty: 'Internal Medicine', completion_rate: 94.2, satisfaction: 4.6, avg_duration: 22, cost_per_episode: 125 },
  { specialty: 'Family Medicine', completion_rate: 92.8, satisfaction: 4.5, avg_duration: 18, cost_per_episode: 95 },
  { specialty: 'Psychiatry', completion_rate: 88.5, satisfaction: 4.3, avg_duration: 45, cost_per_episode: 185 },
  { specialty: 'Dermatology', completion_rate: 96.1, satisfaction: 4.7, avg_duration: 15, cost_per_episode: 110 },
];

export default function OutcomesAnalyticsPage() {
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('efficacy');
  const [selectedCondition, setSelectedCondition] = useState(null);

  async function refreshData() {
    setLoading(true);
    try {
      // In production, this would call the actual API endpoints:
      // await api.post('/interop/analytics/run-etl');
      // const efficacy = await api.get('/interop/analytics/treatment-efficacy');
      // const population = await api.get('/interop/analytics/population-health');
      // const provider = await api.get('/interop/analytics/provider-performance');
      
      await new Promise(resolve => setTimeout(resolve, 1500));
      alert('Analytics data refreshed! (Demo mode)');
    } catch (error) {
      console.error('Error refreshing:', error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <BarChart3 className="h-7 w-7 text-purple-500" />
            Outcomes Analytics
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Population health metrics and treatment efficacy - the "Bird's Eye View" for hospital partners
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={refreshData}
            disabled={loading}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Run ETL
          </button>
          <button className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2">
            <Download className="h-4 w-4" />
            Export
          </button>
        </div>
      </div>

      {/* HIPAA Notice */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-blue-600 mt-0.5" />
          <div>
            <p className="font-medium text-blue-900 dark:text-blue-100">De-Identified Data Only</p>
            <p className="text-sm text-blue-700 dark:text-blue-300">
              All data displayed is aggregated and anonymized per HIPAA Safe Harbor guidelines. 
              No PHI is exposed. This data is suitable for sharing with hospital partners, 
              insurance companies, and research institutions.
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex gap-4">
          {[
            { id: 'efficacy', name: 'Treatment Efficacy', icon: Activity },
            { id: 'population', name: 'Population Health', icon: Users },
            { id: 'provider', name: 'Provider Performance', icon: TrendingUp },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-purple-500 text-purple-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.name}
            </button>
          ))}
        </nav>
      </div>

      {/* Treatment Efficacy Tab */}
      {activeTab === 'efficacy' && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-500">Avg Success Rate</p>
                <ArrowUpRight className="h-4 w-4 text-green-500" />
              </div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">81.5%</p>
              <p className="text-xs text-green-600">+3.2% vs last quarter</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-500">Readmission Rate</p>
                <ArrowDownRight className="h-4 w-4 text-green-500" />
              </div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">7.0%</p>
              <p className="text-xs text-green-600">-1.5% vs last quarter</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
              <p className="text-sm text-gray-500">Avg Adherence</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">80%</p>
              <p className="text-xs text-gray-500">Based on refill patterns</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
              <p className="text-sm text-gray-500">Total Sample Size</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">4,956</p>
              <p className="text-xs text-gray-500">Anonymized patients</p>
            </div>
          </div>

          {/* Treatment Efficacy Table - THE SCHEMA */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-white">
                Treatment Efficacy Metrics (OutcomeSuccessMetrics Schema)
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                Correlates ICD-10 diagnoses with RxNorm medications and recovery outcomes
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Condition (ICD-10)
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Treatment Plan
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                      Sample Size
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                      Success Rate
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                      Readmission %
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                      Adherence
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                      Outcome Delta
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                      Score
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {treatmentEfficacyData.map((row, idx) => (
                    <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-4">
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">{row.condition_name}</p>
                          <p className="text-xs text-gray-500">{row.condition_code}</p>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <Pill className="h-4 w-4 text-purple-500" />
                          <span className="text-sm">{row.medication_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <span className="font-mono text-sm">{row.sample_size.toLocaleString()}</span>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          row.success_rate >= 80 ? 'bg-green-100 text-green-800' :
                          row.success_rate >= 70 ? 'bg-yellow-100 text-yellow-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {row.success_rate}%
                        </span>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          row.readmission_rate <= 5 ? 'bg-green-100 text-green-800' :
                          row.readmission_rate <= 10 ? 'bg-yellow-100 text-yellow-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                          {row.readmission_rate}%
                        </span>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                          <div 
                            className="bg-purple-500 h-2 rounded-full"
                            style={{ width: `${row.adherence_score}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500">{row.adherence_score}%</span>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <span className={`font-mono text-sm ${
                          row.outcome_delta < 0 ? 'text-green-600' : 'text-gray-500'
                        }`}>
                          {row.outcome_delta < 0 ? row.outcome_delta : '-'}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-center">
                        <span className="font-bold text-purple-600">{row.recommendation_score.toFixed(1)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Schema Definition */}
          <div className="bg-gray-900 rounded-xl p-6 text-green-400 font-mono text-sm overflow-x-auto">
            <p className="text-gray-500 mb-2">-- SQL Schema: analytics_outcome_metrics (The "Bird's Eye View")</p>
            <pre>{`CREATE TABLE analytics_outcome_metrics (
  condition_code VARCHAR(20),      -- ICD-10 (e.g., E11.9 for Type 2 Diabetes)
  medication_class VARCHAR(100),   -- RxNorm therapeutic class
  treatment_plan_id VARCHAR(100),  -- e.g., "Metformin + Diet Plan A"
  sample_size INTEGER,             -- Number of anonymized patients
  avg_recovery_days DECIMAL(10,2), -- Average time to recovery
  success_rate DECIMAL(5,2),       -- Percentage 0-100
  readmission_rate DECIMAL(5,2),   -- Did they end up back in hospital?
  adherence_score_avg DECIMAL(5,2),-- 0-100 based on patient logs
  outcome_delta_avg DECIMAL(10,2)  -- Change in key vitals (e.g., HbA1c drop)
);`}</pre>
          </div>
        </div>
      )}

      {/* Population Health Tab */}
      {activeTab === 'population' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* By Age Bracket */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Chronic Condition Rate by Age</h3>
              <div className="space-y-4">
                {populationHealthData.map((row, idx) => (
                  <div key={idx} className="flex items-center gap-4">
                    <span className="w-20 text-sm text-gray-500">{row.age_bracket}</span>
                    <div className="flex-1">
                      <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-4">
                        <div 
                          className="bg-gradient-to-r from-purple-500 to-indigo-500 h-4 rounded-full"
                          style={{ width: `${row.chronic_rate}%` }}
                        />
                      </div>
                    </div>
                    <span className="w-12 text-sm font-medium text-right">{row.chronic_rate}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Patient Distribution */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Patient Distribution</h3>
              <div className="space-y-3">
                {populationHealthData.map((row, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white capitalize">
                        {row.condition_category.replace('_', ' ')}
                      </p>
                      <p className="text-xs text-gray-500">Age: {row.age_bracket}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-purple-600">{row.patient_count}</p>
                      <p className="text-xs text-gray-500">patients</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Provider Performance Tab */}
      {activeTab === 'provider' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-white">
                Provider Performance Index (ProviderPerformanceIndex Schema)
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                For insurance companies and quality reporting - all provider IDs are hashed
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Specialty</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Completion Rate</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Patient Satisfaction</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Avg Duration (min)</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Cost/Episode</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Performance Tier</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {providerPerformanceData.map((row, idx) => (
                    <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-4 font-medium text-gray-900 dark:text-white">{row.specialty}</td>
                      <td className="px-4 py-4 text-center">{row.completion_rate}%</td>
                      <td className="px-4 py-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {'★'.repeat(Math.floor(row.satisfaction))}
                          <span className="text-sm text-gray-500">{row.satisfaction}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-center">{row.avg_duration}</td>
                      <td className="px-4 py-4 text-center">${row.cost_per_episode}</td>
                      <td className="px-4 py-4 text-center">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          row.completion_rate >= 95 ? 'bg-green-100 text-green-800' :
                          row.completion_rate >= 90 ? 'bg-blue-100 text-blue-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {row.completion_rate >= 95 ? 'Tier 1 - Excellent' :
                           row.completion_rate >= 90 ? 'Tier 2 - Good' : 'Tier 3 - Acceptable'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
