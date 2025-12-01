'use client';

import { useState, useEffect } from 'react';
import { 
  BarChart3, TrendingUp, TrendingDown, Users, Calendar,
  DollarSign, Activity, PieChart, LineChart, Filter,
  CheckCircle2, XCircle, Clock
} from 'lucide-react';
import { adminAPI } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatCurrency } from '@/lib/utils';

export default function AnalyticsPage() {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0]
  });

  useEffect(() => {
    fetchAnalytics();
  }, [dateRange]);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      const response = await adminAPI.getAppointmentAnalytics({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate
      });
      if (response?.data?.success) {
        setAnalytics(response.data.analytics);
      }
    } catch (error) {
      console.error('Error fetching analytics:', error);
      setAnalytics({
        totalAppointments: 0,
        completed: 0,
        cancelled: 0,
        noShow: 0,
        averageDuration: 0,
        peakHours: [],
        byDay: [],
        byStatus: []
      });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-8">
        <div className="h-8 w-64 bg-gray-200 rounded animate-pulse"></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-32 bg-gray-200 rounded-xl animate-pulse"></div>
          ))}
        </div>
      </div>
    );
  }

  const data = analytics || {
    totalAppointments: 0,
    completed: 0,
    cancelled: 0,
    noShow: 0,
    averageDuration: 0,
    peakHours: [],
    byDay: [],
    byStatus: []
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-serif">Analytics</h1>
          <p className="text-gray-600 mt-1">Platform statistics and insights</p>
        </div>
        <div className="flex gap-3">
          <div>
            <Label htmlFor="startDate" className="text-xs">Start Date</Label>
            <Input
              id="startDate"
              type="date"
              value={dateRange.startDate}
              onChange={(e) => setDateRange(prev => ({ ...prev, startDate: e.target.value }))}
              className="w-40"
            />
          </div>
          <div>
            <Label htmlFor="endDate" className="text-xs">End Date</Label>
            <Input
              id="endDate"
              type="date"
              value={dateRange.endDate}
              onChange={(e) => setDateRange(prev => ({ ...prev, endDate: e.target.value }))}
              className="w-40"
            />
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Total Appointments</p>
                <p className="text-3xl font-bold mt-1">{data.totalAppointments || 0}</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center">
                <Calendar className="w-6 h-6 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Completed</p>
                <p className="text-3xl font-bold mt-1 text-green-600">{data.completed || 0}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {data.totalAppointments > 0 
                    ? Math.round((data.completed / data.totalAppointments) * 100) 
                    : 0}% completion rate
                </p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Cancelled</p>
                <p className="text-3xl font-bold mt-1 text-red-600">{data.cancelled || 0}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {data.totalAppointments > 0 
                    ? Math.round((data.cancelled / data.totalAppointments) * 100) 
                    : 0}% cancellation rate
                </p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center">
                <XCircle className="w-6 h-6 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Avg Duration</p>
                <p className="text-3xl font-bold mt-1">{Math.round(data.averageDuration || 0)}</p>
                <p className="text-xs text-gray-500 mt-1">minutes</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
                <Clock className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Appointments by Day</CardTitle>
            <CardDescription>Daily appointment volume</CardDescription>
          </CardHeader>
          <CardContent>
            {data.byDay && data.byDay.length > 0 ? (
              <div className="h-64 flex items-end justify-between gap-2">
                {data.byDay.map((day, index) => {
                  const max = Math.max(...data.byDay.map(d => d.count || 0));
                  const height = max > 0 ? ((day.count || 0) / max) * 100 : 0;
                  return (
                    <div key={index} className="flex-1 flex flex-col items-center">
                      <div 
                        className="w-full bg-gradient-to-t from-purple-600 to-purple-400 rounded-t-lg"
                        style={{ height: `${height}%`, minHeight: height > 0 ? '4px' : '0' }}
                      />
                      <span className="text-xs text-gray-500 mt-2">{day.day}</span>
                      <span className="text-xs font-semibold mt-1">{day.count || 0}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-gray-400">
                No data available
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Status Distribution</CardTitle>
            <CardDescription>Appointments by status</CardDescription>
          </CardHeader>
          <CardContent>
            {data.byStatus && data.byStatus.length > 0 ? (
              <div className="space-y-4">
                {data.byStatus.map((status, index) => {
                  const total = data.byStatus.reduce((sum, s) => sum + (s.count || 0), 0);
                  const percent = total > 0 ? Math.round((status.count / total) * 100) : 0;
                  return (
                    <div key={index}>
                      <div className="flex justify-between mb-1">
                        <span className="text-sm font-medium capitalize">{status.status}</span>
                        <span className="text-sm text-gray-500">{status.count} ({percent}%)</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-purple-500 rounded-full"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-gray-400">
                No data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

