'use client';

import { useState } from 'react';
import {
  Megaphone, Plus, Search, Filter, MoreHorizontal, Play, Pause,
  BarChart3, Send, Users, Calendar, Clock, CheckCircle, AlertCircle,
  Eye, Edit, Copy, Trash2, TrendingUp, Mail, Target, Sparkles
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

const MOCK_CAMPAIGNS = [
  {
    id: '1',
    name: 'January Health Newsletter',
    description: 'Monthly health tips and clinic updates',
    type: 'newsletter',
    status: 'completed',
    channels: ['email'],
    recipientCount: 2450,
    sentCount: 2450,
    openedCount: 1048,
    clickedCount: 206,
    scheduledAt: null,
    completedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2)
  },
  {
    id: '2',
    name: 'Flu Shot Reminder Campaign',
    description: 'Remind patients about flu vaccination',
    type: 'campaign',
    status: 'sending',
    channels: ['email'],
    recipientCount: 5200,
    sentCount: 3100,
    openedCount: 890,
    clickedCount: 156,
    scheduledAt: null,
    startedAt: new Date(Date.now() - 1000 * 60 * 60)
  },
  {
    id: '3',
    name: 'Telehealth Services Launch',
    description: 'Announce new telehealth capabilities',
    type: 'announcement',
    status: 'scheduled',
    channels: ['email', 'social'],
    recipientCount: 8500,
    sentCount: 0,
    openedCount: 0,
    clickedCount: 0,
    scheduledAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 3)
  },
  {
    id: '4',
    name: 'Patient Satisfaction Survey',
    description: 'Quarterly feedback collection',
    type: 'campaign',
    status: 'draft',
    channels: ['email'],
    recipientCount: 0,
    sentCount: 0,
    openedCount: 0,
    clickedCount: 0,
    scheduledAt: null
  }
];

const MOCK_SEGMENTS = [
  { id: '1', name: 'All Patients', count: 12450 },
  { id: '2', name: 'Active Patients (90 days)', count: 4560 },
  { id: '3', name: 'Patients with Diabetes', count: 890 },
  { id: '4', name: 'New Patients (30 days)', count: 234 }
];

