'use client';

import { useState, useEffect } from 'react';
import { FileText, AlertTriangle, CheckCircle, Clock, TrendingUp, Loader2, Send, RefreshCw } from 'lucide-react';
import { claimsAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/components/providers/AuthProvider';

export default function ClaimsDashboardPage() {
  const { user } = useAuth();
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all', 'review', 'submitted', 'rejected'

  useEffect(() => {
    fetchClaims();
  }, [filter]);

  const fetchClaims = async () => {
    try {
      const params = filter === 'review' ? { status: 'review' } : {};
      const response = await claimsAPI.getAll(params);
      if (response.data.success) {
        setClaims(response.data.claims);
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load claims',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitClaim = async (claimId) => {
    try {
      const response = await claimsAPI.submit(claimId);
      if (response.data.success) {
        toast({
          title: 'Claim Submitted',
          description: 'Claim sent to clearinghouse successfully'
        });
        fetchClaims();
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to submit claim',
        variant: 'destructive'
      });
    }
  };

  const handleApplyCorrections = async (claimId, corrections) => {
    try {
      const response = await claimsAPI.applyCorrections(claimId, corrections);
      if (response.data.success) {
        toast({
          title: 'Corrections Applied',
          description: 'Claim has been updated'
        });
        fetchClaims();
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to apply corrections',
        variant: 'destructive'
      });
    }
  };

  const getStatusBadge = (status) => {
    const statusConfig = {
      draft: { color: 'gray', icon: FileText },
      scrubbed: { color: 'blue', icon: CheckCircle },
      submitted: { color: 'purple', icon: Send },
      accepted: { color: 'green', icon: CheckCircle },
      rejected: { color: 'red', icon: AlertTriangle },
      pending: { color: 'amber', icon: Clock },
      paid: { color: 'green', icon: CheckCircle }
    };

    const config = statusConfig[status] || statusConfig.draft;
    const Icon = config.icon;

    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-${config.color}-100 text-${config.color}-700`}>
        <Icon className="w-3 h-3" />
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  const getScrubbingStatusBadge = (scrubbingStatus, hasErrors, hasWarnings) => {
    if (scrubbingStatus === 'failed' || hasErrors) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
          <AlertTriangle className="w-3 h-3" />
          Errors
        </span>
      );
    }
    if (scrubbingStatus === 'warnings' || hasWarnings) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
          <AlertTriangle className="w-3 h-3" />
          Warnings
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
        <CheckCircle className="w-3 h-3" />
        Passed
      </span>
    );
  };

  const stats = {
    total: claims.length,
    pendingReview: claims.filter(c => c.requires_review && c.claim_status === 'scrubbed').length,
    submitted: claims.filter(c => c.claim_status === 'submitted').length,
    paid: claims.filter(c => c.claim_status === 'paid').length
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-6 h-6 text-blue-500" />
            Claims Dashboard
          </h1>
          <p className="text-slate-500 mt-1">Manage claims scrubbing and submission</p>
        </div>
        <Button onClick={fetchClaims} variant="outline">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Total Claims</p>
            <p className="text-2xl font-bold mt-1">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Pending Review</p>
            <p className="text-2xl font-bold mt-1 text-amber-600">{stats.pendingReview}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Submitted</p>
            <p className="text-2xl font-bold mt-1 text-blue-600">{stats.submitted}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Paid</p>
            <p className="text-2xl font-bold mt-1 text-green-600">{stats.paid}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {['all', 'review', 'submitted', 'rejected'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              filter === f
                ? 'bg-blue-100 text-blue-700'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Claims List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : claims.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">No claims found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {claims.map((claim) => (
            <Card key={claim.id}>
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-bold text-lg">Claim #{claim.claim_number}</h3>
                      {getStatusBadge(claim.claim_status)}
                      {getScrubbingStatusBadge(
                        claim.scrubbing_status,
                        claim.scrubbing_errors?.length > 0,
                        claim.scrubbing_warnings?.length > 0
                      )}
                    </div>
                    <p className="text-sm text-gray-500">
                      Service Date: {new Date(claim.service_date_start).toLocaleDateString()}
                    </p>
                    <p className="text-sm text-gray-500">
                      Amount: ${claim.total_charge_amount?.toFixed(2) || '0.00'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-500">Payer</p>
                    <p className="font-medium">{claim.payer_name || 'N/A'}</p>
                  </div>
                </div>

                {/* Scrubbing Errors */}
                {claim.scrubbing_errors && claim.scrubbing_errors.length > 0 && (
                  <div className="mb-4 p-4 bg-red-50 rounded-lg border border-red-200">
                    <p className="text-sm font-bold text-red-900 mb-2">Scrubbing Errors</p>
                    <ul className="space-y-1">
                      {claim.scrubbing_errors.map((error, idx) => (
                        <li key={idx} className="text-sm text-red-700 flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          <span>
                            <strong>{error.code}:</strong> {error.message}
                            {error.suggestion && (
                              <span className="block text-xs text-gray-600 mt-1">
                                Suggestion: {error.suggestion}
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Scrubbing Warnings */}
                {claim.scrubbing_warnings && claim.scrubbing_warnings.length > 0 && (
                  <div className="mb-4 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                    <p className="text-sm font-bold text-yellow-900 mb-2">Warnings</p>
                    <ul className="space-y-1">
                      {claim.scrubbing_warnings.map((warning, idx) => (
                        <li key={idx} className="text-sm text-yellow-700 flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          <span>
                            <strong>{warning.code}:</strong> {warning.message}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Auto-corrected Issues */}
                {claim.auto_corrected_issues && claim.auto_corrected_issues.length > 0 && (
                  <div className="mb-4 p-4 bg-green-50 rounded-lg border border-green-200">
                    <p className="text-sm font-bold text-green-900 mb-2">Auto-corrected</p>
                    <ul className="space-y-1">
                      {claim.auto_corrected_issues.map((fix, idx) => (
                        <li key={idx} className="text-sm text-green-700">
                          <CheckCircle className="w-4 h-4 inline mr-2" />
                          {fix.field}: {fix.action} - {fix.value?.join(', ') || 'N/A'}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-4 border-t">
                  {claim.requires_review && claim.claim_status === 'scrubbed' && (
                    <>
                      {claim.scrubbing_errors?.some(e => e.suggestion) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const corrections = {};
                            claim.scrubbing_errors.forEach(err => {
                              if (err.suggestion && err.field) {
                                corrections[err.field] = err.suggestion;
                              }
                            });
                            handleApplyCorrections(claim.id, corrections);
                          }}
                        >
                          Apply Suggested Fixes
                        </Button>
                      )}
                      <Button
                        size="sm"
                        onClick={() => handleSubmitClaim(claim.id)}
                      >
                        <Send className="w-4 h-4 mr-2" />
                        Submit to Clearinghouse
                      </Button>
                    </>
                  )}
                  {claim.claim_status === 'draft' && (
                    <Button
                      size="sm"
                      onClick={() => {
                        // Trigger scrubbing
                        fetchClaims();
                      }}
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Scrub Claim
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

