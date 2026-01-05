'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Pill, Plus, Send, Search, FileText, User, MapPin,
  Loader2, CheckCircle, Clock, AlertTriangle, X,
  RefreshCw, Filter, Calendar, Phone, Building2, AlertCircle,
  ChevronRight, ListOrdered
} from 'lucide-react';
import { prescriptionAPI, pharmacyAPI, usersAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/use-toast';
import { format } from 'date-fns';

// Status badge colors
const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-800',
  pending: 'bg-yellow-100 text-yellow-800',
  sent: 'bg-blue-100 text-blue-800',
  filled: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
  expired: 'bg-orange-100 text-orange-800',
  refill_requested: 'bg-purple-100 text-purple-800'
};

// Common medications for quick selection
const COMMON_MEDICATIONS = [
  { name: 'Amoxicillin', strength: '500mg', form: 'Capsule', sig: 'Take 1 capsule by mouth 3 times daily for 10 days' },
  { name: 'Lisinopril', strength: '10mg', form: 'Tablet', sig: 'Take 1 tablet by mouth once daily' },
  { name: 'Metformin', strength: '500mg', form: 'Tablet', sig: 'Take 1 tablet by mouth twice daily with meals' },
  { name: 'Omeprazole', strength: '20mg', form: 'Capsule', sig: 'Take 1 capsule by mouth once daily before breakfast' },
  { name: 'Atorvastatin', strength: '20mg', form: 'Tablet', sig: 'Take 1 tablet by mouth once daily at bedtime' },
  { name: 'Azithromycin', strength: '250mg', form: 'Tablet', sig: 'Take 2 tablets day 1, then 1 tablet daily for days 2-5' },
  { name: 'Prednisone', strength: '10mg', form: 'Tablet', sig: 'Take as directed by physician' },
  { name: 'Albuterol HFA', strength: '90mcg', form: 'Inhaler', sig: '2 puffs every 4-6 hours as needed for shortness of breath' }
];

