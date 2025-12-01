'use client';

import { useState, useEffect } from 'react';
import { Shield, Upload, CheckCircle, AlertCircle, Crown, Camera, ScanLine, Keyboard, Loader2, Plus, X, FileText, Sparkles, Server } from 'lucide-react';
import { insuranceAPI, subscriptionsAPI } from '@/lib/api';
import { DoctaService } from '@/lib/doctaService';
import { Badge } from '@/components/ui/docta-badge';
import { DoctaButton as Button } from '@/components/ui/docta-button';
import { DoctaCard as Card } from '@/components/ui/docta-card';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/components/providers/AuthProvider';

export default function InsuranceWalletPage() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [hasGoldCard, setHasGoldCard] = useState(false);
  const [activatingGold, setActivatingGold] = useState(false);
  const [manualInsurance, setManualInsurance] = useState(false);
  const [insForm, setInsForm] = useState({ memberId: '', payer: 'BlueCross BlueShield', group: '' });

  useEffect(() => {
    fetchWallet();
    checkGoldCardStatus();
  }, []);

  const checkGoldCardStatus = async () => {
    try {
      const response = await subscriptionsAPI.getMySubscription();
      if (response.data.success && response.data.subscription) {
        const sub = response.data.subscription;
        setHasGoldCard(sub.tier === 'gold_monthly' || sub.tier === 'gold_yearly');
      }
    } catch (error) {
      console.error('Error checking gold card status:', error);
    }
  };

  const handleActivateGold = async (tier = 'gold_monthly') => {
    setActivatingGold(true);
    try {
      const response = await subscriptionsAPI.createSubscription({
        type: tier,
        paymentMethodId: null
      });
      
      if (response.data.success) {
        setHasGoldCard(true);
        toast({
          title: 'Docta Gold Activated!',
          description: 'You now have access to member pricing on prescriptions'
        });
        await checkGoldCardStatus();
      }
    } catch (error) {
      toast({
        title: 'Activation Failed',
        description: error.response?.data?.error || 'Failed to activate Docta Gold',
        variant: 'destructive'
      });
    } finally {
      setActivatingGold(false);
    }
  };

  const fetchWallet = async () => {
    try {
      const response = await insuranceAPI.getWallet();
      if (response.data.success) {
        setWallet(response.data.wallet);
      }
    } catch (error) {
      console.error('Error fetching wallet:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddInsurance = async () => {
    setScanning(true);
    
    let memberId, payerName, planType;

    if (manualInsurance) {
      if (!insForm.memberId) {
        toast({
          title: 'Error',
          description: 'Member ID is required',
          variant: 'destructive'
        });
        setScanning(false);
        return;
      }
      memberId = insForm.memberId;
      payerName = insForm.payer;
      planType = "Manual Entry Plan";
      toast({
        title: 'Verifying Coverage',
        description: 'Checking eligibility with Change Healthcare...'
      });
    } else {
      toast({
        title: 'Scanning...',
        description: 'Processing insurance card image'
      });
      const ocrResult = await DoctaService.ocrScan();
      memberId = ocrResult.data.memberId;
      payerName = ocrResult.data.payerName;
      planType = ocrResult.data.planType;
    }

    const eligResult = await DoctaService.verifyInsuranceReal(memberId, payerName);
    
    toast({
      title: 'Insurance Verified',
      description: `Coverage verified via ${eligResult.verificationSource}`
    });
    
    setScanning(false);
    setManualInsurance(false);
    fetchWallet();
  };

  const patientData = {
    insurance: wallet.length > 0 ? {
      payerName: wallet[0].insurance_provider,
      memberId: wallet[0].policyNumber,
      groupId: wallet[0].group_number || "N/A",
      planType: "PPO Gold",
      eligibility: { verificationSource: "Change Healthcare (ANSI X12 270/271)" }
    } : null,
    hasGoldCard: hasGoldCard
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="flex justify-between items-center mb-8 bg-white/90 p-6 rounded-3xl shadow-sm border border-purple-50">
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-full bg-purple-100 flex items-center justify-center text-purple-800 font-bold text-xl">
            {user?.firstName?.[0] || 'U'}{user?.lastName?.[0] || 'S'}
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{user?.firstName} {user?.lastName}</h2>
            {hasGoldCard && (
              <div className="flex items-center text-amber-600 text-xs font-bold uppercase mt-1">
                <Crown size={12} className="mr-1" /> Gold Member
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="grid md:grid-cols-2 gap-6">
        <Card 
          title="Insurance" 
          action={
            !patientData.insurance && (
              <div className="flex bg-gray-100 rounded-lg p-1">
                <button 
                  onClick={() => setManualInsurance(false)} 
                  className={`px-2 py-1 text-xs rounded-md transition-all ${!manualInsurance ? 'bg-white shadow text-purple-900' : 'text-gray-500'}`}
                >
                  <ScanLine size={14} />
                </button>
                <button 
                  onClick={() => setManualInsurance(true)} 
                  className={`px-2 py-1 text-xs rounded-md transition-all ${manualInsurance ? 'bg-white shadow text-purple-900' : 'text-gray-500'}`}
                >
                  <Keyboard size={14} />
                </button>
              </div>
            )
          }
        >
          {patientData.insurance ? (
            <div className="bg-slate-800 rounded-xl p-6 text-white shadow-lg relative overflow-hidden group">
              <Shield className="absolute right-[-20px] top-[-20px] opacity-10" size={150} />
              <div className="relative z-10">
                <p className="font-bold text-lg">{patientData.insurance.payerName}</p>
                <p className="font-mono mt-4 tracking-widest">{patientData.insurance.memberId}</p>
              </div>
              <div className="absolute bottom-4 right-4">
                <Badge color="green" className="flex items-center text-[10px]">
                  <Server size={10} className="mr-1"/> Verified via Change Healthcare
                </Badge>
              </div>
            </div>
          ) : (
            manualInsurance ? (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-bold text-gray-500">Payer Name</label>
                  <input 
                    type="text" 
                    className="w-full border rounded p-2 text-sm" 
                    value={insForm.payer} 
                    onChange={e => setInsForm({...insForm, payer: e.target.value})} 
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500">Member ID</label>
                  <input 
                    type="text" 
                    className="w-full border rounded p-2 text-sm" 
                    value={insForm.memberId} 
                    onChange={e => setInsForm({...insForm, memberId: e.target.value})} 
                    placeholder="Required" 
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500">Group ID</label>
                  <input 
                    type="text" 
                    className="w-full border rounded p-2 text-sm" 
                    value={insForm.group} 
                    onChange={e => setInsForm({...insForm, group: e.target.value})} 
                  />
                </div>
                <Button 
                  size="sm" 
                  onClick={handleAddInsurance} 
                  disabled={scanning} 
                  className="w-full mt-2"
                >
                  {scanning ? "Verifying..." : "Verify Coverage"}
                </Button>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400 border-2 border-dashed rounded-xl">
                <Upload size={32} className="mx-auto mb-2 text-gray-300"/>
                <p className="text-sm">Scan your card image</p>
                <Button 
                  size="sm" 
                  variant="secondary" 
                  className="mt-4" 
                  onClick={handleAddInsurance} 
                  disabled={scanning}
                >
                  {scanning ? "Scanning..." : "Start Scan"}
                </Button>
              </div>
            )
          )}
        </Card>

        <Card title="Docta Gold">
          {patientData.hasGoldCard ? (
            <div className="bg-gradient-to-br from-yellow-300 to-amber-500 rounded-xl p-6 text-amber-900 shadow-xl">
              <h3 className="font-bold text-xl">Gold Active</h3>
              <p className="text-sm opacity-80">Saving up to 80% on Rx</p>
            </div>
          ) : (
            <Button 
              variant="gold" 
              onClick={() => handleActivateGold('gold_monthly')} 
              className="w-full h-full min-h-[100px]" 
              icon={Crown}
            >
              Activate Gold Membership
            </Button>
          )}
        </Card>
      </div>
    </div>
  );
}