const statusConfig = {
  draft: { label: 'Draft', color: 'bg-gray-100 text-gray-800', icon: Edit },
  scheduled: { label: 'Scheduled', color: 'bg-blue-100 text-blue-800', icon: Clock },
  sending: { label: 'Sending', color: 'bg-yellow-100 text-yellow-800', icon: Send },
  paused: { label: 'Paused', color: 'bg-orange-100 text-orange-800', icon: Pause },
  completed: { label: 'Completed', color: 'bg-green-100 text-green-800', icon: CheckCircle },
  cancelled: { label: 'Cancelled', color: 'bg-red-100 text-red-800', icon: AlertCircle }
};

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState(MOCK_CAMPAIGNS);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  
  const [newCampaign, setNewCampaign] = useState({
    name: '',
    description: '',
    type: 'campaign',
    subject: '',
    content: '',
    segmentId: ''
  });

  const filteredCampaigns = campaigns.filter(campaign => {
    const matchesSearch = campaign.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || campaign.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const stats = {
    total: campaigns.length,
    active: campaigns.filter(c => c.status === 'sending').length,
    scheduled: campaigns.filter(c => c.status === 'scheduled').length,
    completed: campaigns.filter(c => c.status === 'completed').length
  };

  const handleCreateCampaign = () => {
    if (!newCampaign.name || !newCampaign.subject) {
      toast({
        title: 'Missing fields',
        description: 'Please fill in campaign name and subject',
        variant: 'destructive'
      });
      return;
    }

    const campaign = {
      id: Date.now().toString(),
      ...newCampaign,
      status: 'draft',
      channels: ['email'],
      recipientCount: 0,
      sentCount: 0,
      openedCount: 0,
      clickedCount: 0
    };

    setCampaigns([campaign, ...campaigns]);
    setShowCreateDialog(false);
    setNewCampaign({ name: '', description: '', type: 'campaign', subject: '', content: '', segmentId: '' });
    
    toast({
      title: 'Campaign created',
      description: 'Your campaign has been saved as a draft'
    });
  };

  const getOpenRate = (campaign) => {
    if (campaign.sentCount === 0) return 0;
    return ((campaign.openedCount / campaign.sentCount) * 100).toFixed(1);
  };

  const getClickRate = (campaign) => {
    if (campaign.openedCount === 0) return 0;
    return ((campaign.clickedCount / campaign.openedCount) * 100).toFixed(1);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl">
              <Megaphone className="w-6 h-6 text-white" />
            </div>
            Campaign Manager
          </h1>
          <p className="text-muted-foreground mt-1">Create and manage email marketing campaigns</p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} className="bg-violet-600 hover:bg-violet-700">
          <Plus className="w-4 h-4 mr-2" />
          New Campaign
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Campaigns</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
              <Megaphone className="w-8 h-8 text-violet-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Now</p>
                <p className="text-2xl font-bold">{stats.active}</p>
              </div>
              <Send className="w-8 h-8 text-yellow-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Scheduled</p>
                <p className="text-2xl font-bold">{stats.scheduled}</p>
              </div>
              <Clock className="w-8 h-8 text-blue-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Completed</p>
                <p className="text-2xl font-bold">{stats.completed}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-500 opacity-50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search campaigns..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Tabs value={statusFilter} onValueChange={setStatusFilter}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="draft">Drafts</TabsTrigger>
            <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
            <TabsTrigger value="sending">Active</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Campaign List */}
      <div className="space-y-4">
        {filteredCampaigns.map((campaign) => {
          const StatusIcon = statusConfig[campaign.status].icon;
          return (
            <Card key={campaign.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="text-lg font-semibold">{campaign.name}</h3>
                      <Badge className={cn('font-normal', statusConfig[campaign.status].color)}>
                        <StatusIcon className="w-3 h-3 mr-1" />
                        {statusConfig[campaign.status].label}
                      </Badge>
                      {campaign.channels.map(channel => (
                        <Badge key={channel} variant="outline" className="font-normal">
                          {channel}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{campaign.description}</p>
                    
                    {/* Stats Row */}
                    <div className="flex items-center gap-6 mt-4">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm">{campaign.recipientCount.toLocaleString()} recipients</span>
                      </div>
                      
                      {campaign.status === 'sending' && (
                        <div className="flex items-center gap-2">
                          <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-yellow-500 rounded-full"
                              style={{ width: `${(campaign.sentCount / campaign.recipientCount) * 100}%` }}
                            />
                          </div>
                          <span className="text-sm text-muted-foreground">
                            {Math.round((campaign.sentCount / campaign.recipientCount) * 100)}% sent
                          </span>
                        </div>
                      )}
                      
                      {campaign.status === 'completed' && (
                        <>
                          <div className="flex items-center gap-2">
                            <Eye className="w-4 h-4 text-blue-500" />
                            <span className="text-sm">{getOpenRate(campaign)}% opened</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <TrendingUp className="w-4 h-4 text-green-500" />
                            <span className="text-sm">{getClickRate(campaign)}% clicked</span>
                          </div>
                        </>
                      )}
                      
                      {campaign.scheduledAt && (
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm">
                            {new Date(campaign.scheduledAt).toLocaleDateString()} at{' '}
                            {new Date(campaign.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {campaign.status === 'draft' && (
                      <Button size="sm" variant="outline">
                        <Edit className="w-4 h-4 mr-1" />
                        Edit
                      </Button>
                    )}
                    {campaign.status === 'draft' && (
                      <Button size="sm" className="bg-green-600 hover:bg-green-700">
                        <Play className="w-4 h-4 mr-1" />
                        Send
                      </Button>
                    )}
                    {campaign.status === 'sending' && (
                      <Button size="sm" variant="outline">
                        <Pause className="w-4 h-4 mr-1" />
                        Pause
                      </Button>
                    )}
                    {campaign.status === 'completed' && (
                      <Button size="sm" variant="outline">
                        <BarChart3 className="w-4 h-4 mr-1" />
                        Analytics
                      </Button>
                    )}
                    <Button size="sm" variant="ghost">
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {filteredCampaigns.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center">
              <Megaphone className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold">No campaigns found</h3>
              <p className="text-muted-foreground mt-1">
                {searchQuery ? 'Try a different search term' : 'Create your first campaign to get started'}
              </p>
              <Button onClick={() => setShowCreateDialog(true)} className="mt-4">
                <Plus className="w-4 h-4 mr-2" />
                Create Campaign
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Create Campaign Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create New Campaign</DialogTitle>
            <DialogDescription>
              Set up your email campaign with content and targeting
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Campaign Name</Label>
                <Input
                  placeholder="e.g., Monthly Newsletter"
                  value={newCampaign.name}
                  onChange={(e) => setNewCampaign({ ...newCampaign, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Campaign Type</Label>
                <select
                  value={newCampaign.type}
                  onChange={(e) => setNewCampaign({ ...newCampaign, type: e.target.value })}
                  className="w-full h-10 rounded-md border border-input bg-background px-3"
                >
                  <option value="campaign">Marketing Campaign</option>
                  <option value="newsletter">Newsletter</option>
                  <option value="announcement">Announcement</option>
                </select>
              </div>
            </div>
            
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                placeholder="Brief description of this campaign"
                value={newCampaign.description}
                onChange={(e) => setNewCampaign({ ...newCampaign, description: e.target.value })}
              />
            </div>
            
            <div className="space-y-2">
              <Label>Target Segment</Label>
              <select
                value={newCampaign.segmentId}
                onChange={(e) => setNewCampaign({ ...newCampaign, segmentId: e.target.value })}
                className="w-full h-10 rounded-md border border-input bg-background px-3"
              >
                <option value="">Select a segment</option>
                {MOCK_SEGMENTS.map(segment => (
                  <option key={segment.id} value={segment.id}>
                    {segment.name} ({segment.count.toLocaleString()} recipients)
                  </option>
                ))}
              </select>
            </div>
            
            <div className="space-y-2">
              <Label>Subject Line</Label>
              <Input
                placeholder="Email subject"
                value={newCampaign.subject}
                onChange={(e) => setNewCampaign({ ...newCampaign, subject: e.target.value })}
              />
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Email Content</Label>
                <Button variant="ghost" size="sm" className="text-violet-600">
                  <Sparkles className="w-4 h-4 mr-1" />
                  Generate with AI
                </Button>
              </div>
              <Textarea
                placeholder="Write your email content here..."
                value={newCampaign.content}
                onChange={(e) => setNewCampaign({ ...newCampaign, content: e.target.value })}
                rows={8}
              />
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateCampaign} className="bg-violet-600 hover:bg-violet-700">
              <CheckCircle className="w-4 h-4 mr-2" />
              Create Campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

