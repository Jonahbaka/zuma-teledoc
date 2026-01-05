'use client';

import { useState } from 'react';
import {
  Link2, Copy, ExternalLink, Shield, Stethoscope, Heart, Users,
  CheckCircle, AlertTriangle, Lock, Globe, QrCode, Eye, EyeOff,
  Share2, Mail, RefreshCw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';

export default function AccessURLsPage() {
  const [showAdminUrl, setShowAdminUrl] = useState(false);
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://doctarx.com';

  const portals = [
    {
      id: 'patient',
      name: 'Patient Portal',
      description: 'Public access for patients to login and register',
      icon: Heart,
      color: 'from-pink-500 to-rose-600',
      bgColor: 'bg-pink-50',
      textColor: 'text-pink-600',
      urls: {
        login: '/patient/login',
        register: '/patient/register'
      },
      visibility: 'public',
      accessType: 'Open Registration',
      features: [
        'Self-service registration',
        'View appointments',
        'AI symptom checker',
        'Video consultations',
        'Prescription management'
      ]
    },
    {
      id: 'provider',
      name: 'Provider Portal',
      description: 'Invite-only access for healthcare providers',
      icon: Stethoscope,
      color: 'from-blue-500 to-indigo-600',
      bgColor: 'bg-blue-50',
      textColor: 'text-blue-600',
      urls: {
        login: '/provider/login',
        register: '/provider/register?token=INVITE_TOKEN'
      },
      visibility: 'invite-only',
      accessType: 'Invitation Required',
      features: [
        'Patient management',
        'E-prescribing',
        'Video consultations',
        'Triage queue',
        'Medical imaging'
      ]
    },
    {
      id: 'admin',
      name: 'Admin Console',
      description: 'Restricted access for system administrators',
      icon: Shield,
      color: 'from-emerald-500 to-teal-600',
      bgColor: 'bg-emerald-50',
      textColor: 'text-emerald-600',
      urls: {
        login: '/secure/admin'
      },
      visibility: 'restricted',
      accessType: 'Admin Credentials Only',
      features: [
        'User management',
        'Role administration',
        'System configuration',
        'Audit logs',
        'Analytics'
      ],
      sensitive: true
    }
  ];

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text);
    toast({
      title: 'Copied!',
      description: `${label} copied to clipboard`,
    });
  };

  const openInNewTab = (url) => {
    window.open(url, '_blank');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl">
              <Link2 className="w-6 h-6 text-white" />
            </div>
            Access URLs
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage and share portal access links
          </p>
        </div>
      </div>

      {/* Security Notice */}
      <Card className="border-yellow-500/50 bg-yellow-50/50 dark:bg-yellow-950/20">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5" />
            <div>
              <h3 className="font-semibold text-yellow-900 dark:text-yellow-200">Security Best Practices</h3>
              <ul className="text-sm text-yellow-800 dark:text-yellow-300 mt-2 space-y-1">
                <li>• Patient portal URLs can be shared publicly on your website</li>
                <li>• Provider URLs should only be shared via secure invitation emails</li>
                <li>• <strong>Never</strong> share admin URLs publicly - only with authorized personnel</li>
                <li>• Use invite tokens for provider registration, not direct links</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Portal Cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {portals.map((portal) => {
          const PortalIcon = portal.icon;
          const isHidden = portal.sensitive && !showAdminUrl;
          
          return (
            <Card key={portal.id} className={`overflow-hidden ${portal.sensitive ? 'border-red-200 dark:border-red-900' : ''}`}>
              <div className={`h-2 bg-gradient-to-r ${portal.color}`} />
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-xl ${portal.bgColor} flex items-center justify-center`}>
                      <PortalIcon className={`w-6 h-6 ${portal.textColor}`} />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{portal.name}</CardTitle>
                      <Badge 
                        variant="outline" 
                        className={
                          portal.visibility === 'public' 
                            ? 'text-green-600 border-green-300' 
                            : portal.visibility === 'invite-only'
                            ? 'text-blue-600 border-blue-300'
                            : 'text-red-600 border-red-300'
                        }
                      >
                        {portal.visibility === 'public' && <Globe className="w-3 h-3 mr-1" />}
                        {portal.visibility === 'invite-only' && <Mail className="w-3 h-3 mr-1" />}
                        {portal.visibility === 'restricted' && <Lock className="w-3 h-3 mr-1" />}
                        {portal.accessType}
                      </Badge>
                    </div>
                  </div>
                </div>
                <CardDescription className="mt-2">
                  {portal.description}
                </CardDescription>
              </CardHeader>
              
              <CardContent className="space-y-4">
                {/* Features */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase mb-2">Features</p>
                  <div className="flex flex-wrap gap-1">
                    {portal.features.slice(0, 3).map((feature) => (
                      <Badge key={feature} variant="secondary" className="text-xs">
                        {feature}
                      </Badge>
                    ))}
                    {portal.features.length > 3 && (
                      <Badge variant="outline" className="text-xs">
                        +{portal.features.length - 3} more
                      </Badge>
                    )}
                  </div>
                </div>

                {/* URLs */}
                <div className="space-y-3">
                  {Object.entries(portal.urls).map(([type, path]) => {
                    const fullUrl = `${baseUrl}${path}`;
                    const displayUrl = isHidden ? '••••••••••••••••••••' : fullUrl;
                    
                    return (
                      <div key={type}>
                        <p className="text-xs font-medium text-muted-foreground uppercase mb-1">
                          {type === 'login' ? 'Login URL' : 'Registration URL'}
                        </p>
                        <div className="flex items-center gap-2">
                          <Input
                            value={displayUrl}
                            readOnly
                            className={`text-sm font-mono ${isHidden ? 'text-muted-foreground' : ''}`}
                          />
                          {portal.sensitive && (
                            <Button
                              size="icon"
                              variant="outline"
                              onClick={() => setShowAdminUrl(!showAdminUrl)}
                            >
                              {showAdminUrl ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="outline"
                            onClick={() => copyToClipboard(fullUrl, `${portal.name} ${type} URL`)}
                            disabled={isHidden}
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="outline"
                            onClick={() => openInNewTab(fullUrl)}
                            disabled={isHidden}
                          >
                            <ExternalLink className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Actions */}
                <div className="pt-4 border-t flex gap-2">
                  {portal.id === 'patient' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        const shareText = `Join Docta Healthcare!\n\nSign up: ${baseUrl}/patient/register\nLogin: ${baseUrl}/patient/login`;
                        navigator.clipboard.writeText(shareText);
                        toast({
                          title: 'Share Text Copied',
                          description: 'Patient portal links ready to share',
                        });
                      }}
                    >
                      <Share2 className="w-4 h-4 mr-2" />
                      Copy Share Text
                    </Button>
                  )}
                  
                  {portal.id === 'provider' && (
                    <Button
                      size="sm"
                      className="flex-1 bg-blue-600 hover:bg-blue-700"
                      onClick={() => {
                        window.location.href = '/admin/invites';
                      }}
                    >
                      <Mail className="w-4 h-4 mr-2" />
                      Send Invitation
                    </Button>
                  )}
                  
                  {portal.id === 'admin' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        window.location.href = '/admin/roles';
                      }}
                    >
                      <Users className="w-4 h-4 mr-2" />
                      Manage Admins
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Quick Links Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Quick Copy Links</CardTitle>
          <CardDescription>
            Copy all public-facing links for your marketing materials
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="p-4 bg-muted rounded-lg">
              <h4 className="font-medium mb-2">For Website Integration</h4>
              <pre className="text-xs bg-background p-3 rounded border overflow-x-auto">
{`<!-- Patient Portal Links -->
<a href="${baseUrl}/patient/login">Patient Login</a>
<a href="${baseUrl}/patient/register">Patient Sign Up</a>`}
              </pre>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => copyToClipboard(
                  `<a href="${baseUrl}/patient/login">Patient Login</a>\n<a href="${baseUrl}/patient/register">Patient Sign Up</a>`,
                  'HTML code'
                )}
              >
                <Copy className="w-4 h-4 mr-2" />
                Copy HTML
              </Button>
            </div>
            
            <div className="p-4 bg-muted rounded-lg">
              <h4 className="font-medium mb-2">Plain Text Links</h4>
              <div className="text-sm space-y-1 bg-background p-3 rounded border">
                <p>Patient Login: {baseUrl}/patient/login</p>
                <p>Patient Sign Up: {baseUrl}/patient/register</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => copyToClipboard(
                  `Patient Login: ${baseUrl}/patient/login\nPatient Sign Up: ${baseUrl}/patient/register`,
                  'Plain text links'
                )}
              >
                <Copy className="w-4 h-4 mr-2" />
                Copy Text
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Environment Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Environment Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <div>
                <p className="text-sm text-muted-foreground">Base URL</p>
                <p className="font-mono text-sm">{baseUrl}</p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => copyToClipboard(baseUrl, 'Base URL')}
              >
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <div>
                <p className="text-sm text-muted-foreground">Environment</p>
                <p className="font-medium">{baseUrl.includes('localhost') ? 'Development' : 'Production'}</p>
              </div>
              <Badge variant={baseUrl.includes('localhost') ? 'secondary' : 'default'}>
                {baseUrl.includes('localhost') ? 'DEV' : 'PROD'}
              </Badge>
            </div>
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <div>
                <p className="text-sm text-muted-foreground">SSL Status</p>
                <p className="font-medium">{baseUrl.startsWith('https') ? 'Secure' : 'Not Secure'}</p>
              </div>
              <Badge variant={baseUrl.startsWith('https') ? 'default' : 'destructive'}>
                {baseUrl.startsWith('https') ? (
                  <><CheckCircle className="w-3 h-3 mr-1" /> HTTPS</>
                ) : (
                  <><AlertTriangle className="w-3 h-3 mr-1" /> HTTP</>
                )}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

