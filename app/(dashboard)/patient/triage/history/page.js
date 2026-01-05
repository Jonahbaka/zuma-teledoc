'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  BrainCircuit, Clock, AlertTriangle, CheckCircle,
  Loader2, ChevronRight, Calendar, User, Stethoscope,
  Activity, FileText, ArrowLeft, RefreshCw
} from 'lucide-react';
import { triageQueueAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { format, formatDistanceToNow } from 'date-fns';

// Triage level styling
const TRIAGE_LEVELS = {
  EMERGENT: { color: 'bg-red-500', textColor: 'text-red-600', bgColor: 'bg-red-50' },
  URGENT: { color: 'bg-orange-500', textColor: 'text-orange-600', bgColor: 'bg-orange-50' },
  SEMI_URGENT: { color: 'bg-yellow-500', textColor: 'text-yellow-600', bgColor: 'bg-yellow-50' },
  ROUTINE: { color: 'bg-green-500', textColor: 'text-green-600', bgColor: 'bg-green-50' },
  NON_URGENT: { color: 'bg-blue-500', textColor: 'text-blue-600', bgColor: 'bg-blue-50' }
};

const STATUS_BADGES = {
  pending: { label: 'Pending Review', variant: 'secondary' },
  completed: { label: 'Completed', variant: 'default' },
  in_review: { label: 'In Review', variant: 'outline' },
  scheduled: { label: 'Appointment Scheduled', variant: 'default' },
  referred: { label: 'Referred', variant: 'secondary' }
};

export default function PatientTriageHistoryPage() {
  const router = useRouter();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState(null);
  
  const loadHistory = async () => {
    setLoading(true);
    try {
      const response = await triageQueueAPI.getHistory();
      if (response.data.success) {
        setHistory(response.data.history);
      }
    } catch (error) {
      console.error('Load history error:', error);
      toast({
        title: 'Error',
        description: 'Failed to load triage history',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    loadHistory();
  }, []);
  
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
          <div className="flex items-center gap-3 mb-2">
            <Link href="/patient/triage">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="w-4 h-4 mr-1" />
                Back to Triage
              </Button>
            </Link>
          </div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl">
              <BrainCircuit className="w-6 h-6 text-white" />
            </div>
            Triage History
          </h1>
          <p className="text-muted-foreground mt-1">Review your past AI triage sessions</p>
        </div>
        
        <Button variant="outline" onClick={loadHistory} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
      
      {history.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BrainCircuit className="w-16 h-16 text-muted-foreground mx-auto mb-4 opacity-50" />
            <h3 className="text-xl font-semibold">No Triage History</h3>
            <p className="text-muted-foreground mt-2 max-w-md mx-auto">
              You haven't used the AI symptom checker yet. Start a triage session to get AI-powered health guidance.
            </p>
            <Link href="/patient/triage">
              <Button className="mt-6 bg-purple-600 hover:bg-purple-700">
                <BrainCircuit className="w-4 h-4 mr-2" />
                Start AI Triage
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {history.map((session) => {
            const levelInfo = TRIAGE_LEVELS[session.aiTriageLevel] || TRIAGE_LEVELS.ROUTINE;
            const statusInfo = STATUS_BADGES[session.disposition] || STATUS_BADGES.pending;
            
            return (
              <Card
                key={session.id}
                className={`hover:shadow-lg transition-shadow cursor-pointer border-l-4 ${
                  session.isEmergency ? 'border-l-red-500' : 'border-l-purple-500'
                }`}
                onClick={() => setSelectedSession(session)}
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <Badge className={`${levelInfo.bgColor} ${levelInfo.textColor} border-0`}>
                          {session.aiTriageLevel || 'ROUTINE'}
                        </Badge>
                        <Badge variant={statusInfo.variant}>
                          {statusInfo.label}
                        </Badge>
                        {session.isEmergency && (
                          <Badge variant="destructive" className="animate-pulse">
                            🚨 Emergency
                          </Badge>
                        )}
                      </div>
                      
                      <h3 className="font-semibold text-lg mb-1">
                        {session.chiefComplaint}
                      </h3>
                      
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                        {session.symptoms}
                      </p>
                      
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-4 h-4" />
                          {format(new Date(session.createdAt), 'MMM d, yyyy')}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-4 h-4" />
                          {formatDistanceToNow(new Date(session.createdAt), { addSuffix: true })}
                        </span>
                        <span className="flex items-center gap-1">
                          <Activity className="w-4 h-4" />
                          Severity: {session.aiSeverity}/5
                        </span>
                        {session.providerFirstName && (
                          <span className="flex items-center gap-1">
                            <User className="w-4 h-4" />
                            Reviewed by Dr. {session.providerFirstName} {session.providerLastName}
                          </span>
                        )}
                      </div>
                    </div>
                    
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      
      {/* Session Details Dialog */}
      <Dialog open={!!selectedSession} onOpenChange={() => setSelectedSession(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BrainCircuit className="w-5 h-5 text-purple-500" />
              Triage Session Details
            </DialogTitle>
            <DialogDescription>
              {selectedSession && format(new Date(selectedSession.createdAt), 'MMMM d, yyyy h:mm a')}
            </DialogDescription>
          </DialogHeader>
          
          {selectedSession && (
            <div className="space-y-6">
              {/* Status Badges */}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={`${TRIAGE_LEVELS[selectedSession.aiTriageLevel]?.bgColor} ${TRIAGE_LEVELS[selectedSession.aiTriageLevel]?.textColor} border-0`}>
                  {selectedSession.aiTriageLevel || 'ROUTINE'}
                </Badge>
                <Badge variant="outline">
                  Severity: {selectedSession.aiSeverity}/5
                </Badge>
                {selectedSession.aiRecommendedSpecialty && (
                  <Badge variant="secondary">
                    {selectedSession.aiRecommendedSpecialty}
                  </Badge>
                )}
                {selectedSession.isEmergency && (
                  <Badge variant="destructive">🚨 Emergency</Badge>
                )}
              </div>
              
              {/* Chief Complaint */}
              <div>
                <p className="text-xs text-muted-foreground uppercase font-bold mb-1">Chief Complaint</p>
                <p className="font-medium">{selectedSession.chiefComplaint}</p>
              </div>
              
              {/* Symptoms */}
              <div>
                <p className="text-xs text-muted-foreground uppercase font-bold mb-1">Symptoms Described</p>
                <p className="p-3 bg-accent rounded-lg">{selectedSession.symptoms}</p>
              </div>
              
              {/* Vitals if recorded */}
              {(selectedSession.temperature || selectedSession.heartRate || selectedSession.bloodPressureSystolic) && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-bold mb-2">Vitals Recorded</p>
                  <div className="grid grid-cols-3 gap-3">
                    {selectedSession.temperature && (
                      <div className="p-3 bg-accent rounded-lg text-center">
                        <p className="text-2xl font-bold">{selectedSession.temperature}°F</p>
                        <p className="text-xs text-muted-foreground">Temperature</p>
                      </div>
                    )}
                    {selectedSession.heartRate && (
                      <div className="p-3 bg-accent rounded-lg text-center">
                        <p className="text-2xl font-bold">{selectedSession.heartRate}</p>
                        <p className="text-xs text-muted-foreground">Heart Rate</p>
                      </div>
                    )}
                    {selectedSession.bloodPressureSystolic && (
                      <div className="p-3 bg-accent rounded-lg text-center">
                        <p className="text-2xl font-bold">
                          {selectedSession.bloodPressureSystolic}/{selectedSession.bloodPressureDiastolic}
                        </p>
                        <p className="text-xs text-muted-foreground">Blood Pressure</p>
                      </div>
                    )}
                    {selectedSession.oxygenSaturation && (
                      <div className="p-3 bg-accent rounded-lg text-center">
                        <p className="text-2xl font-bold">{selectedSession.oxygenSaturation}%</p>
                        <p className="text-xs text-muted-foreground">O2 Sat</p>
                      </div>
                    )}
                    {selectedSession.painLevel != null && (
                      <div className="p-3 bg-accent rounded-lg text-center">
                        <p className="text-2xl font-bold">{selectedSession.painLevel}/10</p>
                        <p className="text-xs text-muted-foreground">Pain Level</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {/* AI Assessment */}
              {selectedSession.aiSoapDraft && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-bold mb-2">AI Assessment</p>
                  <pre className="p-4 bg-accent rounded-lg text-sm whitespace-pre-wrap font-mono">
                    {selectedSession.aiSoapDraft}
                  </pre>
                </div>
              )}
              
              {/* Clinical Flags */}
              {selectedSession.aiClinicalFlags?.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-bold mb-2">Clinical Flags</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedSession.aiClinicalFlags.map((flag, idx) => (
                      <Badge key={idx} variant="outline" className="text-yellow-700 border-yellow-500 bg-yellow-50">
                        <AlertTriangle className="w-3 h-3 mr-1" />
                        {flag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Emergency Flags */}
              {selectedSession.emergencyFlags?.length > 0 && (
                <div className="p-4 bg-red-50 dark:bg-red-950 rounded-lg border border-red-200">
                  <p className="text-xs text-red-800 uppercase font-bold mb-2 flex items-center gap-1">
                    <AlertTriangle className="w-4 h-4" />
                    Emergency Alerts
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {selectedSession.emergencyFlags.map((flag, idx) => (
                      <Badge key={idx} variant="destructive">
                        {flag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Suggested Medications */}
              {selectedSession.aiSuggestedMedications?.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-bold mb-2">AI Suggested Treatments</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedSession.aiSuggestedMedications.map((med, idx) => (
                      <Badge key={idx} variant="secondary">
                        {med}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Differential Diagnosis */}
              {selectedSession.aiDifferentialDiagnosis?.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-bold mb-2">Possible Conditions</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedSession.aiDifferentialDiagnosis.map((diag, idx) => (
                      <Badge key={idx} variant="outline">
                        {diag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Provider Review */}
              {selectedSession.reviewedBy && (
                <div className="border-t pt-4">
                  <p className="text-xs text-muted-foreground uppercase font-bold mb-2">Provider Review</p>
                  <div className="flex items-center gap-3 p-3 bg-accent rounded-lg">
                    <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                      <Stethoscope className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                      <p className="font-medium">
                        Dr. {selectedSession.providerFirstName} {selectedSession.providerLastName}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Reviewed {selectedSession.reviewedAt && format(new Date(selectedSession.reviewedAt), 'MMM d, yyyy')}
                      </p>
                    </div>
                  </div>
                  
                  {selectedSession.dispositionNotes && (
                    <div className="mt-3">
                      <p className="text-sm text-muted-foreground">Provider Notes:</p>
                      <p className="mt-1">{selectedSession.dispositionNotes}</p>
                    </div>
                  )}
                </div>
              )}
              
              {/* Queue Info */}
              {selectedSession.queueNumber && (
                <div className="border-t pt-4 flex items-center justify-between text-sm text-muted-foreground">
                  <span>Queue #: {selectedSession.queueNumber}</span>
                  {selectedSession.actualWaitMinutes && (
                    <span>Wait time: {selectedSession.actualWaitMinutes} min</span>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

