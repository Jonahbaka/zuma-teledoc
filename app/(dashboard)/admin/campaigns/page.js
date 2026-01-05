'use client';

import { useState, useEffect } from 'react';
import {
  Mail, Plus, Send, FileText, Users, TrendingUp, Megaphone,
  Loader2, Search, RefreshCw, Edit, Trash2, Copy, Eye, Calendar,
  CheckCircle, Clock, AlertTriangle, Rocket, Building2, Heart,
  BarChart3, Target, Sparkles
} from 'lucide-react';
import { adminAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';

// Template categories
const TEMPLATE_CATEGORIES = {
  invitation: { label: 'Invitations', icon: Mail, color: 'bg-blue-500' },
  campaign: { label: 'Campaigns', icon: Megaphone, color: 'bg-purple-500' },
  vc_pitch: { label: 'VC Pitch', icon: Rocket, color: 'bg-green-500' },
  partnership: { label: 'Partnership', icon: Building2, color: 'bg-orange-500' },
  welcome: { label: 'Welcome', icon: Heart, color: 'bg-pink-500' },
  announcement: { label: 'Announcements', icon: Megaphone, color: 'bg-indigo-500' }
};

// Pre-built templates
const DEFAULT_TEMPLATES = [
  {
    id: 'provider-invite',
    name: 'Provider Invitation',
    category: 'invitation',
    subject: 'You\'re invited to join Docta Healthcare Platform',
    preview: 'Invitation to join as a healthcare provider...',
    body: `Dear {{firstName}},

You have been invited to join Docta as a healthcare provider. Docta is a modern telehealth platform that enables you to provide exceptional care to patients remotely.

{{personalMessage}}

Click the link below to complete your registration:
{{inviteLink}}

This invitation expires on {{expiresAt}}.

Best regards,
The Docta Team`
  },
  {
    id: 'admin-invite',
    name: 'Admin Invitation',
    category: 'invitation',
    subject: 'Administrative Access - Docta Platform',
    preview: 'Invitation to join as an administrator...',
    body: `Dear {{firstName}},

You have been granted administrative access to the Docta Healthcare Platform.

Click below to set up your account:
{{inviteLink}}

Best regards,
Docta Administration`
  },
  {
    id: 'vc-pitch',
    name: 'VC Pitch Email',
    category: 'vc_pitch',
    subject: 'Docta: AI-First Telehealth Platform - Series A Opportunity',
    preview: 'Investment opportunity in healthcare AI...',
    body: `Dear {{firstName}},

I'm reaching out to introduce Docta, an AI-first telehealth platform that's revolutionizing healthcare delivery.

**Key Metrics:**
• {{activeUsers}}+ active users
• {{monthlyGrowth}}% month-over-month growth
• {{patientSatisfaction}}% patient satisfaction rate
• {{providerEfficiency}}% increase in provider efficiency

**Why Docta:**
- AI-powered triage reduces wait times by 60%
- HIPAA-compliant, enterprise-grade security
- Integrated e-prescribing and pharmacy network
- Real-time video consultations with virtual backgrounds

**Traction:**
We've partnered with {{partnerCount}} healthcare systems and serve {{patientCount}} patients monthly.

I'd love to schedule a 30-minute call to discuss how Docta is positioned to capture the ${'$'}{{marketSize}}B telehealth market.

Would {{suggestedDate}} work for a brief conversation?

Best regards,
{{senderName}}
{{senderTitle}}

P.S. Our deck is attached. Happy to answer any questions!`
  },
  {
    id: 'partnership-outreach',
    name: 'Partnership Outreach',
    category: 'partnership',
    subject: 'Partnership Opportunity: Docta Healthcare Platform',
    preview: 'Strategic partnership proposal...',
    body: `Dear {{firstName}},

I'm reaching out from Docta, a leading telehealth platform, to explore a potential partnership with {{companyName}}.

**What We Offer:**
- White-label telehealth solution
- API integration capabilities
- Dedicated support team
- Revenue sharing opportunities

**Benefits for {{companyName}}:**
- Expand your digital health offerings
- Reduce patient no-show rates
- Increase patient engagement
- Generate new revenue streams

Would you be available for a brief call to discuss how we can work together?

Best regards,
{{senderName}}`
  },
  {
    id: 'product-launch',
    name: 'Product Launch Announcement',
    category: 'announcement',
    subject: '🚀 Introducing {{featureName}} - Now Live on Docta',
    preview: 'Exciting new feature announcement...',
    body: `Hi {{firstName}},

We're thrilled to announce the launch of {{featureName}}!

**What's New:**
{{featureDescription}}

**Key Benefits:**
{{benefitsList}}

**How to Get Started:**
1. Log in to your Docta account
2. Navigate to {{featureLocation}}
3. Start using {{featureName}} today!

Questions? Our support team is here to help.

Best,
The Docta Team`
  },
  {
    id: 'patient-welcome',
    name: 'Patient Welcome Email',
    category: 'welcome',
    subject: 'Welcome to Docta - Your Health Journey Starts Here',
    preview: 'Welcome new patients to the platform...',
    body: `Hi {{firstName}},

Welcome to Docta! We're excited to have you join our community of patients who prioritize their health.

**Getting Started:**

1. **Complete Your Profile**
   Add your medical history and insurance information for seamless appointments.

2. **Find a Provider**
   Browse our network of qualified healthcare providers.

3. **Book Your First Appointment**
   Schedule a video visit at your convenience.

4. **Download Our App**
   Get Docta on iOS and Android for easy access.

**Need Help?**
Visit our Help Center or contact support@doctarx.com.

Here's to your health! 🏥

The Docta Team`
  }
];

export default function AdminCampaignsPage() {
  const [activeTab, setActiveTab] = useState('templates');
  const [templates, setTemplates] = useState(DEFAULT_TEMPLATES);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Template form
  const [templateForm, setTemplateForm] = useState({
    name: '',
    category: 'campaign',
    subject: '',
    body: ''
  });

  // Campaign form
  const [campaignForm, setCampaignForm] = useState({
    name: '',
    templateId: '',
    recipients: '',
    scheduledAt: '',
    variables: {}
  });

  // Stats
  const stats = {
    totalTemplates: templates.length,
    totalCampaigns: campaigns.length,
    emailsSent: 0,
    openRate: 0
  };

  const handleCreateTemplate = async () => {
    if (!templateForm.name || !templateForm.subject || !templateForm.body) {
      toast({
        title: 'Missing Fields',
        description: 'Please fill in all required fields',
        variant: 'destructive'
      });
      return;
    }

    setSubmitting(true);
    try {
      // In real implementation, save to backend
      const newTemplate = {
        id: `custom-${Date.now()}`,
        ...templateForm,
        preview: templateForm.body.substring(0, 50) + '...'
      };
      
      setTemplates(prev => [...prev, newTemplate]);
      toast({
        title: 'Template Created',
        description: 'Email template has been saved',
      });
      setShowTemplateModal(false);
      setTemplateForm({
        name: '',
        category: 'campaign',
        subject: '',
        body: ''
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to create template',
        variant: 'destructive'
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDuplicateTemplate = (template) => {
    const duplicated = {
      ...template,
      id: `${template.id}-copy-${Date.now()}`,
      name: `${template.name} (Copy)`
    };
    setTemplates(prev => [...prev, duplicated]);
    toast({
      title: 'Template Duplicated',
      description: 'Template has been copied',
    });
  };

  const handleDeleteTemplate = (templateId) => {
    if (!confirm('Are you sure you want to delete this template?')) return;
    setTemplates(prev => prev.filter(t => t.id !== templateId));
    toast({
      title: 'Template Deleted',
      description: 'Template has been removed',
    });
  };

  const handlePreviewTemplate = (template) => {
    setSelectedTemplate(template);
  };

  const handleCreateCampaign = async () => {
    if (!campaignForm.name || !campaignForm.templateId) {
      toast({
        title: 'Missing Fields',
        description: 'Please fill in campaign name and select a template',
        variant: 'destructive'
      });
      return;
    }

    setSubmitting(true);
    try {
      const newCampaign = {
        id: `campaign-${Date.now()}`,
        ...campaignForm,
        status: campaignForm.scheduledAt ? 'scheduled' : 'draft',
        createdAt: new Date().toISOString(),
        stats: { sent: 0, opened: 0, clicked: 0 }
      };
      
      setCampaigns(prev => [...prev, newCampaign]);
      toast({
        title: 'Campaign Created',
        description: campaignForm.scheduledAt ? 'Campaign has been scheduled' : 'Campaign saved as draft',
      });
      setShowCampaignModal(false);
      setCampaignForm({
        name: '',
        templateId: '',
        recipients: '',
        scheduledAt: '',
        variables: {}
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to create campaign',
        variant: 'destructive'
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl">
              <Megaphone className="w-6 h-6 text-white" />
            </div>
            Email Campaigns
          </h1>
          <p className="text-muted-foreground mt-1">Manage email templates and marketing campaigns</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Templates</p>
                <p className="text-2xl font-bold">{stats.totalTemplates}</p>
              </div>
              <FileText className="w-8 h-8 text-purple-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Campaigns</p>
                <p className="text-2xl font-bold">{stats.totalCampaigns}</p>
              </div>
              <Megaphone className="w-8 h-8 text-blue-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Emails Sent</p>
                <p className="text-2xl font-bold">{stats.emailsSent}</p>
              </div>
              <Send className="w-8 h-8 text-green-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Open Rate</p>
                <p className="text-2xl font-bold">{stats.openRate}%</p>
              </div>
              <BarChart3 className="w-8 h-8 text-orange-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="templates">
              <FileText className="w-4 h-4 mr-2" />
              Templates
            </TabsTrigger>
            <TabsTrigger value="campaigns">
              <Megaphone className="w-4 h-4 mr-2" />
              Campaigns
            </TabsTrigger>
          </TabsList>
          
          <div className="flex gap-2">
            {activeTab === 'templates' && (
              <Button onClick={() => setShowTemplateModal(true)} className="bg-purple-600 hover:bg-purple-700">
                <Plus className="w-4 h-4 mr-2" />
                New Template
              </Button>
            )}
            {activeTab === 'campaigns' && (
              <Button onClick={() => setShowCampaignModal(true)} className="bg-blue-600 hover:bg-blue-700">
                <Plus className="w-4 h-4 mr-2" />
                New Campaign
              </Button>
            )}
          </div>
        </div>

        {/* Templates Tab */}
        <TabsContent value="templates" className="mt-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {templates.map((template) => {
              const category = TEMPLATE_CATEGORIES[template.category] || TEMPLATE_CATEGORIES.campaign;
              const CategoryIcon = category.icon;
              
              return (
                <Card key={template.id} className="hover:shadow-lg transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-8 h-8 rounded-lg ${category.color} flex items-center justify-center`}>
                          <CategoryIcon className="w-4 h-4 text-white" />
                        </div>
                        <div>
                          <CardTitle className="text-base">{template.name}</CardTitle>
                          <Badge variant="outline" className="text-xs mt-1">
                            {category.label}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm font-medium text-foreground mb-2">
                      {template.subject}
                    </p>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {template.preview}
                    </p>
                  </CardContent>
                  <CardFooter className="border-t pt-4 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handlePreviewTemplate(template)}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDuplicateTemplate(template)}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setTemplateForm(template);
                        setShowTemplateModal(true);
                      }}
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    {template.id.startsWith('custom-') && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleDeleteTemplate(template.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* Campaigns Tab */}
        <TabsContent value="campaigns" className="mt-6">
          {campaigns.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Megaphone className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold">No Campaigns Yet</h3>
                <p className="text-muted-foreground mt-1">
                  Create your first campaign to start reaching your audience
                </p>
                <Button onClick={() => setShowCampaignModal(true)} className="mt-4">
                  <Plus className="w-4 h-4 mr-2" />
                  Create Campaign
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {campaigns.map((campaign) => (
                <Card key={campaign.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                          <Megaphone className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                          <h3 className="font-medium">{campaign.name}</h3>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant={campaign.status === 'sent' ? 'default' : 'secondary'}>
                              {campaign.status}
                            </Badge>
                            {campaign.scheduledAt && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {new Date(campaign.scheduledAt).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-sm font-medium">{campaign.stats?.sent || 0} sent</p>
                          <p className="text-xs text-muted-foreground">
                            {campaign.stats?.opened || 0} opened
                          </p>
                        </div>
                        <Button size="sm" variant="outline">
                          <Edit className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Template Preview Modal */}
      <Dialog open={!!selectedTemplate} onOpenChange={() => setSelectedTemplate(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedTemplate?.name}</DialogTitle>
            <DialogDescription>
              Subject: {selectedTemplate?.subject}
            </DialogDescription>
          </DialogHeader>
          <div className="bg-muted rounded-lg p-6">
            <pre className="whitespace-pre-wrap text-sm font-mono">
              {selectedTemplate?.body}
            </pre>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedTemplate(null)}>
              Close
            </Button>
            <Button onClick={() => {
              setCampaignForm(prev => ({ ...prev, templateId: selectedTemplate.id }));
              setSelectedTemplate(null);
              setShowCampaignModal(true);
            }}>
              <Send className="w-4 h-4 mr-2" />
              Use This Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create/Edit Template Modal */}
      <Dialog open={showTemplateModal} onOpenChange={setShowTemplateModal}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {templateForm.id ? 'Edit Template' : 'Create Template'}
            </DialogTitle>
            <DialogDescription>
              Create reusable email templates for invitations and campaigns
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Template Name</Label>
                <Input
                  value={templateForm.name}
                  onChange={(e) => setTemplateForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="My Email Template"
                />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <select
                  value={templateForm.category}
                  onChange={(e) => setTemplateForm(prev => ({ ...prev, category: e.target.value }))}
                  className="w-full h-10 rounded-md border border-input bg-background px-3"
                >
                  {Object.entries(TEMPLATE_CATEGORIES).map(([key, cat]) => (
                    <option key={key} value={key}>{cat.label}</option>
                  ))}
                </select>
              </div>
            </div>
            
            <div className="space-y-2">
              <Label>Subject Line</Label>
              <Input
                value={templateForm.subject}
                onChange={(e) => setTemplateForm(prev => ({ ...prev, subject: e.target.value }))}
                placeholder="Your email subject"
              />
            </div>
            
            <div className="space-y-2">
              <Label>Email Body</Label>
              <Textarea
                value={templateForm.body}
                onChange={(e) => setTemplateForm(prev => ({ ...prev, body: e.target.value }))}
                placeholder="Write your email content here. Use {{variableName}} for dynamic content."
                rows={12}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Available variables: {`{{firstName}}, {{lastName}}, {{email}}, {{inviteLink}}, {{companyName}}`}
              </p>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTemplateModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateTemplate}
              disabled={submitting}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <CheckCircle className="w-4 h-4 mr-2" />
              )}
              Save Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Campaign Modal */}
      <Dialog open={showCampaignModal} onOpenChange={setShowCampaignModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Campaign</DialogTitle>
            <DialogDescription>
              Set up a new email campaign
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Campaign Name</Label>
              <Input
                value={campaignForm.name}
                onChange={(e) => setCampaignForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Q1 Provider Outreach"
              />
            </div>
            
            <div className="space-y-2">
              <Label>Email Template</Label>
              <select
                value={campaignForm.templateId}
                onChange={(e) => setCampaignForm(prev => ({ ...prev, templateId: e.target.value }))}
                className="w-full h-10 rounded-md border border-input bg-background px-3"
              >
                <option value="">Select a template</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            
            <div className="space-y-2">
              <Label>Recipients</Label>
              <Textarea
                value={campaignForm.recipients}
                onChange={(e) => setCampaignForm(prev => ({ ...prev, recipients: e.target.value }))}
                placeholder="Enter email addresses (one per line) or paste a CSV"
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                Enter emails separated by newlines or commas
              </p>
            </div>
            
            <div className="space-y-2">
              <Label>Schedule (Optional)</Label>
              <Input
                type="datetime-local"
                value={campaignForm.scheduledAt}
                onChange={(e) => setCampaignForm(prev => ({ ...prev, scheduledAt: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to save as draft
              </p>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCampaignModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateCampaign}
              disabled={submitting}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : campaignForm.scheduledAt ? (
                <Calendar className="w-4 h-4 mr-2" />
              ) : (
                <CheckCircle className="w-4 h-4 mr-2" />
              )}
              {campaignForm.scheduledAt ? 'Schedule Campaign' : 'Save Draft'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

