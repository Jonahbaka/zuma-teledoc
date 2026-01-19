'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Zap, CheckCircle, XCircle, Clock, Loader2, Heart, Stethoscope,
  ArrowRight, Shield, Gift, AlertTriangle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';

export default function TestingAccessPage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token;

  const [loading, setLoading] = useState(true);
  const [linkData, setLinkData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    validateToken();
  }, [token]);

  const validateToken = async () => {
    try {
      setLoading(true);
      const res = await api.post('/testing-links/validate', { token });
      if (res.data.success) {
        setLinkData(res.data);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid or expired link');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-purple-400 mx-auto mb-4" />
          <p className="text-white/80">Validating access link...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-red-900 to-slate-900 p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <XCircle className="w-8 h-8 text-red-600" />
            </div>
            <CardTitle className="text-xl">Access Link Invalid</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-red-50 rounded-lg text-sm text-red-800">
              <p>This testing link may have:</p>
              <ul className="mt-2 space-y-1 ml-4 list-disc">
                <li>Expired</li>
                <li>Reached its usage limit</li>
                <li>Been deactivated by an administrator</li>
              </ul>
            </div>
            <div className="flex flex-col gap-2">
              <Link href="/patient/login">
                <Button variant="outline" className="w-full">
                  <Heart className="w-4 h-4 mr-2" />
                  Patient Login
                </Button>
              </Link>
              <Link href="/provider/login">
                <Button variant="outline" className="w-full">
                  <Stethoscope className="w-4 h-4 mr-2" />
                  Provider Login
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isProvider = linkData?.linkType === 'provider';
  const Icon = isProvider ? Stethoscope : Heart;
  const color = isProvider ? 'blue' : 'pink';
  const gradientFrom = isProvider ? 'from-blue-500' : 'from-pink-500';
  const gradientTo = isProvider ? 'to-indigo-600' : 'to-rose-600';

  return (
    <div className={`min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4`}>
      <div className="max-w-2xl mx-auto pt-8 sm:pt-16">
        {/* Header */}
        <div className="text-center mb-8">
          <div className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${gradientFrom} ${gradientTo} flex items-center justify-center mx-auto mb-6 shadow-xl`}>
            <Zap className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">
            Testing Access Granted
          </h1>
          <p className="text-white/70">
            You have been invited to test the Docta platform
          </p>
        </div>

        {/* Main Card */}
        <Card className="border-2 border-purple-500/30 shadow-2xl">
          <CardHeader className="text-center pb-2">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Icon className={`w-6 h-6 text-${color}-500`} />
              <CardTitle className="text-xl capitalize">{linkData?.linkType} Access</CardTitle>
            </div>
            {linkData?.label && (
              <CardDescription className="text-base">{linkData.label}</CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Benefits */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="p-4 bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl border border-green-200">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                    <Gift className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-green-900">Free Access</p>
                    <p className="text-sm text-green-700">No payment required</p>
                  </div>
                </div>
              </div>
              <div className="p-4 bg-gradient-to-br from-purple-50 to-indigo-50 rounded-xl border border-purple-200">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                    <Shield className="w-5 h-5 text-purple-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-purple-900 capitalize">{linkData?.grantTier} Tier</p>
                    <p className="text-sm text-purple-700">Full feature access</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Info */}
            <div className="flex items-center justify-center gap-4 text-sm">
              <div className="flex items-center gap-1 text-muted-foreground">
                <Clock className="w-4 h-4" />
                <span>
                  Expires {new Date(linkData?.expiresAt).toLocaleDateString()}
                </span>
              </div>
              {linkData?.remainingUses && (
                <Badge variant="outline">
                  {linkData.remainingUses} uses remaining
                </Badge>
              )}
            </div>

            {/* Action Buttons */}
            <div className="space-y-3 pt-4">
              <p className="text-center text-sm text-muted-foreground">
                Choose how you'd like to proceed:
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                <Link href={`/${linkData?.linkType}/register?test_token=${token}`}>
                  <Button 
                    className={`w-full h-14 text-lg bg-gradient-to-r ${gradientFrom} ${gradientTo} hover:opacity-90`}
                  >
                    Create Account
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </Link>
                <Link href={`/${linkData?.linkType}/login?test_token=${token}`}>
                  <Button variant="outline" className="w-full h-14 text-lg">
                    Sign In
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </Link>
              </div>
            </div>

            {/* Notice */}
            <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
                <div className="text-sm text-amber-800">
                  <p className="font-medium">Testing Environment Notice</p>
                  <p className="mt-1">
                    This link provides temporary access for evaluation purposes.
                    Your account will have full {linkData?.grantTier} tier features during the testing period.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center mt-8 text-white/50 text-sm">
          <p>Powered by Docta Healthcare Platform</p>
        </div>
      </div>
    </div>
  );
}
