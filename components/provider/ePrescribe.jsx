 'use client';

import { useState, useEffect } from 'react';
import { Send, Pill, Zap, TrendingUp, Loader2, AlertCircle, CheckCircle, CreditCard, BrainCircuit } from 'lucide-react';
import { rtbcAPI, priorAuthAPI } from '@/lib/api';
import { DoctaService } from '@/lib/doctaService';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';

export default function ePrescribe({ patientId, visitId, appointmentId, aiSuggestions = [], hasGoldCard = false }) {
  const [selectedDrug, setSelectedDrug] = useState('');
  const [rtbcResult, setRtbcResult] = useState(null);
  const [loadingRTBC, setLoadingRTBC] = useState(false);
  const [prescribing, setPrescribing] = useState(false);
  const [priorAuth, setPriorAuth] = useState(null);

  const handlePrescribeCheck = async (drugToCheck = selectedDrug) => {
    if (!drugToCheck) return;

    setLoadingRTBC(true);
    setRtbcResult(null);
    setPriorAuth(null);

    try {
      // Use DoctaService for pricing comparison
      const result = await DoctaService.comparePrices(drugToCheck, hasGoldCard);
      setRtbcResult(result);

      // Try API as fallback, but use DoctaService result
      try {
        const apiResponse = await rtbcAPI.comparePrices(drugToCheck, null, hasGoldCard);
        if (apiResponse.data.success) {
          // Merge API result with DoctaService result if available
          setRtbcResult({ ...result, ...apiResponse.data });
        }
      } catch (apiError) {
        // Use DoctaService result if API fails
        console.log('Using DoctaService result:', result);
      }

      // Auto-initiate PA if required
      if (result.requiresPriorAuth) {
        await handleAutoSubmitPA(result);
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to check benefits',
        variant: 'destructive'
      });
    } finally {
      setLoadingRTBC(false);
    }
  };

  const handleAutoSubmitPA = async (rtbcResult) => {
    try {
      const response = await priorAuthAPI.create({
        patientId,
        visitId,
        appointmentId,
        medicationName: selectedDrug,
        payerName: rtbcResult.payerName || 'Unknown',
        diagnosisDescription: 'Per RTBC requirement',
        clinicalNotes: `Auto-submitted PA for ${selectedDrug} based on formulary requirement`,
        submittedVia: 'api'
      });

      if (response.data.success) {
        setPriorAuth(response.data.priorAuth);
        toast({
          title: 'Prior Authorization Submitted',
          description: 'PA has been automatically submitted'
        });
      }
    } catch (error) {
      console.error('Auto-PA submission error:', error);
    }
  };

  const handleSuggestionClick = (med) => {
    setSelectedDrug(med);
    handlePrescribeCheck(med);
    toast({
      title: 'AI Suggestion Selected',
      description: `'${med}' selected for benefit check`
    });
  };

  const handleFinalizeRx = async () => {
    if (!rtbcResult) return;

    setPrescribing(true);
    try {
      // In production, integrate with ePrescribe system
      toast({
        title: 'Prescription Authorized',
        description: 'Rx sent to pharmacy successfully'
      });
      
      // Reset
      setSelectedDrug('');
      setRtbcResult(null);
      setPriorAuth(null);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to authorize prescription',
        variant: 'destructive'
      });
    } finally {
      setPrescribing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* AI Smart Suggestions */}
      {aiSuggestions.length > 0 && (
        <Card className="border-indigo-200 bg-gradient-to-r from-indigo-50 to-purple-50">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="w-4 h-4 text-indigo-600" />
              AI Smart Suggestions based on Triage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {aiSuggestions.map((med) => (
                <button
                  key={med}
                  onClick={() => handleSuggestionClick(med)}
                  className="bg-white hover:bg-indigo-100 border border-indigo-200 text-indigo-700 px-3 py-1.5 rounded-full text-sm font-medium transition-colors flex items-center shadow-sm"
                >
                  <Zap className="w-3 h-3 mr-1 text-amber-500 fill-amber-500" />
                  {med}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Medication Search */}
      <Card>
        <CardHeader>
          <CardTitle>ePrescribe</CardTitle>
          <p className="text-sm text-gray-500">Medication Search & Real-Time Benefit Check</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 font-bold uppercase mb-1">
                Medication Search
              </label>
              <select
                className="w-full p-3 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white transition-colors outline-none focus:ring-2 focus:ring-purple-500"
                onChange={(e) => {
                  setSelectedDrug(e.target.value);
                  setRtbcResult(null);
                }}
                value={selectedDrug}
              >
                <option value="">Select or Type Drug...</option>
                <option value="Amoxicillin">Amoxicillin</option>
                <option value="Lipitor">Lipitor</option>
                <option value="Wegovy">Wegovy</option>
                <option value="Humira">Humira</option>
                <option value="Lisinopril">Lisinopril</option>
                <option value="Prednisone">Prednisone</option>
                <option value="Azithromycin">Azithromycin</option>
              </select>
            </div>
            <div className="flex items-end">
              <Button
                onClick={() => handlePrescribeCheck(selectedDrug)}
                disabled={!selectedDrug || loadingRTBC}
              >
                {loadingRTBC ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Checking...
                  </>
                ) : (
                  'Check Benefits'
                )}
              </Button>
            </div>
          </div>

          {/* RTBC Results */}
          {rtbcResult && (
            <div className="bg-gray-50 rounded-xl border border-gray-200 overflow-hidden animate-in fade-in slide-in-from-top-2">
              <div className="p-4 bg-white border-b border-gray-200">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-xs text-gray-500 uppercase font-bold">Best Price Option</p>
                    <p className="text-2xl font-bold text-gray-900 flex items-center mt-1">
                      <CreditCard className="w-5 h-5 mr-2 text-purple-500" />
                      {rtbcResult.bestPrice.label}: ${rtbcResult.bestPrice.cost.toFixed(2)}
                    </p>
                  </div>
                  {rtbcResult.bestPrice.id !== 'INSURANCE' && (
                    <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-bold flex items-center">
                      <TrendingUp className="w-3 h-3 mr-1" />
                      Cheaper than Insurance
                    </span>
                  )}
                </div>
              </div>

              {/* Price Scenarios */}
              <div className="p-4 space-y-2">
                <p className="text-xs text-gray-500 uppercase font-bold mb-2">All Options</p>
                {rtbcResult.scenarios.map((scenario) => (
                  <div
                    key={scenario.id}
                    className={`p-3 rounded-lg border ${
                      scenario.id === rtbcResult.bestPrice.id
                        ? 'bg-purple-50 border-purple-200'
                        : 'bg-white border-gray-200'
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="font-medium">{scenario.label}</p>
                        <p className="text-xs text-gray-500">{scenario.description}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-lg">${scenario.cost.toFixed(2)}</p>
                        {scenario.requiresPA && (
                          <span className="text-xs text-amber-600">Requires PA</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Prior Auth Status */}
              {priorAuth && (
                <div className="p-4 bg-blue-50 border-t border-blue-200">
                  <div className="flex items-center gap-2">
                    {priorAuth.status === 'approved' ? (
                      <CheckCircle className="w-5 h-5 text-green-600" />
                    ) : (
                      <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                    )}
                    <div>
                      <p className="text-sm font-medium">
                        Prior Authorization {priorAuth.status === 'approved' ? 'Approved' : 'Submitted'}
                      </p>
                      <p className="text-xs text-gray-600">PA #{priorAuth.pa_number}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Prior Auth Required Warning */}
              {rtbcResult.requiresPriorAuth && !priorAuth && (
                <div className="p-4 bg-amber-50 border-t border-amber-200">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-amber-600" />
                    <div>
                      <p className="text-sm font-medium">Prior Authorization Required</p>
                      <p className="text-xs text-gray-600">
                        This medication requires prior authorization before dispensing
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Alternative Medications */}
              {(rtbcResult.preferredAlternatives?.length > 0 || rtbcResult.lowerCostAlternatives?.length > 0) && (
                <div className="p-4 bg-gray-50 border-t border-gray-200">
                  <p className="text-xs text-gray-500 uppercase font-bold mb-2">Alternative Options</p>
                  <div className="space-y-1">
                    {rtbcResult.preferredAlternatives.map((alt, idx) => (
                      <p key={idx} className="text-sm text-gray-700">
                        • Preferred: {alt}
                      </p>
                    ))}
                    {rtbcResult.lowerCostAlternatives.map((alt, idx) => (
                      <p key={idx} className="text-sm text-gray-700">
                        • Lower Cost: {alt}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* Finalize Button */}
              <div className="p-4 bg-white border-t border-gray-200 flex justify-end">
                <Button
                  onClick={handleFinalizeRx}
                  disabled={prescribing || (rtbcResult.requiresPriorAuth && !priorAuth)}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {prescribing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Authorizing...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      Authorize Rx
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