export default function ProviderPrescriptionsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // State
  const [prescriptions, setPrescriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // New prescription modal
  const [showNewRx, setShowNewRx] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [patientSearch, setPatientSearch] = useState('');
  const [patientResults, setPatientResults] = useState([]);
  const [loadingPatients, setLoadingPatients] = useState(false);
  
  // Prescription form
  const [rxForm, setRxForm] = useState({
    medicationName: '',
    genericName: '',
    ndcCode: '',
    dosageStrength: '',
    dosageForm: '',
    dosageUnit: '',
    routeOfAdministration: 'Oral',
    quantity: 30,
    quantityUnit: '',
    daysSupply: 30,
    refillsAllowed: 0,
    dispenseAsWritten: false,
    scheduleClass: 'non-controlled',
    sigDirections: '',
    patientInstructions: '',
    pharmacyNotes: '',
    diagnosisCode: '',
    diagnosisDescription: '',
    indication: '',
    requiresPriorAuth: false
  });
  
  // Pharmacy selection
  const [selectedPharmacy, setSelectedPharmacy] = useState(null);
  const [pharmacySearch, setPharmacySearch] = useState('');
  const [pharmacyResults, setPharmacyResults] = useState([]);
  const [patientPharmacies, setPatientPharmacies] = useState([]);
  const [loadingPharmacies, setLoadingPharmacies] = useState(false);
  
  // Medication search
  const [medSearch, setMedSearch] = useState('');
  const [medResults, setMedResults] = useState([]);
  const [loadingMeds, setLoadingMeds] = useState(false);
  
  const [submitting, setSubmitting] = useState(false);
  
  // Load prescriptions
  const loadPrescriptions = useCallback(async () => {
    setLoading(true);
    try {
      const status = activeTab === 'all' ? undefined : activeTab;
      const response = await prescriptionAPI.getAll({ status });
      
      if (response.data.success) {
        setPrescriptions(response.data.prescriptions);
      }
    } catch (error) {
      console.error('Load prescriptions error:', error);
      toast({
        title: 'Error',
        description: 'Failed to load prescriptions',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  }, [activeTab]);
  
  useEffect(() => {
    loadPrescriptions();
  }, [loadPrescriptions]);
  
  // Check for pre-filled patient from URL
  useEffect(() => {
    const patientId = searchParams.get('patientId');
    if (patientId) {
      loadPatientById(patientId);
      setShowNewRx(true);
    }
  }, [searchParams]);
  
  const loadPatientById = async (patientId) => {
    try {
      const response = await usersAPI.getUser(patientId);
      if (response.data.success) {
        setSelectedPatient(response.data.user);
        loadPatientPharmacies(patientId);
      }
    } catch (error) {
      console.error('Load patient error:', error);
    }
  };
  
  // Search patients
  useEffect(() => {
    if (patientSearch.length < 2) {
      setPatientResults([]);
      return;
    }
    
    const search = async () => {
      setLoadingPatients(true);
      try {
        const response = await usersAPI.getUsers({ 
          query: patientSearch, 
          role: 'patient', 
          limit: 10 
        });
        if (response.data.success) {
          setPatientResults(response.data.users);
        }
      } catch (error) {
        console.error('Search patients error:', error);
      } finally {
        setLoadingPatients(false);
      }
    };
    
    const debounce = setTimeout(search, 300);
    return () => clearTimeout(debounce);
  }, [patientSearch]);
  
  // Load patient's preferred pharmacies
  const loadPatientPharmacies = async (patientId) => {
    setLoadingPharmacies(true);
    try {
      const response = await pharmacyAPI.getPreferences(patientId);
      if (response.data.success) {
        setPatientPharmacies(response.data.pharmacies);
        // Auto-select preferred pharmacy
        const preferred = response.data.pharmacies.find(p => p.isPreferred);
        if (preferred) {
          setSelectedPharmacy(preferred);
        }
      }
    } catch (error) {
      console.error('Load pharmacies error:', error);
    } finally {
      setLoadingPharmacies(false);
    }
  };
  
  // Search medications
  useEffect(() => {
    if (medSearch.length < 2) {
      setMedResults([]);
      return;
    }
    
    const search = async () => {
      setLoadingMeds(true);
      try {
        const response = await prescriptionAPI.searchMedications(medSearch);
        if (response.data.success) {
          setMedResults(response.data.medications);
        }
      } catch (error) {
        console.error('Search medications error:', error);
        // Fall back to common medications filter
        setMedResults(
          COMMON_MEDICATIONS.filter(m => 
            m.name.toLowerCase().includes(medSearch.toLowerCase())
          )
        );
      } finally {
        setLoadingMeds(false);
      }
    };
    
    const debounce = setTimeout(search, 300);
    return () => clearTimeout(debounce);
  }, [medSearch]);
  
  // Select patient
  const selectPatient = (patient) => {
    setSelectedPatient(patient);
    setPatientSearch('');
    setPatientResults([]);
    loadPatientPharmacies(patient.id);
  };
  
  // Select medication
  const selectMedication = (med) => {
    setRxForm(prev => ({
      ...prev,
      medicationName: med.name,
      dosageStrength: med.strength || med.dosageStrength || '',
      dosageForm: med.form || med.dosageForm || '',
      sigDirections: med.sig || med.sigDirections || ''
    }));
    setMedSearch('');
    setMedResults([]);
  };
  
  // Handle form change
  const handleFormChange = (field, value) => {
    setRxForm(prev => ({ ...prev, [field]: value }));
  };
  
  // Create prescription
  const handleCreatePrescription = async (sendNow = false) => {
    if (!selectedPatient) {
      toast({
        title: 'Patient Required',
        description: 'Please select a patient',
        variant: 'destructive'
      });
      return;
    }
    
    if (!rxForm.medicationName || !rxForm.dosageStrength || !rxForm.sigDirections) {
      toast({
        title: 'Missing Information',
        description: 'Please fill in medication name, strength, and directions',
        variant: 'destructive'
      });
      return;
    }
    
    setSubmitting(true);
    try {
      const prescriptionData = {
        patientId: selectedPatient.id,
        ...rxForm,
        pharmacy: selectedPharmacy ? {
          id: selectedPharmacy.id,
          name: selectedPharmacy.pharmacyName || selectedPharmacy.name,
          npi: selectedPharmacy.pharmacyNpi || selectedPharmacy.npi,
          address: selectedPharmacy.pharmacyAddress || selectedPharmacy.address,
          phone: selectedPharmacy.pharmacyPhone || selectedPharmacy.phone,
          fax: selectedPharmacy.pharmacyFax || selectedPharmacy.fax
        } : null
      };
      
      const response = await prescriptionAPI.create(prescriptionData);
      
      if (response.data.success) {
        const rx = response.data.prescription;
        
        if (sendNow && selectedPharmacy) {
          // Sign and send immediately
          await prescriptionAPI.signAndSend(rx.id, {
            deaNumber: '', // Would come from provider profile
            signature: 'Electronic Signature'
          });
          
          toast({
            title: 'Prescription Sent',
            description: `${rxForm.medicationName} sent to ${selectedPharmacy.pharmacyName || selectedPharmacy.name}`,
            variant: 'success'
          });
        } else {
          toast({
            title: 'Prescription Created',
            description: 'Prescription saved as draft',
            variant: 'success'
          });
        }
        
        resetForm();
        setShowNewRx(false);
        loadPrescriptions();
      }
    } catch (error) {
      console.error('Create prescription error:', error);
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to create prescription',
        variant: 'destructive'
      });
    } finally {
      setSubmitting(false);
    }
  };
  
  // Send existing prescription
  const handleSendPrescription = async (rx) => {
    if (!rx.pharmacy) {
      toast({
        title: 'Pharmacy Required',
        description: 'Please select a pharmacy first',
        variant: 'destructive'
      });
      return;
    }
    
    try {
      await prescriptionAPI.signAndSend(rx.id, {
        deaNumber: '',
        signature: 'Electronic Signature'
      });
      
      toast({
        title: 'Prescription Sent',
        description: `${rx.medicationName} sent to ${rx.pharmacy.name}`,
        variant: 'success'
      });
      
      loadPrescriptions();
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to send prescription',
        variant: 'destructive'
      });
    }
  };
  
  // Cancel prescription
  const handleCancelPrescription = async (rx) => {
    if (!confirm('Are you sure you want to cancel this prescription?')) return;
    
    try {
      await prescriptionAPI.cancel(rx.id, 'Provider cancelled');
      
      toast({
        title: 'Prescription Cancelled',
        description: `${rx.medicationName} has been cancelled`,
        variant: 'default'
      });
      
      loadPrescriptions();
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to cancel prescription',
        variant: 'destructive'
      });
    }
  };
  
  // Reset form
  const resetForm = () => {
    setRxForm({
      medicationName: '',
      genericName: '',
      ndcCode: '',
      dosageStrength: '',
      dosageForm: '',
      dosageUnit: '',
      routeOfAdministration: 'Oral',
      quantity: 30,
      quantityUnit: '',
      daysSupply: 30,
      refillsAllowed: 0,
      dispenseAsWritten: false,
      scheduleClass: 'non-controlled',
      sigDirections: '',
      patientInstructions: '',
      pharmacyNotes: '',
      diagnosisCode: '',
      diagnosisDescription: '',
      indication: '',
      requiresPriorAuth: false
    });
    setSelectedPatient(null);
    setSelectedPharmacy(null);
    setPatientPharmacies([]);
  };
  
  // Filter prescriptions by search
  const filteredPrescriptions = prescriptions.filter(rx =>
    rx.medicationName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    rx.patientFirstName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    rx.patientLastName?.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  if (loading && prescriptions.length === 0) {
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
            <div className="p-2 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl">
              <Pill className="w-6 h-6 text-white" />
            </div>
            E-Prescriptions
          </h1>
          <p className="text-muted-foreground mt-1">Manage and send prescriptions to pharmacies</p>
        </div>
        
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={loadPrescriptions}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={() => setShowNewRx(true)} className="bg-purple-600 hover:bg-purple-700">
            <Plus className="w-4 h-4 mr-2" />
            New Prescription
          </Button>
        </div>
      </div>
      
      {/* Tabs and Search */}
      <div className="flex items-center justify-between gap-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="draft">Drafts</TabsTrigger>
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="sent">Sent</TabsTrigger>
            <TabsTrigger value="filled">Filled</TabsTrigger>
            <TabsTrigger value="refill_requested">Refill Requests</TabsTrigger>
          </TabsList>
        </Tabs>
        
        <div className="relative min-w-[250px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search prescriptions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>
      
      {/* Prescriptions Grid */}
      {filteredPrescriptions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Pill className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold">No Prescriptions Found</h3>
            <p className="text-muted-foreground mt-1">
              {activeTab === 'all' 
                ? 'Create your first prescription to get started'
                : `No ${activeTab} prescriptions`}
            </p>
            <Button onClick={() => setShowNewRx(true)} className="mt-4">
              <Plus className="w-4 h-4 mr-2" />
              New Prescription
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredPrescriptions.map((rx) => (
            <Card key={rx.id} className="hover:shadow-lg transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{rx.medicationName}</CardTitle>
                    <CardDescription>
                      {rx.dosageStrength} {rx.dosageForm}
                    </CardDescription>
                  </div>
                  <Badge className={STATUS_COLORS[rx.status]}>
                    {rx.status.replace('_', ' ')}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <User className="w-4 h-4 text-muted-foreground" />
                  <span>{rx.patientFirstName} {rx.patientLastName}</span>
                </div>
                
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {rx.sigDirections}
                </p>
                
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <p className="text-muted-foreground">Qty</p>
                    <p className="font-medium">{rx.quantity}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Days</p>
                    <p className="font-medium">{rx.daysSupply}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Refills</p>
                    <p className="font-medium">{rx.refillsAllowed || 0}</p>
                  </div>
                </div>
                
                {rx.pharmacy && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Building2 className="w-4 h-4" />
                    <span className="truncate">{rx.pharmacy.name}</span>
                  </div>
                )}
                
                <div className="text-xs text-muted-foreground">
                  Created {format(new Date(rx.createdAt), 'MMM d, yyyy')}
                </div>
              </CardContent>
              <CardFooter className="border-t pt-4 gap-2">
                {rx.status === 'draft' && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => handleSendPrescription(rx)}
                      disabled={!rx.pharmacy}
                      className="flex-1 bg-purple-600 hover:bg-purple-700"
                    >
                      <Send className="w-4 h-4 mr-1" />
                      Send
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleCancelPrescription(rx)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </>
                )}
                {rx.status === 'pending' && (
                  <Button
                    size="sm"
                    onClick={() => handleSendPrescription(rx)}
                    className="flex-1 bg-purple-600 hover:bg-purple-700"
                  >
                    <Send className="w-4 h-4 mr-1" />
                    Send to Pharmacy
                  </Button>
                )}
                {rx.status === 'sent' && (
                  <Badge variant="outline" className="flex-1 justify-center py-2">
                    <Clock className="w-3 h-3 mr-1" />
                    Awaiting Pharmacy
                  </Badge>
                )}
                {rx.status === 'filled' && (
                  <Badge variant="secondary" className="flex-1 justify-center py-2">
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Filled
                  </Badge>
                )}
                {rx.status === 'refill_requested' && (
                  <Button
                    size="sm"
                    onClick={() => handleSendPrescription(rx)}
                    className="flex-1 bg-purple-600 hover:bg-purple-700"
                  >
                    <Send className="w-4 h-4 mr-1" />
                    Approve Refill
                  </Button>
                )}
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
      
      {/* New Prescription Dialog */}
      <Dialog open={showNewRx} onOpenChange={(open) => { if (!open) resetForm(); setShowNewRx(open); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pill className="w-5 h-5 text-purple-500" />
              New Prescription
            </DialogTitle>
            <DialogDescription>
              Create and send a new prescription to the patient's pharmacy
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-6 py-4">
            {/* Patient Selection */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Patient
                </CardTitle>
              </CardHeader>
              <CardContent>
                {selectedPatient ? (
                  <div className="flex items-center justify-between p-3 bg-accent rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                        <User className="w-5 h-5 text-purple-600" />
                      </div>
                      <div>
                        <p className="font-medium">{selectedPatient.firstName} {selectedPatient.lastName}</p>
                        <p className="text-sm text-muted-foreground">{selectedPatient.email}</p>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => {
                      setSelectedPatient(null);
                      setPatientPharmacies([]);
                      setSelectedPharmacy(null);
                    }}>
                      Change
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        placeholder="Search patients by name or email..."
                        value={patientSearch}
                        onChange={(e) => setPatientSearch(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                    
                    {loadingPatients && (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="w-5 h-5 animate-spin text-purple-500" />
                      </div>
                    )}
                    
                    {patientResults.length > 0 && (
                      <div className="border rounded-lg max-h-48 overflow-y-auto">
                        {patientResults.map((patient) => (
                          <button
                            key={patient.id}
                            onClick={() => selectPatient(patient)}
                            className="w-full p-3 text-left hover:bg-accent transition-colors border-b last:border-0 flex items-center justify-between"
                          >
                            <div>
                              <p className="font-medium">{patient.firstName} {patient.lastName}</p>
                              <p className="text-sm text-muted-foreground">{patient.email}</p>
                            </div>
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            
            {/* Medication Selection */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Pill className="w-4 h-4" />
                  Medication
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Quick select */}
                <div className="flex flex-wrap gap-2">
                  {COMMON_MEDICATIONS.slice(0, 4).map((med) => (
                    <Button
                      key={med.name}
                      variant="outline"
                      size="sm"
                      onClick={() => selectMedication(med)}
                    >
                      {med.name}
                    </Button>
                  ))}
                </div>
                
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search medications..."
                    value={medSearch}
                    onChange={(e) => setMedSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                
                {medResults.length > 0 && (
                  <div className="border rounded-lg max-h-40 overflow-y-auto">
                    {medResults.map((med, idx) => (
                      <button
                        key={idx}
                        onClick={() => selectMedication(med)}
                        className="w-full p-3 text-left hover:bg-accent transition-colors border-b last:border-0"
                      >
                        <p className="font-medium">{med.name} {med.strength}</p>
                        <p className="text-sm text-muted-foreground">{med.form}</p>
                      </button>
                    ))}
                  </div>
                )}
                
                {/* Form fields */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Medication Name *</Label>
                    <Input
                      value={rxForm.medicationName}
                      onChange={(e) => handleFormChange('medicationName', e.target.value)}
                      placeholder="e.g., Amoxicillin"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Strength *</Label>
                    <Input
                      value={rxForm.dosageStrength}
                      onChange={(e) => handleFormChange('dosageStrength', e.target.value)}
                      placeholder="e.g., 500mg"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Form</Label>
                    <Select value={rxForm.dosageForm} onValueChange={(v) => handleFormChange('dosageForm', v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select form" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Tablet">Tablet</SelectItem>
                        <SelectItem value="Capsule">Capsule</SelectItem>
                        <SelectItem value="Liquid">Liquid</SelectItem>
                        <SelectItem value="Injection">Injection</SelectItem>
                        <SelectItem value="Inhaler">Inhaler</SelectItem>
                        <SelectItem value="Cream">Cream</SelectItem>
                        <SelectItem value="Ointment">Ointment</SelectItem>
                        <SelectItem value="Patch">Patch</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Route</Label>
                    <Select value={rxForm.routeOfAdministration} onValueChange={(v) => handleFormChange('routeOfAdministration', v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Oral">Oral</SelectItem>
                        <SelectItem value="Topical">Topical</SelectItem>
                        <SelectItem value="Inhalation">Inhalation</SelectItem>
                        <SelectItem value="Injection">Injection</SelectItem>
                        <SelectItem value="Sublingual">Sublingual</SelectItem>
                        <SelectItem value="Rectal">Rectal</SelectItem>
                        <SelectItem value="Ophthalmic">Ophthalmic</SelectItem>
                        <SelectItem value="Otic">Otic</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label>Directions (Sig) *</Label>
                  <Textarea
                    value={rxForm.sigDirections}
                    onChange={(e) => handleFormChange('sigDirections', e.target.value)}
                    placeholder="Take 1 tablet by mouth twice daily..."
                    rows={2}
                  />
                </div>
                
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Quantity</Label>
                    <Input
                      type="number"
                      value={rxForm.quantity}
                      onChange={(e) => handleFormChange('quantity', parseInt(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Days Supply</Label>
                    <Input
                      type="number"
                      value={rxForm.daysSupply}
                      onChange={(e) => handleFormChange('daysSupply', parseInt(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Refills</Label>
                    <Input
                      type="number"
                      min="0"
                      max="12"
                      value={rxForm.refillsAllowed}
                      onChange={(e) => handleFormChange('refillsAllowed', parseInt(e.target.value))}
                    />
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="daw"
                      checked={rxForm.dispenseAsWritten}
                      onCheckedChange={(v) => handleFormChange('dispenseAsWritten', v)}
                    />
                    <Label htmlFor="daw" className="cursor-pointer">Dispense As Written (DAW)</Label>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            {/* Pharmacy Selection */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Building2 className="w-4 h-4" />
                  Pharmacy
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {loadingPharmacies ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="w-5 h-5 animate-spin text-purple-500" />
                  </div>
                ) : patientPharmacies.length > 0 ? (
                  <div className="space-y-2">
                    <Label>Patient's Saved Pharmacies</Label>
                    {patientPharmacies.map((pharmacy) => (
                      <button
                        key={pharmacy.id}
                        onClick={() => setSelectedPharmacy(pharmacy)}
                        className={`w-full p-3 text-left rounded-lg border transition-colors ${
                          selectedPharmacy?.id === pharmacy.id
                            ? 'border-purple-500 bg-purple-50 dark:bg-purple-950'
                            : 'border-border hover:border-purple-200'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">{pharmacy.pharmacyName || pharmacy.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {pharmacy.pharmacyAddress || pharmacy.address}
                            </p>
                            {pharmacy.pharmacyPhone && (
                              <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                                <Phone className="w-3 h-3" />
                                {pharmacy.pharmacyPhone}
                              </p>
                            )}
                          </div>
                          {pharmacy.isPreferred && (
                            <Badge variant="secondary">Preferred</Badge>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : selectedPatient ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No saved pharmacies for this patient
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Select a patient to see their pharmacies
                  </p>
                )}
              </CardContent>
            </Card>
            
            {/* Additional Info */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Additional Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Diagnosis Code (ICD-10)</Label>
                    <Input
                      value={rxForm.diagnosisCode}
                      onChange={(e) => handleFormChange('diagnosisCode', e.target.value)}
                      placeholder="e.g., J06.9"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Indication</Label>
                    <Input
                      value={rxForm.indication}
                      onChange={(e) => handleFormChange('indication', e.target.value)}
                      placeholder="e.g., Bacterial infection"
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label>Patient Instructions</Label>
                  <Textarea
                    value={rxForm.patientInstructions}
                    onChange={(e) => handleFormChange('patientInstructions', e.target.value)}
                    placeholder="Additional instructions for the patient..."
                    rows={2}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label>Pharmacy Notes</Label>
                  <Textarea
                    value={rxForm.pharmacyNotes}
                    onChange={(e) => handleFormChange('pharmacyNotes', e.target.value)}
                    placeholder="Notes for the pharmacist..."
                    rows={2}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
          
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { resetForm(); setShowNewRx(false); }}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleCreatePrescription(false)}
              disabled={submitting || !selectedPatient || !rxForm.medicationName}
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Save as Draft
            </Button>
            <Button
              onClick={() => handleCreatePrescription(true)}
              disabled={submitting || !selectedPatient || !rxForm.medicationName || !selectedPharmacy}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
              Sign & Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
