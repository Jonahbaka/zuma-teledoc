'use client';

import { useState, useEffect } from 'react';
import { FileText, Calendar, Download, Eye, Loader2, Search, Filter } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatDateTime } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';

export default function PatientRecordsPage() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchRecords();
  }, []);

  const fetchRecords = async () => {
    try {
      const response = await api.get(`/medical-records/patient/${'me'}`);
      if (response.data.success) {
        setRecords(response.data.records || []);
      }
    } catch (error) {
      // Try with current user ID from auth
      try {
        const { data: { user } } = await api.get('/auth/me');
        const response = await api.get(`/medical-records/patient/${user.id}`);
        if (response.data.success) {
          setRecords(response.data.records || []);
        }
      } catch (e) {
        toast({
          title: 'Error',
          description: 'Failed to load medical records',
          variant: 'destructive'
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const filteredRecords = records.filter(record => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      record.title?.toLowerCase().includes(query) ||
      record.recordType?.toLowerCase().includes(query) ||
      record.content?.toLowerCase().includes(query)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <FileText className="w-6 h-6 text-purple-500" />
            Health Records
          </h1>
          <p className="text-slate-500 mt-1">View your medical records and documents</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <Input
              placeholder="Search records..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
        </div>
      ) : filteredRecords.length === 0 ? (
        <Card className="py-16">
          <div className="text-center">
            <FileText className="w-16 h-16 text-slate-200 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-slate-700">No Records Found</h3>
            <p className="text-sm text-slate-500 mt-1">
              {searchQuery ? 'No records match your search' : 'Your medical records will appear here'}
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4">
          {filteredRecords.map((record) => (
            <Card key={record.id} className="hover:shadow-lg transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold text-slate-900">{record.title}</h3>
                      <span className="px-2 py-1 bg-slate-100 text-slate-600 text-xs rounded-full capitalize">
                        {record.recordType?.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 mb-3 line-clamp-2">{record.content}</p>
                    <div className="flex items-center gap-4 text-sm text-slate-500">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        {formatDateTime(record.createdAt)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm">
                      <Eye className="w-4 h-4 mr-2" />
                      View
                    </Button>
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



