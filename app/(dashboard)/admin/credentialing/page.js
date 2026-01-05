'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  Users, Search, Filter, CheckCircle2, XCircle, Clock,
  AlertCircle, ChevronRight, Eye, FileText, Shield,
  Loader2, RefreshCw, MoreVertical, Mail, Download
} from 'lucide-react';
import { adminAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';
import { Progress } from '@/components/ui/progress';

const STATUS_CONFIG = {
  not_started: { label: 'Not Started', color: 'bg-gray-500', textColor: 'text-gray-500' },
  pending_payment: { label: 'Pending Payment', color: 'bg-amber-500', textColor: 'text-amber-500' },
  documents_required: { label: 'Documents Required', color: 'bg-blue-500', textColor: 'text-blue-500' },
  documents_under_review: { label: 'Under Review', color: 'bg-purple-500', textColor: 'text-purple-500' },
  license_verification: { label: 'License Verification', color: 'bg-indigo-500', textColor: 'text-indigo-500' },
  dea_verification: { label: 'DEA Verification', color: 'bg-indigo-500', textColor: 'text-indigo-500' },
  npi_verification: { label: 'NPI Verification', color: 'bg-indigo-500', textColor: 'text-indigo-500' },
  background_check: { label: 'Background Check', color: 'bg-orange-500', textColor: 'text-orange-500' },
  malpractice_verification: { label: 'Malpractice Verification', color: 'bg-indigo-500', textColor: 'text-indigo-500' },
  education_verification: { label: 'Education Verification', color: 'bg-indigo-500', textColor: 'text-indigo-500' },
  references_check: { label: 'References Check', color: 'bg-cyan-500', textColor: 'text-cyan-500' },
  committee_review: { label: 'Committee Review', color: 'bg-pink-500', textColor: 'text-pink-500' },
  approved: { label: 'Approved', color: 'bg-green-500', textColor: 'text-green-500' },
  rejected: { label: 'Rejected', color: 'bg-red-500', textColor: 'text-red-500' },
  suspended: { label: 'Suspended', color: 'bg-red-400', textColor: 'text-red-400' },
  expired: { label: 'Expired', color: 'bg-gray-400', textColor: 'text-gray-400' }
};

function formatDateISO(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  // Deterministic across server/client to avoid hydration mismatch from locale/timezone differences
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

export default function AdminCredentialingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [applications, setApplications] = useState([]);
  const [stats, setStats] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0 });

  useEffect(() => {
    fetchApplications();
    fetchStats();
  }, [statusFilter, pagination.page]);

  const fetchApplications = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/credentialing/admin/all?status=${statusFilter}&page=${pagination.page}&limit=${pagination.limit}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
        }
      });
      const data = await response.json();
      
      if (data.success) {
        setApplications(data.applications);
        setPagination(prev => ({ ...prev, ...data.pagination }));
      }
    } catch (error) {
      console.error('Error fetching applications:', error);
      toast({
        title: 'Error',
        description: 'Failed to load credentialing applications',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/credentialing/admin/stats', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
        }
      });
      const data = await response.json();
      
      if (data.success) {
        setStats(data.stats);
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const getStatusBadge = (status) => {
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.not_started;
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${config.color} bg-opacity-10 ${config.textColor}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${config.color}`}></span>
        {config.label}
      </span>
    );
  };

  const filteredApplications = applications.filter(app => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      app.firstName?.toLowerCase().includes(query) ||
      app.lastName?.toLowerCase().includes(query) ||
      app.email?.toLowerCase().includes(query) ||
      app.specialty?.toLowerCase().includes(query)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-serif text-foreground">Provider Credentialing</h1>
          <p className="text-muted-foreground mt-1">
            Manage and review provider credentialing applications
          </p>
        </div>
        <Button onClick={() => { fetchApplications(); fetchStats(); }}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Total</p>
              <p className="text-2xl font-bold text-foreground">{stats.total}</p>
            </CardContent>
          </Card>
          <Card className="border-amber-500/30">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Pending Payment</p>
              <p className="text-2xl font-bold text-amber-500">{stats.pendingPayment}</p>
            </CardContent>
          </Card>
          <Card className="border-blue-500/30">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Docs Required</p>
              <p className="text-2xl font-bold text-blue-500">{stats.documentsRequired}</p>
            </CardContent>
          </Card>
          <Card className="border-purple-500/30">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Under Review</p>
              <p className="text-2xl font-bold text-purple-500">{stats.underReview}</p>
            </CardContent>
          </Card>
          <Card className="border-green-500/30">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Approved</p>
              <p className="text-2xl font-bold text-green-500">{stats.approved}</p>
            </CardContent>
          </Card>
          <Card className="border-red-500/30">
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">Rejected</p>
              <p className="text-2xl font-bold text-red-500">{stats.rejected}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, or specialty..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {['all', 'documents_under_review', 'committee_review', 'approved', 'rejected'].map((status) => (
            <Button
              key={status}
              variant={statusFilter === status ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(status)}
              className={statusFilter === status ? 'bg-purple-600' : ''}
            >
              {status === 'all' ? 'All' : STATUS_CONFIG[status]?.label || status}
            </Button>
          ))}
        </div>
      </div>

      {/* Applications List */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
            </div>
          ) : filteredApplications.length === 0 ? (
            <div className="text-center py-12">
              <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No applications found</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filteredApplications.map((app) => (
                <div
                  key={app.id}
                  className="p-4 hover:bg-muted/50 transition-colors cursor-pointer"
                  onClick={() => router.push(`/admin/credentialing/${app.providerId}`)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                        <span className="text-lg font-bold text-purple-600">
                          {app.firstName?.[0]}{app.lastName?.[0]}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium text-foreground">
                          {app.legalFirstName || app.firstName} {app.legalLastName || app.lastName}
                        </p>
                        <p className="text-sm text-muted-foreground">{app.email}</p>
                        <p className="text-sm text-muted-foreground">{app.specialty || 'Specialty not specified'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        {getStatusBadge(app.status)}
                        <div className="mt-2 flex items-center gap-2">
                          <Progress value={app.progressPercentage || 0} className="w-24 h-2" />
                          <span className="text-xs text-muted-foreground">{app.progressPercentage || 0}%</span>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-muted-foreground" />
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <FileText className="w-3 h-3" />
                      {app.documentCount || 0} documents
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {app.referenceCount || 0} references
                    </span>
                    {app.applicationSubmittedAt && (
                      <span>
                        Submitted: {formatDateISO(app.applicationSubmittedAt)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {((pagination.page - 1) * pagination.limit) + 1} to {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page === 1}
              onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

