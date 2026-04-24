'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  BrainCircuit, AlertTriangle, Clock, User, Stethoscope, Activity,
  Loader2, RefreshCw, CheckCircle, Play, Pause, ArrowRight,
  ChevronRight, Phone, Calendar, AlertCircle, Filter, Search,
  TrendingUp, Users, Zap, FileText, Pill
} from 'lucide-react';
import { triageQueueAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { formatRelativeTime } from '@/lib/utils';
import { toProviderPortalPath } from '@/lib/providerPortal';

// Triage level colors and info
const TRIAGE_LEVELS = {
  EMERGENT: { color: 'bg-red-500', bgColor: 'bg-red-50 border-red-200', textColor: 'text-red-800', icon: AlertTriangle },
  URGENT: { color: 'bg-orange-500', bgColor: 'bg-orange-50 border-orange-200', textColor: 'text-orange-800', icon: AlertCircle },
  SEMI_URGENT: { color: 'bg-yellow-500', bgColor: 'bg-yellow-50 border-yellow-200', textColor: 'text-yellow-800', icon: Clock },
  ROUTINE: { color: 'bg-green-500', bgColor: 'bg-green-50 border-green-200', textColor: 'text-green-800', icon: CheckCircle },
  NON_URGENT: { color: 'bg-blue-500', bgColor: 'bg-blue-50 border-blue-200', textColor: 'text-blue-800', icon: Activity }
};

export default function TriageQueuePage() {
  const router = useRouter();
  const pathname = usePathname();
  
  // Queue state
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // Stats
  const [stats, setStats] = useState({
    totalWaiting: 0,
    emergencies: 0,
    averageWaitMinutes: 0,
    byTriageLevel: {},
    inProgress: 0,
    completedToday: 0
  });
  
  // Filters
  const [statusFilter, setStatusFilter] = useState('waiting');
  const [specialtyFilter, setSpecialtyFilter] = useState('');
  const [showAll, setShowAll] = useState(false);
  
  // Selected case
  const [selectedCase, setSelectedCase] = useState(null);
  
  // Auto-refresh
  const [autoRefresh, setAutoRefresh] = useState(true);
  
  // Load queue and stats
  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    
    try {
      const [queueRes, statsRes] = await Promise.all([
        triageQueueAPI.getQueue({
          status: statusFilter,
          specialty: specialtyFilter || undefined,
          showAll: showAll ? 'true' : undefined
        }),
        triageQueueAPI.getStats()
      ]);
      
      if (queueRes.data.success) {
        setQueue(queueRes.data.queue);
      }
      
      if (statsRes.data.success) {
        setStats(statsRes.data.stats);
      }
    } catch (error) {
      console.error('Failed to load triage data:', error);
      if (!silent) {
        toast({
          title: 'Error',
          description: 'Failed to load triage queue',
          variant: 'destructive'
        });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [statusFilter, specialtyFilter, showAll]);
  
  useEffect(() => {
    loadData();
  }, [loadData]);
  
  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!autoRefresh) return;
    
    const interval = setInterval(() => {
      loadData(true);
    }, 30000);
    
    return () => clearInterval(interval);
  }, [autoRefresh, loadData]);
  
  const handleClaimCase = async (queueId) => {
    try {
      const response = await triageQueueAPI.claimCase(queueId);
      
      if (response.data.success) {
        toast({
          title: 'Case Claimed',
          description: 'You have claimed this triage case',
          variant: 'success'
        });
        loadData(true);
      }
    } catch (error) {
      console.error('Claim case error:', error);
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to claim case',
        variant: 'destructive'
      });
    }
  };
  
  const handleStartConsultation = async (queueId) => {
    try {
      const response = await triageQueueAPI.startConsultation(queueId);
      
      if (response.data.success) {
        toast({
          title: 'Consultation Started',
          description: 'Consultation is now in progress',
          variant: 'success'
        });
        loadData(true);
      }
    } catch (error) {
      console.error('Start consultation error:', error);
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to start consultation',
        variant: 'destructive'
      });
    }
  };
  
  const handleCompleteConsultation = async (queueId, disposition) => {
    try {
      const response = await triageQueueAPI.completeConsultation(queueId, {
        disposition,
        notes: 'Completed via triage queue'
      });
      
      if (response.data.success) {
        toast({
          title: 'Consultation Completed',
          description: 'Triage case has been completed',
          variant: 'success'
        });
        setSelectedCase(null);
        loadData(true);
      }
    } catch (error) {
      console.error('Complete consultation error:', error);
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to complete consultation',
        variant: 'destructive'
      });
    }
  };
  
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl">
              <BrainCircuit className="w-6 h-6 text-white" />
            </div>
            Triage Queue
          </h1>
          <p className="text-muted-foreground mt-1">AI-prioritized patient triage management</p>
        </div>
        
        <div className="flex items-center gap-3">
          <Button
            variant={autoRefresh ? 'default' : 'outline'}
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={autoRefresh ? 'bg-green-600 hover:bg-green-700' : ''}
          >
            {autoRefresh ? <Play className="w-4 h-4 mr-1" /> : <Pause className="w-4 h-4 mr-1" />}
            Auto-refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadData(true)}
            disabled={refreshing}
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>
      
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase">Waiting</p>
                <p className="text-2xl font-bold">{stats.totalWaiting}</p>
              </div>
              <Users className="w-8 h-8 text-blue-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        
        <Card className={stats.emergencies > 0 ? 'border-red-500 bg-red-50 dark:bg-red-950' : ''}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase">Emergent</p>
                <p className={`text-2xl font-bold ${stats.emergencies > 0 ? 'text-red-600' : ''}`}>
                  {stats.emergencies}
                </p>
              </div>
              <AlertTriangle className={`w-8 h-8 ${stats.emergencies > 0 ? 'text-red-500' : 'text-muted-foreground opacity-50'}`} />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase">Urgent</p>
                <p className="text-2xl font-bold text-orange-600">{stats.byTriageLevel?.URGENT || 0}</p>
              </div>
              <Zap className="w-8 h-8 text-orange-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase">Avg Wait</p>
                <p className="text-2xl font-bold">{stats.averageWaitMinutes}m</p>
              </div>
              <Clock className="w-8 h-8 text-yellow-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase">In Progress</p>
                <p className="text-2xl font-bold text-purple-600">{stats.inProgress}</p>
              </div>
              <Activity className="w-8 h-8 text-purple-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase">Completed</p>
                <p className="text-2xl font-bold text-green-600">{stats.completedToday}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
          >
            <option value="waiting">Waiting</option>
            <option value="called">Called</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
          </select>
        </div>
        
        <select
          value={specialtyFilter}
          onChange={(e) => setSpecialtyFilter(e.target.value)}
          className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
        >
          <option value="">All Specialties</option>
          <option value="Primary Care">Primary Care</option>
          <option value="Cardiology">Cardiology</option>
          <option value="Pulmonology">Pulmonology</option>
          <option value="Neurology">Neurology</option>
          <option value="Gastroenterology">Gastroenterology</option>
          <option value="Psychiatry">Psychiatry</option>
        </select>
        
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => setShowAll(e.target.checked)}
            className="w-4 h-4"
          />
          <span className="text-sm">Show all (not just my cases)</span>
        </label>
      </div>
      
      {/* Queue */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Queue List */}
        <div className="lg:col-span-2 space-y-4">
          {queue.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <BrainCircuit className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold">No Cases in Queue</h3>
                <p className="text-muted-foreground mt-1">
                  {statusFilter === 'waiting'
                    ? 'All patients have been seen'
                    : `No ${statusFilter.replace('_', ' ')} cases`}
                </p>
              </CardContent>
            </Card>
          ) : (
            queue.map((item) => {
              const levelInfo = TRIAGE_LEVELS[item.triageLevel] || TRIAGE_LEVELS.ROUTINE;
              const LevelIcon = levelInfo.icon;
              
              return (
                <Card
                  key={item.id}
                  className={`cursor-pointer transition-all hover:shadow-lg border-l-4 ${
                    selectedCase?.id === item.id
                      ? 'ring-2 ring-purple-500 border-l-purple-600'
                      : item.isEmergency
                      ? 'border-l-red-500'
                      : `border-l-${levelInfo.color.replace('bg-', '')}`
                  } ${levelInfo.bgColor}`}
                  onClick={() => setSelectedCase(item)}
                >
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-4 flex-1">
                        <div className={`p-3 rounded-full ${levelInfo.color}`}>
                          <LevelIcon className="w-5 h-5 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-bold text-muted-foreground">
                              #{item.queueNumber}
                            </span>
                            <h3 className="font-bold text-lg truncate">
                              {item.patientFirstName} {item.patientLastName}
                            </h3>
                            {item.isEmergency && (
                              <Badge variant="destructive" className="animate-pulse">
                                🚨 EMERGENCY
                              </Badge>
                            )}
                          </div>
                          
                          <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                            {item.chiefComplaint}
                          </p>
                          
                          <div className="flex flex-wrap gap-2">
                            <Badge className={levelInfo.bgColor + ' ' + levelInfo.textColor + ' border'}>
                              {item.triageLevel}
                            </Badge>
                            <Badge variant="outline">
                              Severity: {item.aiSeverity || item.severity}/5
                            </Badge>
                            <Badge variant="secondary">
                              {item.aiRecommendedSpecialty || 'Primary Care'}
                            </Badge>
                          </div>
                          
                          {/* Clinical Flags */}
                          {item.aiClinicalFlags?.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {item.aiClinicalFlags.slice(0, 3).map((flag, idx) => (
                                <Badge key={idx} variant="destructive" className="text-xs">
                                  {flag}
                                </Badge>
                              ))}
                              {item.aiClinicalFlags.length > 3 && (
                                <Badge variant="outline" className="text-xs">
                                  +{item.aiClinicalFlags.length - 3} more
                                </Badge>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex flex-col items-end gap-2 ml-4">
                        <div className="text-right">
                          <p className="text-2xl font-bold text-muted-foreground">
                            {item.waitMinutes}m
                          </p>
                          <p className="text-xs text-muted-foreground">wait time</p>
                        </div>
                        
                        {item.status === 'waiting' && !item.assignedProviderId && (
                          <Button
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); handleClaimCase(item.id); }}
                            className="bg-purple-600 hover:bg-purple-700"
                          >
                            Claim
                          </Button>
                        )}
                        
                        {item.status === 'called' && (
                          <Button
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); handleStartConsultation(item.id); }}
                            className="bg-green-600 hover:bg-green-700"
                          >
                            <Play className="w-3 h-3 mr-1" />
                            Start
                          </Button>
                        )}
                        
                        {item.status === 'in_progress' && (
                          <Badge className="bg-purple-100 text-purple-800">
                            In Progress
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
        
        {/* Selected Case Details */}
        <div className="lg:col-span-1">
          {selectedCase ? (
            <Card className="sticky top-20">
              <CardHeader className="border-b">
                <CardTitle className="flex items-center gap-2">
                  <Stethoscope className="w-5 h-5 text-purple-500" />
                  Case Details
                </CardTitle>
                <CardDescription>
                  #{selectedCase.queueNumber} - {selectedCase.patientFirstName} {selectedCase.patientLastName}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                {/* Severity & Level */}
                <div className="grid grid-cols-2 gap-4">
                  <div className={`p-3 rounded-lg border ${TRIAGE_LEVELS[selectedCase.triageLevel]?.bgColor}`}>
                    <p className="text-xs text-muted-foreground uppercase font-bold">Triage Level</p>
                    <p className={`text-lg font-bold ${TRIAGE_LEVELS[selectedCase.triageLevel]?.textColor}`}>
                      {selectedCase.triageLevel}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg border bg-muted">
                    <p className="text-xs text-muted-foreground uppercase font-bold">Severity</p>
                    <p className="text-2xl font-bold">{selectedCase.aiSeverity || selectedCase.severity}/5</p>
                  </div>
                </div>
                
                {/* Chief Complaint */}
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-bold mb-1">Chief Complaint</p>
                  <p className="text-sm">{selectedCase.chiefComplaint}</p>
                </div>
                
                {/* Symptoms */}
                {selectedCase.symptoms && (
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-bold mb-1">Symptoms</p>
                    <p className="text-sm line-clamp-4">{selectedCase.symptoms}</p>
                  </div>
                )}
                
                {/* Specialty */}
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-bold mb-1">Recommended Specialty</p>
                  <Badge variant="secondary">{selectedCase.aiRecommendedSpecialty || 'Primary Care'}</Badge>
                </div>
                
                {/* Clinical Flags */}
                {selectedCase.aiClinicalFlags?.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground uppercase font-bold mb-2">Clinical Flags</p>
                    <div className="flex flex-wrap gap-1">
                      {selectedCase.aiClinicalFlags.map((flag, idx) => (
                        <Badge key={idx} variant="destructive" className="text-xs">
                          {flag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Emergency Flags */}
                {selectedCase.emergencyFlags?.length > 0 && (
                  <div className="p-3 bg-red-50 dark:bg-red-950 rounded-lg border border-red-200">
                    <p className="text-xs text-red-800 uppercase font-bold mb-2 flex items-center gap-1">
                      <AlertTriangle className="w-4 h-4" />
                      Emergency Alerts
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {selectedCase.emergencyFlags.map((flag, idx) => (
                        <Badge key={idx} variant="destructive">
                          {flag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Patient Info */}
                <div className="pt-4 border-t">
                  <p className="text-xs text-muted-foreground uppercase font-bold mb-2">Patient Information</p>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-muted-foreground" />
                      <span>{selectedCase.patientFirstName} {selectedCase.patientLastName}</span>
                    </div>
                    {selectedCase.patientDob && (
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-muted-foreground" />
                        <span>DOB: {new Date(selectedCase.patientDob).toLocaleDateString()}</span>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Wait Time */}
                <div className="pt-4 border-t">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase font-bold">Wait Time</p>
                      <p className="text-lg font-bold">{selectedCase.waitMinutes} minutes</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground uppercase font-bold">Priority Score</p>
                      <p className="text-lg font-bold">{selectedCase.priorityScore}/100</p>
                    </div>
                  </div>
                </div>
                
                {/* Actions */}
                <div className="space-y-2 pt-4 border-t">
                  {selectedCase.status === 'waiting' && !selectedCase.assignedProviderId && (
                    <Button
                      onClick={() => handleClaimCase(selectedCase.id)}
                      className="w-full bg-purple-600 hover:bg-purple-700"
                    >
                      Claim This Case
                    </Button>
                  )}
                  
                  {selectedCase.status === 'called' && (
                    <Button
                      onClick={() => handleStartConsultation(selectedCase.id)}
                      className="w-full bg-green-600 hover:bg-green-700"
                    >
                      <Play className="w-4 h-4 mr-2" />
                      Start Consultation
                    </Button>
                  )}
                  
                  {selectedCase.status === 'in_progress' && (
                    <>
                      <Button
                        onClick={() => handleCompleteConsultation(selectedCase.id, 'completed')}
                        className="w-full bg-green-600 hover:bg-green-700"
                      >
                        <CheckCircle className="w-4 h-4 mr-2" />
                        Complete
                      </Button>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          variant="outline"
                          onClick={() => handleCompleteConsultation(selectedCase.id, 'scheduled')}
                        >
                          Schedule Apt
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => handleCompleteConsultation(selectedCase.id, 'referred')}
                        >
                          Refer Out
                        </Button>
                      </div>
                    </>
                  )}
                  
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => router.push(toProviderPortalPath(`/patients/${selectedCase.patientId}`, { pathname }))}
                  >
                    <Calendar className="w-4 h-4 mr-2" />
                    Book Appointment
                  </Button>
                  
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => router.push(toProviderPortalPath(`/prescriptions?patientId=${selectedCase.patientId}`, { pathname }))}
                  >
                    <Pill className="w-4 h-4 mr-2" />
                    Write Prescription
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <Stethoscope className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">
                  Select a case to view details
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

