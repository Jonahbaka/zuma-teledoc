'use client';

import { useState } from 'react';
import { 
  Sparkles, Brain, FileText, Activity, ClipboardList, 
  Loader2, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp,
  RefreshCw, ThumbsUp, ThumbsDown, Copy, Stethoscope, Pill,
  TestTube, Heart, Info
} from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';

export default function AISoapAssist({ 
  appointmentId, 
  patientInfo, 
  initialSymptoms,
  vitals,
  onApplySuggestion 
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [suggestion, setSuggestion] = useState(null);
  const [diagnosticResult, setDiagnosticResult] = useState(null);
  const [showDifferentials, setShowDifferentials] = useState(false);
  const [showTests, setShowTests] = useState(false);
  const [activeTab, setActiveTab] = useState('soap');
  
  // Form state for generating suggestions
  const [symptoms, setSymptoms] = useState(initialSymptoms || '');
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [physicalExam, setPhysicalExam] = useState('');
  const [existingConditions, setExistingConditions] = useState('');
  const [medications, setMedications] = useState('');

  const generateSoapSuggestion = async () => {
    setIsLoading(true);
    try {
      const response = await api.post('/ai-assist/soap', {
        appointmentId,
        patientHistory: existingConditions,
        chiefComplaint: chiefComplaint || symptoms,
        symptoms,
        vitals,
        physicalExam,
        existingConditions,
        medications
      });
      
      if (response.data.success) {
        setSuggestion(response.data.suggestion);
        toast({
          title: 'AI Suggestions Generated',
          description: 'Review and modify the suggestions as needed'
        });
      }
    } catch (error) {
      toast({
        title: 'Generation Failed',
        description: 'Unable to generate AI suggestions',
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const generateDiagnosticSuggestion = async () => {
    setIsLoading(true);
    try {
      const response = await api.post('/ai-assist/diagnose', {
        appointmentId,
        patientId: patientInfo?.id,
        symptoms,
        vitals,
        patientHistory: { existingConditions, medications }
      });
      
      if (response.data.success) {
        setDiagnosticResult(response.data.diagnostic);
        setActiveTab('diagnose');
      }
    } catch (error) {
      toast({
        title: 'Diagnosis Failed',
        description: 'Unable to generate diagnostic suggestions',
        variant: 'destructive'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const applySuggestion = (field, value) => {
    if (onApplySuggestion) {
      onApplySuggestion(field, value);
      toast({
        title: 'Applied',
        description: `${field} suggestion applied to notes`
      });
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Copied to clipboard' });
  };

  const provideFeedback = async (feedback) => {
    if (!suggestion?.id) return;
    try {
      await api.post(`/ai-assist/soap/${suggestion.id}/feedback`, { feedback });
      toast({ title: 'Feedback recorded', description: 'Thank you for your feedback' });
    } catch (error) {
      // Silent fail
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">AI Clinical Assist</h3>
            <p className="text-xs text-slate-500">Powered by Docta.</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        <button
          onClick={() => setActiveTab('soap')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'soap' 
              ? 'border-violet-500 text-violet-600' 
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <FileText className="w-4 h-4 inline mr-1" />
          SOAP Assist
        </button>
        <button
          onClick={() => setActiveTab('diagnose')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'diagnose' 
              ? 'border-violet-500 text-violet-600' 
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          <Brain className="w-4 h-4 inline mr-1" />
          Diagnosis Assist
        </button>
      </div>

      {/* Input Section */}
      <Card className="border-slate-200">
        <CardContent className="p-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600">Chief Complaint / Symptoms</label>
            <textarea
              value={symptoms}
              onChange={(e) => setSymptoms(e.target.value)}
              placeholder="Enter patient's presenting symptoms..."
              className="w-full mt-1 p-2 text-sm border border-slate-200 rounded-lg resize-none h-20 focus:ring-2 focus:ring-violet-500"
            />
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600">Existing Conditions</label>
              <input
                value={existingConditions}
                onChange={(e) => setExistingConditions(e.target.value)}
                placeholder="e.g., Hypertension, Diabetes"
                className="w-full mt-1 p-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Current Medications</label>
              <input
                value={medications}
                onChange={(e) => setMedications(e.target.value)}
                placeholder="e.g., Lisinopril 10mg"
                className="w-full mt-1 p-2 text-sm border border-slate-200 rounded-lg"
              />
            </div>
          </div>
          
          <div className="flex gap-2">
            <Button
              onClick={generateSoapSuggestion}
              disabled={isLoading || !symptoms.trim()}
              className="flex-1 bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
              Generate SOAP
            </Button>
            <Button
              onClick={generateDiagnosticSuggestion}
              disabled={isLoading || !symptoms.trim()}
              variant="outline"
              className="flex-1"
            >
              <Brain className="w-4 h-4 mr-2" />
              Diagnose Assist
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* SOAP Suggestions */}
      {activeTab === 'soap' && suggestion && (
        <div className="space-y-3">
          {/* Disclaimer */}
          <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-sm text-amber-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{suggestion.disclaimer}</span>
          </div>

          {/* SOAP Sections */}
          {['subjective', 'objective', 'assessment', 'plan'].map((section) => (
            <Card key={section} className="border-slate-200">
              <CardHeader className="py-2 px-4 bg-slate-50 border-b flex flex-row items-center justify-between">
                <div className="flex items-center gap-2">
                  {section === 'subjective' && <Activity className="w-4 h-4 text-blue-500" />}
                  {section === 'objective' && <Stethoscope className="w-4 h-4 text-green-500" />}
                  {section === 'assessment' && <Brain className="w-4 h-4 text-purple-500" />}
                  {section === 'plan' && <ClipboardList className="w-4 h-4 text-orange-500" />}
                  <span className="font-medium text-sm capitalize">{section}</span>
                  {suggestion.confidenceScores?.[section] && (
                    <span className="text-xs text-slate-400">
                      {Math.round(suggestion.confidenceScores[section] * 100)}% confidence
                    </span>
                  )}
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => copyToClipboard(suggestion[section])}
                    className="p-1 hover:bg-slate-200 rounded"
                    title="Copy"
                  >
                    <Copy className="w-3 h-3 text-slate-400" />
                  </button>
                  <button
                    onClick={() => applySuggestion(section, suggestion[section])}
                    className="p-1 hover:bg-green-100 rounded"
                    title="Apply to notes"
                  >
                    <CheckCircle2 className="w-3 h-3 text-green-500" />
                  </button>
                </div>
              </CardHeader>
              <CardContent className="p-3">
                <p className="text-sm text-slate-700 whitespace-pre-wrap">{suggestion[section]}</p>
              </CardContent>
            </Card>
          ))}

          {/* ICD Codes */}
          {suggestion.icdCodes?.length > 0 && (
            <Card className="border-slate-200">
              <CardHeader className="py-2 px-4 bg-slate-50 border-b">
                <span className="font-medium text-sm">Suggested ICD-10 Codes</span>
              </CardHeader>
              <CardContent className="p-3">
                <div className="flex flex-wrap gap-2">
                  {suggestion.icdCodes.map((icd, idx) => (
                    <div key={idx} className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs">
                      <span className="font-mono font-medium">{icd.code}</span>
                      <span className="ml-1 text-blue-600">{icd.description}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Differential Diagnoses */}
          {suggestion.differentialDiagnoses?.length > 0 && (
            <Card className="border-slate-200">
              <button
                onClick={() => setShowDifferentials(!showDifferentials)}
                className="w-full py-2 px-4 bg-slate-50 border-b flex items-center justify-between hover:bg-slate-100"
              >
                <span className="font-medium text-sm">Differential Diagnoses</span>
                {showDifferentials ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {showDifferentials && (
                <CardContent className="p-3 space-y-2">
                  {suggestion.differentialDiagnoses.map((dx, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 bg-slate-50 rounded">
                      <span className="text-sm">{dx.diagnosis}</span>
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-2 bg-slate-200 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-gradient-to-r from-violet-500 to-purple-500"
                            style={{ width: `${dx.probability * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-500">{Math.round(dx.probability * 100)}%</span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              )}
            </Card>
          )}

          {/* Feedback */}
          <div className="flex items-center justify-center gap-4 pt-2">
            <span className="text-xs text-slate-400">Was this helpful?</span>
            <button onClick={() => provideFeedback('accepted')} className="p-2 hover:bg-green-50 rounded-lg">
              <ThumbsUp className="w-4 h-4 text-green-500" />
            </button>
            <button onClick={() => provideFeedback('rejected')} className="p-2 hover:bg-red-50 rounded-lg">
              <ThumbsDown className="w-4 h-4 text-red-500" />
            </button>
          </div>
        </div>
      )}

      {/* Diagnostic Suggestions */}
      {activeTab === 'diagnose' && diagnosticResult && (
        <div className="space-y-3">
          {/* Disclaimer */}
          <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-sm text-amber-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{diagnosticResult.disclaimer}</span>
          </div>

          {/* Urgency Level */}
          <div className={`p-3 rounded-lg flex items-center gap-2 ${
            diagnosticResult.urgencyLevel === 'urgent' || diagnosticResult.urgencyLevel === 'emergent'
              ? 'bg-red-50 border border-red-200 text-red-700'
              : diagnosticResult.urgencyLevel === 'soon'
              ? 'bg-amber-50 border border-amber-200 text-amber-700'
              : 'bg-green-50 border border-green-200 text-green-700'
          }`}>
            <Heart className="w-4 h-4" />
            <span className="text-sm font-medium">Urgency: {diagnosticResult.urgencyLevel?.toUpperCase()}</span>
          </div>

          {/* Suggested Diagnoses */}
          <Card className="border-slate-200">
            <CardHeader className="py-2 px-4 bg-violet-50 border-b">
              <span className="font-medium text-sm text-violet-700">Suggested Diagnoses</span>
            </CardHeader>
            <CardContent className="p-3 space-y-2">
              {diagnosticResult.suggestedDiagnoses?.map((dx, idx) => (
                <div key={idx} className="p-3 bg-slate-50 rounded-lg">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-slate-900">{dx.diagnosis}</p>
                      <p className="text-xs text-slate-500 font-mono">ICD-10: {dx.icd}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium text-violet-600">{Math.round(dx.confidence * 100)}%</div>
                      <div className="text-xs text-slate-400">confidence</div>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Recommended Tests */}
          {diagnosticResult.recommendedTests?.length > 0 && (
            <Card className="border-slate-200">
              <button
                onClick={() => setShowTests(!showTests)}
                className="w-full py-2 px-4 bg-slate-50 border-b flex items-center justify-between hover:bg-slate-100"
              >
                <span className="font-medium text-sm flex items-center gap-2">
                  <TestTube className="w-4 h-4 text-blue-500" />
                  Recommended Tests
                </span>
                {showTests ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {showTests && (
                <CardContent className="p-3 space-y-2">
                  {diagnosticResult.recommendedTests.map((test, idx) => (
                    <div key={idx} className="flex items-start gap-3 p-2 bg-slate-50 rounded">
                      <div className={`px-2 py-0.5 rounded text-xs font-medium ${
                        test.priority === 'high' ? 'bg-red-100 text-red-700' :
                        test.priority === 'medium' ? 'bg-amber-100 text-amber-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {test.priority}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{test.test}</p>
                        <p className="text-xs text-slate-500">{test.reason}</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              )}
            </Card>
          )}

          {/* Treatment Suggestions */}
          {diagnosticResult.treatmentSuggestions?.length > 0 && (
            <Card className="border-slate-200">
              <CardHeader className="py-2 px-4 bg-slate-50 border-b">
                <span className="font-medium text-sm flex items-center gap-2">
                  <Pill className="w-4 h-4 text-green-500" />
                  Treatment Considerations
                </span>
              </CardHeader>
              <CardContent className="p-3 space-y-2">
                {diagnosticResult.treatmentSuggestions.map((tx, idx) => (
                  <div key={idx} className="p-2 bg-slate-50 rounded">
                    <p className="font-medium text-sm">{tx.treatment}</p>
                    <p className="text-xs text-slate-500">{tx.dosing}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Empty State */}
      {!suggestion && !diagnosticResult && !isLoading && (
        <div className="text-center py-8 text-slate-400">
          <Sparkles className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-sm">Enter symptoms above and click generate</p>
          <p className="text-xs mt-1">AI will assist with clinical documentation</p>
        </div>
      )}
    </div>
  );
}




