'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  UserCheck, UserX, Search, Mail, Phone, MapPin,
  Calendar, FileText, CheckCircle2, XCircle, Clock
} from 'lucide-react';
import { adminAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { formatDateTime } from '@/lib/utils';

export default function ProviderApprovalsPage() {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchPendingProviders();
  }, []);

  const fetchPendingProviders = async () => {
    try {
      setLoading(true);
      const response = await adminAPI.getPendingProviders();
      if (response?.data?.success) {
        setProviders(response.data.providers || []);
      }
    } catch (error) {
      console.error('Error fetching pending providers:', error);
      toast({
        title: 'Error',
        description: 'Failed to load pending providers',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (providerId) => {
    try {
      const response = await adminAPI.updateUserStatus(providerId, { isActive: true, providerStatus: 'approved' });
      if (response?.data?.success) {
        toast({
          title: 'Success',
          description: 'Provider approved successfully'
        });
        fetchPendingProviders();
      }
    } catch (error) {
      console.error('Error approving provider:', error);
      toast({
        title: 'Error',
        description: 'Failed to approve provider',
        variant: 'destructive'
      });
    }
  };

  const handleReject = async (providerId) => {
    try {
      const response = await adminAPI.updateUserStatus(providerId, { isActive: false, providerStatus: 'rejected' });
      if (response?.data?.success) {
        toast({
          title: 'Success',
          description: 'Provider rejected'
        });
        fetchPendingProviders();
      }
    } catch (error) {
      console.error('Error rejecting provider:', error);
      toast({
        title: 'Error',
        description: 'Failed to reject provider',
        variant: 'destructive'
      });
    }
  };

  const filteredProviders = providers.filter(provider => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      provider.firstName?.toLowerCase().includes(query) ||
      provider.lastName?.toLowerCase().includes(query) ||
      provider.email?.toLowerCase().includes(query) ||
      provider.specialty?.toLowerCase().includes(query)
    );
  });

  if (loading) {
    return (
      <div className="space-y-8">
        <div className="h-8 w-64 bg-gray-200 rounded animate-pulse"></div>
        <div className="grid gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-48 bg-gray-200 rounded-xl animate-pulse"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-serif">Provider Approvals</h1>
          <p className="text-gray-600 mt-1">Review and approve provider applications</p>
        </div>
        <Badge variant="outline" className="text-lg px-4 py-2">
          {filteredProviders.length} Pending
        </Badge>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
        <Input
          placeholder="Search by name, email, or specialty..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Providers List */}
      {filteredProviders.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <UserCheck className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-2">No Pending Approvals</h3>
            <p className="text-gray-500">All provider applications have been reviewed.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6">
          {filteredProviders.map((provider) => (
            <Card key={provider.id} className="hover:shadow-lg transition-shadow">
              <CardContent className="p-6">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
                  {/* Provider Info */}
                  <div className="flex-1 space-y-4">
                    <div className="flex items-start gap-4">
                      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center text-white text-xl font-bold">
                        {provider.firstName?.[0]}{provider.lastName?.[0]}
                      </div>
                      <div className="flex-1">
                        <h3 className="text-xl font-semibold">
                          {provider.firstName} {provider.lastName}
                        </h3>
                        <p className="text-gray-500">{provider.email}</p>
                        {provider.specialty && (
                          <Badge className="mt-2" variant="secondary">
                            {provider.specialty}
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4 text-sm">
                      {provider.phone && (
                        <div className="flex items-center gap-2 text-gray-600">
                          <Phone className="w-4 h-4" />
                          <span>{provider.phone}</span>
                        </div>
                      )}
                      {provider.location && (
                        <div className="flex items-center gap-2 text-gray-600">
                          <MapPin className="w-4 h-4" />
                          <span>{provider.location}</span>
                        </div>
                      )}
                      {provider.licenseNumber && (
                        <div className="flex items-center gap-2 text-gray-600">
                          <FileText className="w-4 h-4" />
                          <span>License: {provider.licenseNumber}</span>
                        </div>
                      )}
                      {provider.createdAt && (
                        <div className="flex items-center gap-2 text-gray-600">
                          <Calendar className="w-4 h-4" />
                          <span>Applied: {formatDateTime(provider.createdAt)}</span>
                        </div>
                      )}
                    </div>

                    {provider.bio && (
                      <p className="text-sm text-gray-600 line-clamp-2">{provider.bio}</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-3 md:w-48">
                    <Button
                      onClick={() => handleApprove(provider.id)}
                      className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700"
                    >
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      Approve
                    </Button>
                    <Button
                      onClick={() => handleReject(provider.id)}
                      variant="destructive"
                      className="w-full"
                    >
                      <XCircle className="w-4 h-4 mr-2" />
                      Reject
                    </Button>
                    <Link href={`/admin/users/${provider.id}`} className="w-full">
                      <Button variant="outline" className="w-full">
                        View Details
                      </Button>
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

