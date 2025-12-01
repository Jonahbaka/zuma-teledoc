'use client';

import { useState, useEffect } from 'react';
import { 
  DollarSign, TrendingUp, TrendingDown, Calendar, 
  BarChart3, PieChart, LineChart, Calculator,
  Download, Filter, RefreshCw
} from 'lucide-react';
import { adminAPI } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import { formatCurrency } from '@/lib/utils';

export default function FinancialToolsPage() {
  const [forecast, setForecast] = useState(null);
  const [accounting, setAccounting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [forecastMonths, setForecastMonths] = useState(12);
  const [dateRange, setDateRange] = useState({
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0]
  });

  useEffect(() => {
    fetchData();
  }, [forecastMonths, dateRange]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [forecastRes, accountingRes] = await Promise.all([
        adminAPI.getForecast({ months: forecastMonths }),
        adminAPI.getAccounting({ startDate: dateRange.startDate, endDate: dateRange.endDate })
      ]);

      if (forecastRes.data.success) {
        setForecast(forecastRes.data.forecast);
      }
      if (accountingRes.data.success) {
        setAccounting(accountingRes.data.accounting);
      }
    } catch (error) {
      console.error('Error fetching financial data:', error);
      toast({
        title: 'Error',
        description: 'Failed to load financial data',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-8">
        <div className="h-8 w-64 bg-gray-200 rounded animate-pulse"></div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-32 bg-gray-200 rounded-xl animate-pulse"></div>
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
          <h1 className="text-3xl font-bold font-serif">Financial Tools</h1>
          <p className="text-gray-600 mt-1">Forecasting, accounting, and financial analytics</p>
        </div>
        <Button onClick={fetchData} variant="outline">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Current Financial Overview */}
      {forecast && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Current MRR</p>
                  <p className="text-2xl font-bold mt-1">{formatCurrency(forecast.current.mrr)}</p>
                  <p className="text-xs text-gray-500 mt-1">Monthly Recurring Revenue</p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center">
                  <DollarSign className="w-6 h-6 text-purple-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Projected ARR</p>
                  <p className="text-2xl font-bold mt-1">{formatCurrency(forecast.current.arr)}</p>
                  <p className="text-xs text-gray-500 mt-1">Annual Recurring Revenue</p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center">
                  <TrendingUp className="w-6 h-6 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Growth Rate</p>
                  <p className="text-2xl font-bold mt-1">{forecast.growthRate}%</p>
                  <p className="text-xs text-gray-500 mt-1">Monthly average</p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
                  <BarChart3 className="w-6 h-6 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Gold Subscriptions</p>
                  <p className="text-2xl font-bold mt-1">{forecast.current.goldSubscriptions}</p>
                  <p className="text-xs text-gray-500 mt-1">Active subscriptions</p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center">
                  <PieChart className="w-6 h-6 text-amber-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Financial Forecast */}
      {forecast && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Financial Forecast</CardTitle>
                <CardDescription>Projected revenue and expenses for the next {forecastMonths} months</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="months" className="text-sm">Months:</Label>
                <Input
                  id="months"
                  type="number"
                  min="3"
                  max="24"
                  value={forecastMonths}
                  onChange={(e) => setForecastMonths(parseInt(e.target.value) || 12)}
                  className="w-20"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-3">Month</th>
                    <th className="text-right p-3">Projected MRR</th>
                    <th className="text-right p-3">Projected Expenses</th>
                    <th className="text-right p-3">Projected Profit</th>
                    <th className="text-right p-3">Projected ARR</th>
                  </tr>
                </thead>
                <tbody>
                  {forecast.monthly.map((month, index) => (
                    <tr key={index} className="border-b hover:bg-gray-50">
                      <td className="p-3 font-medium">{new Date(month.month + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</td>
                      <td className="text-right p-3">{formatCurrency(month.projectedMRR)}</td>
                      <td className="text-right p-3 text-red-600">{formatCurrency(month.projectedExpenses)}</td>
                      <td className="text-right p-3 text-green-600 font-semibold">{formatCurrency(month.projectedProfit)}</td>
                      <td className="text-right p-3">{formatCurrency(month.projectedARR)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Accounting Summary */}
      {accounting && (
        <div className="grid lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Revenue Breakdown</CardTitle>
              <CardDescription>Revenue by payment type</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <span className="font-medium">Total Revenue</span>
                  <span className="text-2xl font-bold text-green-600">{formatCurrency(accounting.revenue.total)}</span>
                </div>
                {accounting.revenue.byType.map((type, index) => (
                  <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                    <div>
                      <p className="font-medium capitalize">{type.paymentType.replace('_', ' ')}</p>
                      <p className="text-sm text-gray-500">{type.count} transactions</p>
                    </div>
                    <span className="text-lg font-semibold">{formatCurrency(type.total)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Expenses & Profitability</CardTitle>
              <CardDescription>Expense breakdown and net income</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="space-y-2">
                  {Object.entries(accounting.expenses.breakdown).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between p-3 border rounded-lg">
                      <span className="font-medium capitalize">{key}</span>
                      <span className="text-red-600">{formatCurrency(value)}</span>
                    </div>
                  ))}
                </div>
                <div className="pt-4 border-t">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium">Total Expenses</span>
                    <span className="text-lg font-semibold text-red-600">{formatCurrency(accounting.expenses.total)}</span>
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium">Net Income</span>
                    <span className={`text-2xl font-bold ${parseFloat(accounting.netIncome) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {formatCurrency(accounting.netIncome)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-500">Profit Margin</span>
                    <span className="text-sm font-semibold">{accounting.profitMargin}%</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Additional Revenue Sources */}
      {forecast?.additionalRevenue && (
        <Card>
          <CardHeader>
            <CardTitle>Additional Revenue Sources</CardTitle>
            <CardDescription>Pay-per-visit and insurance copay revenue</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="p-4 border rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">Pay-per-Visit</span>
                  <span className="text-xl font-bold">{formatCurrency(forecast.additionalRevenue.payPerVisit.monthly)}</span>
                </div>
                <p className="text-sm text-gray-500">{forecast.additionalRevenue.payPerVisit.visits} visits this month</p>
              </div>
              <div className="p-4 border rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">Insurance Copays</span>
                  <span className="text-xl font-bold">{formatCurrency(forecast.additionalRevenue.insurance.monthly)}</span>
                </div>
                <p className="text-sm text-gray-500">{forecast.additionalRevenue.insurance.copays} copays this month</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Date Range Filter for Accounting */}
      <Card>
        <CardHeader>
          <CardTitle>Accounting Period</CardTitle>
          <CardDescription>Select date range for accounting summary</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="space-y-2">
              <Label htmlFor="startDate">Start Date</Label>
              <Input
                id="startDate"
                type="date"
                value={dateRange.startDate}
                onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">End Date</Label>
              <Input
                id="endDate"
                type="date"
                value={dateRange.endDate}
                onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

