'use client';

import { useState, useEffect } from 'react';
import { 
  DollarSign, TrendingUp, TrendingDown, BarChart3, 
  PieChart, LineChart, Calendar, Download, RefreshCw
} from 'lucide-react';
import { adminAPI } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { formatCurrency } from '@/lib/utils';

export default function RevenuePage() {
  const [revenue, setRevenue] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRevenue();
  }, []);

  const fetchRevenue = async () => {
    try {
      setLoading(true);
      const response = await adminAPI.getRevenueAnalytics();
      if (response?.data?.success) {
        setRevenue(response.data.revenue);
      }
    } catch (error) {
      console.error('Error fetching revenue:', error);
      toast({
        title: 'Error',
        description: 'Failed to load revenue data',
        variant: 'destructive'
      });
      setRevenue({
        totalRevenue: 0,
        monthlyRevenue: 0,
        yearlyRevenue: 0,
        byPlan: [],
        byMonth: [],
        growth: 0
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

  const raw = revenue || {};
  const data = {
    totalRevenue: parseFloat(raw.totalRevenue) || 0,
    monthlyRevenue: parseFloat(raw.monthlyRevenue) || parseFloat(raw.mrr) || 0,
    yearlyRevenue: parseFloat(raw.yearlyRevenue) || parseFloat(raw.arr) || 0,
    weeklyRevenue: parseFloat(raw.weeklyRevenue) || 0,
    byPlan: raw.byPlan || raw.byTier || [],
    byMonth: raw.byMonth || raw.monthlyTrend || [],
    growth: parseFloat(raw.growth) || 0,
    payments: raw.payments || {},
    sessions: raw.sessions || {},
    mrr: parseFloat(raw.mrr) || 0,
    arr: parseFloat(raw.arr) || 0,
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-serif">Revenue Analytics</h1>
          <p className="text-gray-600 mt-1">Financial performance and trends</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={fetchRevenue}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Total Revenue</p>
                <p className="text-3xl font-bold mt-1">
                  {formatCurrency((data.totalRevenue || 0) * 100)}
                </p>
                <p className="text-xs text-gray-500 mt-1">All time</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center">
                <DollarSign className="w-6 h-6 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Monthly Revenue</p>
                <p className="text-3xl font-bold mt-1">
                  {formatCurrency((data.monthlyRevenue || 0) * 100)}
                </p>
                <p className="text-xs text-gray-500 mt-1">This month</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
                <Calendar className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Yearly Revenue</p>
                <p className="text-3xl font-bold mt-1">
                  {formatCurrency((data.yearlyRevenue || 0) * 100)}
                </p>
                <p className="text-xs text-gray-500 mt-1">This year</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center">
                <BarChart3 className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Growth</p>
                <p className={`text-3xl font-bold mt-1 ${(data.growth || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {(data.growth || 0) >= 0 ? '+' : ''}{(data.growth || 0).toFixed(1)}%
                </p>
                <p className="text-xs text-gray-500 mt-1">vs last period</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center">
                {(data.growth || 0) >= 0 ? (
                  <TrendingUp className="w-6 h-6 text-green-600" />
                ) : (
                  <TrendingDown className="w-6 h-6 text-red-600" />
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Revenue by Plan</CardTitle>
            <CardDescription>Revenue breakdown by subscription tier</CardDescription>
          </CardHeader>
          <CardContent>
            {data.byPlan && data.byPlan.length > 0 ? (
              <div className="space-y-4">
                {data.byPlan.map((plan, index) => {
                  const total = data.byPlan.reduce((sum, p) => sum + (p.revenue || 0), 0);
                  const percent = total > 0 ? Math.round((plan.revenue / total) * 100) : 0;
                  return (
                    <div key={index}>
                      <div className="flex justify-between mb-1">
                        <span className="text-sm font-medium">{plan.plan}</span>
                        <span className="text-sm text-gray-500">
                          {formatCurrency((plan.revenue || 0) * 100)} ({percent}%)
                        </span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-gradient-to-r from-purple-500 to-purple-600 rounded-full"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-gray-400">
                No revenue data available
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Monthly Trends</CardTitle>
            <CardDescription>Revenue over the last 12 months</CardDescription>
          </CardHeader>
          <CardContent>
            {data.byMonth && data.byMonth.length > 0 ? (
              <div className="h-64 flex items-end justify-between gap-2">
                {data.byMonth.map((month, index) => {
                  const max = Math.max(...data.byMonth.map(m => m.revenue || 0));
                  const height = max > 0 ? ((month.revenue || 0) / max) * 100 : 0;
                  return (
                    <div key={index} className="flex-1 flex flex-col items-center">
                      <div 
                        className="w-full bg-gradient-to-t from-green-600 to-green-400 rounded-t-lg"
                        style={{ height: `${height}%`, minHeight: height > 0 ? '4px' : '0' }}
                        title={`${month.month}: ${formatCurrency((month.revenue || 0) * 100)}`}
                      />
                      <span className="text-xs text-gray-500 mt-2">
                        {new Date(month.month).toLocaleDateString('en-US', { month: 'short' })}
                      </span>
                      <span className="text-xs font-semibold mt-1">
                        {formatCurrency((month.revenue || 0) * 100)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-gray-400">
                No revenue data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

