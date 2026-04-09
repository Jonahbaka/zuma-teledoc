'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  Brain, Activity, TrendingUp, AlertTriangle, Users, BarChart3,
  RefreshCw, ChevronDown, ChevronUp, Shield, Zap, Target,
  Heart, Clock, DollarSign, FileText, Play, Eye
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

export default function PredictiveEnginePage() {
  const [activeTab, setActiveTab] = useState('overview');
  const [models, setModels] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [trainingModel, setTrainingModel] = useState(null);
  const [expandedModel, setExpandedModel] = useState(null);

  const getToken = () => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('accessToken');
    }
    return null;
  };

  const apiCall = useCallback(async (endpoint, method = 'GET', body = null) => {
    const token = getToken();
    const options = {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    };
    if (body) options.body = JSON.stringify(body);
    try {
      const res = await fetch(`${API_URL}/predictive${endpoint}`, options);
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data.data || data;
    } catch (err) {
      console.error('API call failed:', err);
      return null;
    }
  }, []);

  const loadDashboard = useCallback(async () => {
    try {
      setLoading(true);
      const [modelsData, alertsData] = await Promise.all([
        apiCall('/models/status'),
        apiCall('/alerts?limit=10')
      ]);
      if (modelsData) setModels(Array.isArray(modelsData) ? modelsData : modelsData.models || []);
      if (alertsData) setStats(prev => ({ ...prev, alerts: Array.isArray(alertsData) ? alertsData : alertsData.alerts || [] }));
    } catch (error) {
      console.error('Dashboard load error:', error);
    } finally {
      setLoading(false);
    }
  }, [apiCall]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  const triggerTraining = async (modelType) => {
    setTrainingModel(modelType);
    try {
      await apiCall(`/models/train/${modelType}`, 'POST');
      alert(`Training started for ${modelType}`);
      await loadDashboard();
    } catch (error) {
      alert(`Training failed: ${error.message}`);
    } finally {
      setTrainingModel(null);
    }
  };

  const modelIcons = {
    readmission_risk: Heart,
    claims_denial: DollarSign,
    no_show: Clock,
    sepsis_warning: AlertTriangle,
    disease_progression: Activity,
    cost_forecast: TrendingUp,
    quality_measures: Target
  };

  const modelDescriptions = {
    readmission_risk: 'Predicts 30-day hospital readmission probability based on patient history, diagnoses, and social determinants.',
    claims_denial: 'Identifies insurance claims likely to be denied and recommends corrective actions before submission.',
    no_show: 'Forecasts appointment no-show probability using scheduling patterns, weather, and patient engagement data.',
    sepsis_warning: 'Early detection of sepsis risk using vital signs, labs, and clinical trajectory analysis.',
    disease_progression: 'Models chronic disease progression to enable proactive care interventions.',
    cost_forecast: 'Projects patient and population healthcare costs for financial planning and risk adjustment.',
    quality_measures: 'Tracks and predicts CMS quality measure performance (HEDIS, MIPS, Star Ratings).'
  };

  if (loading) {
    return (
      <div className="min-h-screen contrast-dark bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <Brain className="w-16 h-16 text-purple-400 animate-pulse mx-auto mb-4" />
          <p className="text-gray-400 text-lg">Loading Predictive Intelligence Engine...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen contrast-dark bg-gray-950 text-gray-100">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Brain className="w-8 h-8 text-purple-400" />
            <div>
              <h1 className="text-xl font-bold">Predictive Intelligence Engine</h1>
              <p className="text-sm text-gray-400">DoctaRx Enterprise AI/ML Platform</p>
            </div>
          </div>
          <button onClick={loadDashboard} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-medium flex items-center gap-2">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="bg-gray-900/50 border-b border-gray-800 px-6">
        <div className="flex gap-1">
          {[
            { id: 'overview', label: 'Overview', icon: Eye },
            { id: 'models', label: `Models (${models.length})`, icon: Brain },
            { id: 'alerts', label: 'Alerts', icon: AlertTriangle },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium flex items-center gap-2 border-b-2 transition-colors ${
                activeTab === tab.id ? 'border-purple-500 text-purple-400' : 'border-transparent text-gray-400 hover:text-gray-200'}`}>
              <tab.icon className="w-4 h-4" /> {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6 max-w-[1600px] mx-auto">
        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Status Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                <div className="flex items-center gap-3 mb-2">
                  <Brain className="w-5 h-5 text-purple-400" />
                  <span className="text-sm text-gray-400">Active Models</span>
                </div>
                <p className="text-3xl font-bold">{models.filter(m => m.status === 'production' || m.is_champion).length}</p>
                <p className="text-xs text-gray-500 mt-1">of {models.length} total registered</p>
              </div>
              <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                <div className="flex items-center gap-3 mb-2">
                  <Target className="w-5 h-5 text-green-400" />
                  <span className="text-sm text-gray-400">Champion Models</span>
                </div>
                <p className="text-3xl font-bold text-green-400">{models.filter(m => m.is_champion).length}</p>
                <p className="text-xs text-gray-500 mt-1">Production-ready models</p>
              </div>
              <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                <div className="flex items-center gap-3 mb-2">
                  <BarChart3 className="w-5 h-5 text-blue-400" />
                  <span className="text-sm text-gray-400">Model Types</span>
                </div>
                <p className="text-3xl font-bold">{new Set(models.map(m => m.model_type)).size}</p>
                <p className="text-xs text-gray-500 mt-1">Prediction categories</p>
              </div>
              <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                <div className="flex items-center gap-3 mb-2">
                  <Shield className="w-5 h-5 text-yellow-400" />
                  <span className="text-sm text-gray-400">Alerts</span>
                </div>
                <p className="text-3xl font-bold">{stats?.alerts?.length || 0}</p>
                <p className="text-xs text-gray-500 mt-1">Active predictions alerts</p>
              </div>
            </div>

            {/* Model Grid */}
            <div>
              <h2 className="text-lg font-semibold mb-3 flex items-center gap-2"><Brain className="w-5 h-5 text-purple-400" /> Predictive Models</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.entries(modelDescriptions).map(([type, desc]) => {
                  const Icon = modelIcons[type] || Brain;
                  const model = models.find(m => m.model_type === type && m.is_champion);
                  return (
                    <div key={type} className="bg-gray-900 rounded-xl p-5 border border-gray-800 hover:border-gray-700 transition-colors">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-purple-900/30 flex items-center justify-center">
                            <Icon className="w-5 h-5 text-purple-400" />
                          </div>
                          <div>
                            <h3 className="font-medium text-sm">{type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</h3>
                            <span className={`text-xs ${model ? 'text-green-400' : 'text-gray-500'}`}>
                              {model ? `v${model.model_version} - Champion` : 'No champion'}
                            </span>
                          </div>
                        </div>
                        <button onClick={() => triggerTraining(type)} disabled={trainingModel === type}
                          className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg disabled:opacity-50" title="Train Model">
                          {trainingModel === type ? <RefreshCw className="w-4 h-4 text-purple-400 animate-spin" /> : <Play className="w-4 h-4 text-purple-400" />}
                        </button>
                      </div>
                      <p className="text-xs text-gray-500 line-clamp-2">{desc}</p>
                      {model && (
                        <div className="mt-3 pt-3 border-t border-gray-800 flex items-center justify-between text-xs">
                          <span className="text-gray-500">Algorithm: <span className="text-gray-300">{model.algorithm}</span></span>
                          <span className="text-gray-500">{model.status}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* MODELS TAB */}
        {activeTab === 'models' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Model Registry</h2>
            {models.length === 0 ? (
              <div className="bg-gray-900 rounded-xl p-8 text-center border border-gray-800">
                <Brain className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400">No models registered yet.</p>
              </div>
            ) : models.map(model => {
              const Icon = modelIcons[model.model_type] || Brain;
              return (
                <div key={model.id} className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                  <div className="p-5 cursor-pointer" onClick={() => setExpandedModel(expandedModel === model.id ? null : model.id)}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Icon className="w-6 h-6 text-purple-400" />
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium">{model.model_name}</h3>
                            {model.is_champion && <span className="px-2 py-0.5 bg-green-900/50 text-green-300 rounded text-xs">Champion</span>}
                          </div>
                          <p className="text-xs text-gray-500">v{model.model_version} &middot; {model.model_type} &middot; {model.algorithm}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          model.status === 'production' ? 'bg-green-900/50 text-green-300' :
                          model.status === 'staging' ? 'bg-yellow-900/50 text-yellow-300' :
                          'ui-dark-chip'}`}>{model.status}</span>
                        {expandedModel === model.id ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
                      </div>
                    </div>
                  </div>
                  {expandedModel === model.id && (
                    <div className="px-5 pb-5 border-t border-gray-800 pt-4">
                      <p className="text-sm text-gray-400 mb-3">{model.description}</p>
                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div><span className="text-gray-500">Type:</span> <span className="text-gray-300">{model.model_type}</span></div>
                        <div><span className="text-gray-500">Algorithm:</span> <span className="text-gray-300">{model.algorithm}</span></div>
                        <div><span className="text-gray-500">Version:</span> <span className="text-gray-300">{model.model_version}</span></div>
                      </div>
                      {model.performance_metrics && (
                        <div className="mt-3 pt-3 border-t border-gray-800">
                          <p className="text-xs text-gray-500 mb-2">Performance Metrics:</p>
                          <div className="flex gap-3 flex-wrap">
                            {Object.entries(typeof model.performance_metrics === 'string' ? JSON.parse(model.performance_metrics) : model.performance_metrics).map(([key, val]) => (
                              <span key={key} className="text-xs bg-gray-800 px-2 py-1 rounded">
                                {key}: <span className="font-medium text-purple-300">{typeof val === 'number' ? (val * 100).toFixed(1) + '%' : val}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="mt-3 flex gap-2">
                        <button onClick={() => triggerTraining(model.model_type)} disabled={trainingModel}
                          className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 rounded-lg text-xs font-medium flex items-center gap-1 disabled:opacity-50">
                          <Play className="w-3 h-3" /> Retrain
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ALERTS TAB */}
        {activeTab === 'alerts' && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Prediction Alerts</h2>
            {(!stats?.alerts || stats.alerts.length === 0) ? (
              <div className="bg-gray-900 rounded-xl p-8 text-center border border-gray-800">
                <AlertTriangle className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400">No active alerts. The system will generate alerts when high-risk predictions are detected.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {stats.alerts.map((alert, i) => (
                  <div key={alert.id || i} className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className={`w-5 h-5 ${
                          alert.severity === 'critical' ? 'text-red-400' :
                          alert.severity === 'high' ? 'text-orange-400' : 'text-yellow-400'}`} />
                        <h3 className="font-medium text-sm">{alert.alert_type?.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</h3>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        alert.severity === 'critical' ? 'bg-red-900/50 text-red-300' :
                        alert.severity === 'high' ? 'bg-orange-900/50 text-orange-300' :
                        'bg-yellow-900/50 text-yellow-300'}`}>{alert.severity}</span>
                    </div>
                    <p className="text-sm text-gray-400">{alert.message || alert.alert_message}</p>
                    <p className="text-xs text-gray-500 mt-2">{new Date(alert.created_at).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
