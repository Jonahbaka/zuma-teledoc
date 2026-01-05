'use client';

import { useState, useEffect } from 'react';
import {
  Pill, RefreshCw, Clock, CheckCircle, AlertCircle,
  Loader2, Calendar, Building2, User, Phone,
  FileText, Repeat, Info
} from 'lucide-react';
import { prescriptionAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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

const STATUS_DESCRIPTIONS = {
  draft: 'Your provider is preparing this prescription',
  pending: 'Awaiting provider signature',
  sent: 'Sent to pharmacy - waiting to be filled',
  filled: 'Ready for pickup or delivered',
  cancelled: 'This prescription has been cancelled',
  expired: 'This prescription has expired',
  refill_requested: 'Refill request sent to your provider'
};

export default function PatientPrescriptionsPage() {
  const [prescriptions, setPrescriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRx, setSelectedRx] = useState(null);
  const [requestingRefill, setRequestingRefill] = useState(null);
  
  // Load prescriptions
  const loadPrescriptions = async () => {
    setLoading(true);
    try {
      const response = await prescriptionAPI.getAll();
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
  };
  
  useEffect(() => {
    loadPrescriptions();
  }, []);
  
  // Request refill
  const handleRequestRefill = async (rx) => {
    setRequestingRefill(rx.id);
    try {
      await prescriptionAPI.requestRefill(rx.id);
      
      toast({
        title: 'Refill Requested',
        description: `Your refill request for ${rx.medicationName} has been sent to your provider.`,
        variant: 'success'
      });
      
      loadPrescriptions();
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to request refill',
        variant: 'destructive'
      });
    } finally {
      setRequestingRefill(null);
    }
  };
  
  // Check if refill is available
  const canRequestRefill = (rx) => {
    if (rx.status !== 'filled') return false;
    if (rx.refillsAllowed <= 0) return false;
    if (rx.refillsUsed >= rx.refillsAllowed) return false;
    return true;
  };
  
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    );
  }
  
  // Group prescriptions by status
  const activePrescriptions = prescriptions.filter(rx => 
    ['sent', 'filled', 'refill_requested'].includes(rx.status)
  );
  const pendingPrescriptions = prescriptions.filter(rx => 
    ['draft', 'pending'].includes(rx.status)
  );
  const inactivePrescriptions = prescriptions.filter(rx => 
    ['cancelled', 'expired'].includes(rx.status)
  );
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl">
              <Pill className="w-6 h-6 text-white" />
            </div>
            My Prescriptions
          </h1>
          <p className="text-muted-foreground mt-1">View and manage your prescriptions</p>
        </div>
        
        <Button variant="outline" onClick={loadPrescriptions} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
      
      {prescriptions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Pill className="w-16 h-16 text-muted-foreground mx-auto mb-4 opacity-50" />
            <h3 className="text-xl font-semibold">No Prescriptions</h3>
            <p className="text-muted-foreground mt-2 max-w-md mx-auto">
              You don't have any prescriptions yet. Your provider will send prescriptions here after your visits.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {/* Active Prescriptions */}
          {activePrescriptions.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-500" />
                Active Prescriptions ({activePrescriptions.length})
              </h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {activePrescriptions.map((rx) => (
                  <Card key={rx.id} className="hover:shadow-lg transition-shadow border-l-4 border-l-green-500">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-lg">{rx.medicationName}</CardTitle>
                          <CardDescription>
                            {rx.dosageStrength} {rx.dosageForm}
                          </CardDescription>
                        </div>
                        <Badge className={STATUS_COLORS[rx.status]}>
                          {rx.status === 'refill_requested' ? 'Refill Pending' : rx.status}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-sm text-muted-foreground">
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
                          <p className="font-medium">
                            {rx.refillsUsed || 0}/{rx.refillsAllowed || 0}
                          </p>
                        </div>
                      </div>
                      
                      {rx.pharmacy && (
                        <div className="p-3 bg-accent rounded-lg">
                          <p className="text-xs text-muted-foreground uppercase font-medium mb-1">Pharmacy</p>
                          <p className="font-medium text-sm">{rx.pharmacy.name}</p>
                          <p className="text-xs text-muted-foreground">{rx.pharmacy.address}</p>
                          {rx.pharmacy.phone && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                              <Phone className="w-3 h-3" />
                              {rx.pharmacy.phone}
                            </p>
                          )}
                        </div>
                      )}
                      
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <User className="w-4 h-4" />
                        <span>Dr. {rx.providerFirstName} {rx.providerLastName}</span>
                      </div>
                    </CardContent>
                    <CardFooter className="border-t pt-4 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedRx(rx)}
                        className="flex-1"
                      >
                        <Info className="w-4 h-4 mr-1" />
                        Details
                      </Button>
                      {canRequestRefill(rx) && (
                        <Button
                          size="sm"
                          onClick={() => handleRequestRefill(rx)}
                          disabled={requestingRefill === rx.id}
                          className="flex-1 bg-purple-600 hover:bg-purple-700"
                        >
                          {requestingRefill === rx.id ? (
                            <Loader2 className="w-4 h-4 animate-spin mr-1" />
                          ) : (
                            <Repeat className="w-4 h-4 mr-1" />
                          )}
                          Request Refill
                        </Button>
                      )}
                      {rx.status === 'refill_requested' && (
                        <Badge variant="secondary" className="flex-1 justify-center">
                          <Clock className="w-3 h-3 mr-1" />
                          Refill Pending
                        </Badge>
                      )}
                    </CardFooter>
                  </Card>
                ))}
              </div>
            </div>
          )}
          
          {/* Pending Prescriptions */}
          {pendingPrescriptions.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Clock className="w-5 h-5 text-yellow-500" />
                Pending ({pendingPrescriptions.length})
              </h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {pendingPrescriptions.map((rx) => (
                  <Card key={rx.id} className="hover:shadow-lg transition-shadow border-l-4 border-l-yellow-500">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-lg">{rx.medicationName}</CardTitle>
                          <CardDescription>
                            {rx.dosageStrength} {rx.dosageForm}
                          </CardDescription>
                        </div>
                        <Badge className={STATUS_COLORS[rx.status]}>
                          {rx.status}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="p-3 bg-yellow-50 dark:bg-yellow-950 rounded-lg text-sm">
                        <p className="text-yellow-800 dark:text-yellow-200">
                          {STATUS_DESCRIPTIONS[rx.status]}
                        </p>
                      </div>
                      
                      <p className="text-sm text-muted-foreground">
                        {rx.sigDirections}
                      </p>
                      
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <User className="w-4 h-4" />
                        <span>Dr. {rx.providerFirstName} {rx.providerLastName}</span>
                      </div>
                      
                      <div className="text-xs text-muted-foreground">
                        Created {format(new Date(rx.createdAt), 'MMM d, yyyy')}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
          
          {/* Inactive Prescriptions */}
          {inactivePrescriptions.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-muted-foreground">
                <AlertCircle className="w-5 h-5" />
                Past Prescriptions ({inactivePrescriptions.length})
              </h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {inactivePrescriptions.map((rx) => (
                  <Card key={rx.id} className="opacity-75 hover:opacity-100 transition-opacity">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-lg">{rx.medicationName}</CardTitle>
                          <CardDescription>
                            {rx.dosageStrength} {rx.dosageForm}
                          </CardDescription>
                        </div>
                        <Badge className={STATUS_COLORS[rx.status]}>
                          {rx.status}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <p className="text-sm text-muted-foreground">
                        {rx.sigDirections}
                      </p>
                      <div className="text-xs text-muted-foreground">
                        {format(new Date(rx.createdAt), 'MMM d, yyyy')}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Prescription Details Dialog */}
      <Dialog open={!!selectedRx} onOpenChange={() => setSelectedRx(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pill className="w-5 h-5 text-purple-500" />
              Prescription Details
            </DialogTitle>
            <DialogDescription>
              {selectedRx?.medicationName} {selectedRx?.dosageStrength}
            </DialogDescription>
          </DialogHeader>
          
          {selectedRx && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-medium">Medication</p>
                  <p className="font-medium">{selectedRx.medicationName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-medium">Status</p>
                  <Badge className={STATUS_COLORS[selectedRx.status]}>
                    {selectedRx.status}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-medium">Strength</p>
                  <p>{selectedRx.dosageStrength}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-medium">Form</p>
                  <p>{selectedRx.dosageForm}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-medium">Quantity</p>
                  <p>{selectedRx.quantity}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-medium">Days Supply</p>
                  <p>{selectedRx.daysSupply}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-medium">Refills</p>
                  <p>{selectedRx.refillsUsed || 0} of {selectedRx.refillsAllowed || 0} used</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-medium">Prescribed</p>
                  <p>{format(new Date(selectedRx.createdAt), 'MMM d, yyyy')}</p>
                </div>
              </div>
              
              <div>
                <p className="text-xs text-muted-foreground uppercase font-medium">Directions</p>
                <p className="mt-1 p-3 bg-accent rounded-lg">{selectedRx.sigDirections}</p>
              </div>
              
              {selectedRx.patientInstructions && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase font-medium">Additional Instructions</p>
                  <p className="mt-1">{selectedRx.patientInstructions}</p>
                </div>
              )}
              
              <div className="border-t pt-4">
                <p className="text-xs text-muted-foreground uppercase font-medium mb-2">Prescriber</p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                    <User className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="font-medium">Dr. {selectedRx.providerFirstName} {selectedRx.providerLastName}</p>
                    <p className="text-sm text-muted-foreground">{selectedRx.providerSpecialty || 'Provider'}</p>
                  </div>
                </div>
              </div>
              
              {selectedRx.pharmacy && (
                <div className="border-t pt-4">
                  <p className="text-xs text-muted-foreground uppercase font-medium mb-2">Pharmacy</p>
                  <div className="p-3 bg-accent rounded-lg">
                    <p className="font-medium">{selectedRx.pharmacy.name}</p>
                    <p className="text-sm text-muted-foreground">{selectedRx.pharmacy.address}</p>
                    {selectedRx.pharmacy.phone && (
                      <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                        <Phone className="w-3 h-3" />
                        {selectedRx.pharmacy.phone}
                      </p>
                    )}
                  </div>
                </div>
              )}
              
              {canRequestRefill(selectedRx) && (
                <div className="pt-4">
                  <Button
                    onClick={() => {
                      handleRequestRefill(selectedRx);
                      setSelectedRx(null);
                    }}
                    disabled={requestingRefill === selectedRx.id}
                    className="w-full bg-purple-600 hover:bg-purple-700"
                  >
                    {requestingRefill === selectedRx.id ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Repeat className="w-4 h-4 mr-2" />
                    )}
                    Request Refill
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

