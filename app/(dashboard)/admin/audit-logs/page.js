'use client';

import { useState, useEffect } from 'react';
import { 
  Shield, Search, Filter, Download, Eye, FileText,
  ChevronLeft, ChevronRight, AlertTriangle, Clock
} from 'lucide-react';
import { adminAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/utils';

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1 });
  const [filters, setFilters] = useState({
    action: '',
    resourceType: '',
    phiOnly: false,
    startDate: '',
    endDate: ''
  });

  useEffect(() => {
    fetchLogs();
  }, [pagination.page, filters]);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const params = {
        page: pagination.page,
        limit: 50,
        ...filters
      };
      
      // Remove empty params
      Object.keys(params).forEach(key => {
        if (params[key] === '' || params[key] === false) delete params[key];
      });

      const response = await adminAPI.getAuditLogs(params);
      if (response.data.success) {
        setLogs(response.data.auditLogs);
        setPagination(prev => ({
          ...prev,
          totalPages: response.data.pagination.totalPages,
          total: response.data.pagination.total
        }));
      }
    } catch (error) {
      console.error('Error fetching audit logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const getActionColor = (action) => {
    switch (action) {
      case 'create': return 'success';
      case 'update': return 'info';
      case 'delete': return 'destructive';
      case 'login': return 'default';
      case 'logout': return 'secondary';
      case 'access_phi': return 'warning';
      case 'export': return 'default';
      default: return 'outline';
    }
  };

  const exportLogs = () => {
    // In production, this would call an API to generate a CSV/PDF
    const csvContent = logs.map(log => 
      `${log.createdAt},${log.userName},${log.action},${log.resourceType},${log.success},${log.phiAccessed}`
    ).join('\n');
    
    const blob = new Blob([`Timestamp,User,Action,Resource,Success,PHI Accessed\n${csvContent}`], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-logs-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-serif flex items-center gap-2">
            <Shield className="w-6 h-6 text-purple-700" />
            HIPAA Audit Logs
          </h1>
          <p className="text-gray-600">Track all system activity and PHI access</p>
        </div>
        <Button onClick={exportLogs} variant="outline">
          <Download className="w-4 h-4 mr-2" />
          Export Logs
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Total Events</p>
                <p className="text-2xl font-bold">{pagination.total || 0}</p>
              </div>
              <FileText className="w-8 h-8 text-gray-400" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">PHI Access</p>
                <p className="text-2xl font-bold text-amber-600">
                  {logs.filter(l => l.phiAccessed).length}
                </p>
              </div>
              <Eye className="w-8 h-8 text-amber-400" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Failed Actions</p>
                <p className="text-2xl font-bold text-red-600">
                  {logs.filter(l => !l.success).length}
                </p>
              </div>
              <AlertTriangle className="w-8 h-8 text-red-400" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Today</p>
                <p className="text-2xl font-bold">
                  {logs.filter(l => new Date(l.createdAt).toDateString() === new Date().toDateString()).length}
                </p>
              </div>
              <Clock className="w-8 h-8 text-blue-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4">
            <select
              value={filters.action}
              onChange={(e) => setFilters({ ...filters, action: e.target.value })}
              className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="">All Actions</option>
              <option value="create">Create</option>
              <option value="read">Read</option>
              <option value="update">Update</option>
              <option value="delete">Delete</option>
              <option value="login">Login</option>
              <option value="logout">Logout</option>
              <option value="access_phi">PHI Access</option>
              <option value="export">Export</option>
            </select>

            <select
              value={filters.resourceType}
              onChange={(e) => setFilters({ ...filters, resourceType: e.target.value })}
              className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="">All Resources</option>
              <option value="user">Users</option>
              <option value="appointment">Appointments</option>
              <option value="medical_record">Medical Records</option>
              <option value="visit">Visits</option>
              <option value="message">Messages</option>
              <option value="session">Sessions</option>
            </select>

            <label className="flex items-center gap-2 px-3 py-2 border rounded-lg cursor-pointer hover:bg-gray-50">
              <input
                type="checkbox"
                checked={filters.phiOnly}
                onChange={(e) => setFilters({ ...filters, phiOnly: e.target.checked })}
                className="w-4 h-4 text-purple-600"
              />
              <span className="text-sm font-medium">PHI Access Only</span>
            </label>

            <Input
              type="date"
              value={filters.startDate}
              onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
              className="w-40"
              placeholder="Start Date"
            />

            <Input
              type="date"
              value={filters.endDate}
              onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              className="w-40"
              placeholder="End Date"
            />

            <Button 
              variant="outline" 
              onClick={() => setFilters({
                action: '',
                resourceType: '',
                phiOnly: false,
                startDate: '',
                endDate: ''
              })}
            >
              Clear Filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Logs Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8">
              <div className="space-y-4">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="h-12 bg-gray-100 rounded animate-pulse"></div>
                ))}
              </div>
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-12">
              <Shield className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No audit logs found</h3>
              <p className="text-gray-500">Try adjusting your filters</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Timestamp
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      User
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Action
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Resource
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Description
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      PHI
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      IP Address
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y text-sm">
                  {logs.map((log) => (
                    <tr key={log.id} className={`hover:bg-gray-50 ${!log.success ? 'bg-red-50' : ''}`}>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-500">
                        {formatDateTime(log.createdAt)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {log.userName || 'System'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <Badge variant={getActionColor(log.action)}>
                          {log.action.replace('_', ' ').toUpperCase()}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                        {log.resourceType?.replace('_', ' ')}
                      </td>
                      <td className="px-4 py-3 max-w-xs truncate text-gray-600">
                        {log.description}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {log.phiAccessed && (
                          <Badge variant="warning">
                            <Eye className="w-3 h-3 mr-1" />
                            PHI
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {log.success ? (
                          <span className="text-green-600">✓ Success</span>
                        ) : (
                          <span className="text-red-600">✗ Failed</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-500">
                        {log.ipAddress}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="px-6 py-4 border-t flex items-center justify-between">
            <p className="text-sm text-gray-500">
              Page {pagination.page} of {pagination.totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPagination(p => ({ ...p, page: p.page - 1 }))}
                disabled={pagination.page === 1}
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPagination(p => ({ ...p, page: p.page + 1 }))}
                disabled={pagination.page === pagination.totalPages}
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

