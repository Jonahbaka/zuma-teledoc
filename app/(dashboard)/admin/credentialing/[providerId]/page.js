'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  ArrowLeft, CheckCircle2, XCircle, Clock, AlertCircle,
  User, Stethoscope, Award, Shield, GraduationCap, Briefcase,
  Users, FileText, Download, Eye, Mail, Phone, MapPin,
  Loader2, Check, X, RefreshCw, ExternalLink, Calendar
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const STEP_STATUS_COLORS = {
  not_started: 'bg-gray-200 dark:bg-gray-700',
  in_progress: 'bg-blue-500',
  pending_review: 'bg-amber-500',
  approved: 'bg-green-500',
  rejected: 'bg-red-500',
  requires_resubmission: 'bg-orange-500'
};

function formatDateISO(value) {
  if (!value) return 'N/A';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'N/A';
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function formatDateTimeISO(value) {
  if (!value) return 'N/A';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'N/A';
  // YYYY-MM-DD HH:MM:SSZ (UTC) - deterministic
  return d.toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

function formatUSD(value) {
  if (value === null || value === undefined || value === '') return 'N/A';
  const n = Number(value);
  if (Number.isNaN(n)) return 'N/A';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export default function AdminCredentialingDetailPage() {
  const { providerId } = useParams();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [credentialing, setCredentialing] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    fetchCredentialing();
  }, [providerId]);

  const fetchCredentialing = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/credentialing/admin/${providerId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
        }
      });
      const data = await response.json();
      
      if (data.success) {
        setCredentialing(data.credentialing);
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error('Error fetching credentialing:', error);
      toast({
        title: 'Error',
        description: 'Failed to load credentialing data',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const verifyCredential = async (credentialType, verified) => {
    try {
      setSaving(true);
      const response = await fetch(`/api/credentialing/admin/${providerId}/verify`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
        },
        body: JSON.stringify({ credentialType, verified })
      });
      
      const data = await response.json();
      
      if (data.success) {
        toast({
          title: 'Success',
          description: `${credentialType} ${verified ? 'verified' : 'unverified'}`
        });
        await fetchCredentialing();
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const updateStepStatus = async (stepNumber, status, notes = '') => {
    try {
      setSaving(true);
      const response = await fetch(`/api/credentialing/admin/${providerId}/step`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
        },
        body: JSON.stringify({ stepNumber, status, reviewNotes: notes })
      });
      
      const data = await response.json();
      
      if (data.success) {
        toast({ title: 'Step updated' });
        await fetchCredentialing();
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  const makeDecision = async (decision, reason = '') => {
    if (decision === 'rejected' && !reason) {
      toast({
        title: 'Reason Required',
        description: 'Please provide a reason for rejection',
        variant: 'destructive'
      });
      return;
    }
    
    try {
      setSaving(true);
      const response = await fetch(`/api/credentialing/admin/${providerId}/decision`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
        },
        body: JSON.stringify({ decision, reason })
      });
      
      const data = await response.json();
      
      if (data.success) {
        toast({
          title: `Provider ${decision}`,
          description: `Credentialing has been ${decision}`
        });
        await fetchCredentialing();
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
      </div>
    );
  }

  if (!credentialing) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
        <p className="text-muted-foreground">Credentialing record not found</p>
        <Button variant="outline" className="mt-4" onClick={() => router.back()}>
          Go Back
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold font-serif text-foreground">
            {credentialing.legalFirstName || credentialing.firstName} {credentialing.legalLastName || credentialing.lastName}
          </h1>
          <p className="text-muted-foreground">
            {credentialing.email} • {credentialing.specialty || 'Specialty not specified'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Progress value={credentialing.progressPercentage || 0} className="w-32 h-3" />
          <span className="font-bold text-purple-600">{credentialing.progressPercentage || 0}%</span>
        </div>
      </div>

      {/* Status Banner */}
      {credentialing.status === 'approved' && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-green-500" />
            <div>
              <p className="font-medium text-green-700 dark:text-green-400">Approved</p>
              <p className="text-sm text-green-600 dark:text-green-300">
                Valid until: {formatDateISO(credentialing.approvalExpiry)}
              </p>
            </div>
          </div>
        </div>
      )}

      {credentialing.status === 'rejected' && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <XCircle className="w-6 h-6 text-red-500" />
            <div>
              <p className="font-medium text-red-700 dark:text-red-400">Rejected</p>
              <p className="text-sm text-red-600 dark:text-red-300">
                {credentialing.rejectionReason || 'No reason provided'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Decision Buttons */}
      {credentialing.status !== 'approved' && credentialing.status !== 'rejected' && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Ready to make a decision?</span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="border-red-500 text-red-500 hover:bg-red-50"
                  disabled={saving}
                  onClick={() => {
                    const reason = prompt('Please provide a reason for rejection:');
                    if (reason) makeDecision('rejected', reason);
                  }}
                >
                  <XCircle className="w-4 h-4 mr-2" />
                  Reject
                </Button>
                <Button
                  className="bg-green-600 hover:bg-green-700"
                  disabled={saving}
                  onClick={() => makeDecision('approved')}
                >
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Approve
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-5 w-full max-w-2xl">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="credentials">Credentials</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6 mt-6">
          {/* Steps Progress */}
          <Card>
            <CardHeader>
              <CardTitle>Credentialing Steps</CardTitle>
              <CardDescription>Track progress through each verification step</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {credentialing.steps?.map((step) => (
                  <div key={step.stepNumber} className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${STEP_STATUS_COLORS[step.status]}`}>
                      {step.status === 'approved' ? (
                        <Check className="w-4 h-4 text-white" />
                      ) : step.status === 'rejected' ? (
                        <X className="w-4 h-4 text-white" />
                      ) : (
                        <span className="text-sm font-medium text-white">{step.stepNumber}</span>
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-foreground">{step.stepName}</p>
                      <p className="text-xs text-muted-foreground capitalize">{step.status?.replace(/_/g, ' ')}</p>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-green-600 hover:text-green-700"
                        disabled={saving || step.status === 'approved'}
                        onClick={() => updateStepStatus(step.stepNumber, 'approved')}
                      >
                        <Check className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600 hover:text-red-700"
                        disabled={saving || step.status === 'rejected'}
                        onClick={() => updateStepStatus(step.stepNumber, 'rejected')}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Personal Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="w-5 h-5" />
                Personal Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <Label className="text-muted-foreground">Full Name</Label>
                  <p className="font-medium">
                    {credentialing.legalFirstName} {credentialing.legalMiddleName} {credentialing.legalLastName}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Date of Birth</Label>
                  <p className="font-medium">
                    {formatDateISO(credentialing.dateOfBirth)}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Email</Label>
                  <p className="font-medium">{credentialing.email}</p>
                </div>
                <div className="col-span-2">
                  <Label className="text-muted-foreground">Address</Label>
                  <p className="font-medium">
                    {credentialing.primaryAddress}, {credentialing.city}, {credentialing.state} {credentialing.zipCode}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Professional Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Stethoscope className="w-5 h-5" />
                Professional Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <Label className="text-muted-foreground">Specialty</Label>
                  <p className="font-medium">{credentialing.specialty || 'N/A'}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Years in Practice</Label>
                  <p className="font-medium">{credentialing.yearsInPractice || 'N/A'}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Practice Type</Label>
                  <p className="font-medium">{credentialing.practiceType || 'N/A'}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Credentials Tab */}
        <TabsContent value="credentials" className="space-y-6 mt-6">
          {/* Medical License */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Award className="w-5 h-5" />
                  Medical License
                </CardTitle>
                <div className="flex items-center gap-2">
                  {credentialing.licenseVerified ? (
                    <span className="flex items-center gap-1 text-green-600 text-sm">
                      <CheckCircle2 className="w-4 h-4" /> Verified
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-amber-600 text-sm">
                      <Clock className="w-4 h-4" /> Pending
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant={credentialing.licenseVerified ? 'outline' : 'default'}
                    disabled={saving}
                    onClick={() => verifyCredential('license', !credentialing.licenseVerified)}
                  >
                    {credentialing.licenseVerified ? 'Unverify' : 'Verify'}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label className="text-muted-foreground">License Number</Label>
                  <p className="font-medium">{credentialing.medicalLicenseNumber || 'N/A'}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">State</Label>
                  <p className="font-medium">{credentialing.medicalLicenseState || 'N/A'}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Expiry Date</Label>
                  <p className="font-medium">
                    {formatDateISO(credentialing.medicalLicenseExpiry)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* DEA Registration */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Shield className="w-5 h-5" />
                  DEA Registration
                </CardTitle>
                <div className="flex items-center gap-2">
                  {credentialing.deaVerified ? (
                    <span className="flex items-center gap-1 text-green-600 text-sm">
                      <CheckCircle2 className="w-4 h-4" /> Verified
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-amber-600 text-sm">
                      <Clock className="w-4 h-4" /> Pending
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant={credentialing.deaVerified ? 'outline' : 'default'}
                    disabled={saving}
                    onClick={() => verifyCredential('dea', !credentialing.deaVerified)}
                  >
                    {credentialing.deaVerified ? 'Unverify' : 'Verify'}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">DEA Number</Label>
                  <p className="font-medium">{credentialing.deaNumber || 'N/A'}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Expiry Date</Label>
                  <p className="font-medium">
                    {formatDateISO(credentialing.deaExpiry)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* NPI */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  NPI Verification
                </CardTitle>
                <div className="flex items-center gap-2">
                  {credentialing.npiVerified ? (
                    <span className="flex items-center gap-1 text-green-600 text-sm">
                      <CheckCircle2 className="w-4 h-4" /> Verified
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-amber-600 text-sm">
                      <Clock className="w-4 h-4" /> Pending
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant={credentialing.npiVerified ? 'outline' : 'default'}
                    disabled={saving}
                    onClick={() => verifyCredential('npi', !credentialing.npiVerified)}
                  >
                    {credentialing.npiVerified ? 'Unverify' : 'Verify'}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div>
                <Label className="text-muted-foreground">NPI Number</Label>
                <p className="font-medium">{credentialing.npiNumber || 'N/A'}</p>
              </div>
              {credentialing.npiNumber && (
                <a
                  href={`https://npiregistry.cms.hhs.gov/provider-view/${credentialing.npiNumber}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-purple-600 hover:underline mt-2"
                >
                  Verify on NPI Registry <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </CardContent>
          </Card>

          {/* Education */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <GraduationCap className="w-5 h-5" />
                  Education & Training
                </CardTitle>
                <div className="flex items-center gap-2">
                  {credentialing.educationVerified ? (
                    <span className="flex items-center gap-1 text-green-600 text-sm">
                      <CheckCircle2 className="w-4 h-4" /> Verified
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-amber-600 text-sm">
                      <Clock className="w-4 h-4" /> Pending
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant={credentialing.educationVerified ? 'outline' : 'default'}
                    disabled={saving}
                    onClick={() => verifyCredential('education', !credentialing.educationVerified)}
                  >
                    {credentialing.educationVerified ? 'Unverify' : 'Verify'}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <Label className="text-muted-foreground">Medical School</Label>
                  <p className="font-medium">{credentialing.medicalSchool || 'N/A'}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Graduation Year</Label>
                  <p className="font-medium">{credentialing.graduationYear || 'N/A'}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Degree</Label>
                  <p className="font-medium">{credentialing.degreeType || 'N/A'}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Residency Program</Label>
                  <p className="font-medium">{credentialing.residencyProgram || 'N/A'}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Residency Completion</Label>
                  <p className="font-medium">{credentialing.residencyCompletionYear || 'N/A'}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Malpractice Insurance */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Shield className="w-5 h-5" />
                  Malpractice Insurance
                </CardTitle>
                <div className="flex items-center gap-2">
                  {credentialing.malpracticeVerified ? (
                    <span className="flex items-center gap-1 text-green-600 text-sm">
                      <CheckCircle2 className="w-4 h-4" /> Verified
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-amber-600 text-sm">
                      <Clock className="w-4 h-4" /> Pending
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant={credentialing.malpracticeVerified ? 'outline' : 'default'}
                    disabled={saving}
                    onClick={() => verifyCredential('malpractice', !credentialing.malpracticeVerified)}
                  >
                    {credentialing.malpracticeVerified ? 'Unverify' : 'Verify'}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <Label className="text-muted-foreground">Carrier</Label>
                  <p className="font-medium">{credentialing.malpracticeCarrier || 'N/A'}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Policy Number</Label>
                  <p className="font-medium">{credentialing.malpracticePolicyNumber || 'N/A'}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Coverage Amount</Label>
                  <p className="font-medium">
                    {formatUSD(credentialing.malpracticeCoverageAmount)}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Expiry Date</Label>
                  <p className="font-medium">
                    {formatDateISO(credentialing.malpracticeExpiry)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Documents Tab */}
        <TabsContent value="documents" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Uploaded Documents</CardTitle>
              <CardDescription>{credentialing.documents?.length || 0} documents uploaded</CardDescription>
            </CardHeader>
            <CardContent>
              {credentialing.documents?.length > 0 ? (
                <div className="space-y-3">
                  {credentialing.documents.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <FileText className="w-8 h-8 text-muted-foreground" />
                        <div>
                          <p className="font-medium">{doc.documentName}</p>
                          <p className="text-xs text-muted-foreground">
                            {doc.documentType?.replace(/_/g, ' ')} • Uploaded {formatDateISO(doc.uploadedAt)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-1 rounded ${
                          doc.status === 'approved' ? 'bg-green-100 text-green-700' :
                          doc.status === 'rejected' ? 'bg-red-100 text-red-700' :
                          'bg-amber-100 text-amber-700'
                        }`}>
                          {doc.status?.replace(/_/g, ' ')}
                        </span>
                        <Button size="sm" variant="ghost">
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button size="sm" variant="ghost">
                          <Download className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center py-8 text-muted-foreground">No documents uploaded yet</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Work History Tab */}
        <TabsContent value="history" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Briefcase className="w-5 h-5" />
                Work History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {credentialing.workHistory?.length > 0 ? (
                <div className="space-y-4">
                  {credentialing.workHistory.map((work, index) => (
                    <div key={index} className="border-l-2 border-purple-500 pl-4 pb-4">
                      <p className="font-medium text-foreground">{work.employerName}</p>
                      <p className="text-sm text-muted-foreground">{work.positionTitle}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatDateISO(work.startDate)} - {work.isCurrent ? 'Present' : formatDateISO(work.endDate)}
                      </p>
                      {work.verified && (
                        <span className="inline-flex items-center gap-1 text-xs text-green-600 mt-1">
                          <CheckCircle2 className="w-3 h-3" /> Verified
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center py-8 text-muted-foreground">No work history provided</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                Professional References
              </CardTitle>
              <CardDescription>
                {credentialing.referencesSubmitted || 0} of {credentialing.referencesRequired || 3} references submitted
              </CardDescription>
            </CardHeader>
            <CardContent>
              {credentialing.references?.length > 0 ? (
                <div className="space-y-4">
                  {credentialing.references.map((ref, index) => (
                    <div key={index} className="p-4 bg-muted/50 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-foreground">{ref.referenceName}</p>
                          <p className="text-sm text-muted-foreground">
                            {ref.referenceTitle} at {ref.referenceOrganization}
                          </p>
                          <p className="text-sm text-muted-foreground">{ref.referenceEmail}</p>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded ${
                          ref.verificationStatus === 'approved' ? 'bg-green-100 text-green-700' :
                          ref.verificationStatus === 'rejected' ? 'bg-red-100 text-red-700' :
                          'bg-amber-100 text-amber-700'
                        }`}>
                          {ref.verificationStatus?.replace(/_/g, ' ') || 'Pending'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center py-8 text-muted-foreground">No references provided</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Audit Log Tab */}
        <TabsContent value="audit" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Activity Log</CardTitle>
              <CardDescription>Complete history of credentialing actions</CardDescription>
            </CardHeader>
            <CardContent>
              {credentialing.auditLog?.length > 0 ? (
                <div className="space-y-3">
                  {credentialing.auditLog.map((log, index) => (
                    <div key={index} className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                      <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
                        <Calendar className="w-4 h-4 text-purple-600" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground">
                          {log.action?.replace(/_/g, ' ')}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTimeISO(log.createdAt)} • {log.actionByRole}
                        </p>
                        {log.details && Object.keys(log.details).length > 0 && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {JSON.stringify(log.details)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-center py-8 text-muted-foreground">No activity recorded</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

