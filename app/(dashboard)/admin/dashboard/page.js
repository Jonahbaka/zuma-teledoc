'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  Users, UserCheck, Calendar, DollarSign, TrendingUp, 
  AlertCircle, ChevronRight, Activity, Shield, BarChart3,
  LineChart, PieChart, Database
} from 'lucide-react';
import { adminAPI } from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function AdminDashboard() {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const response = await adminAPI.getDashboard();
        if (response?.data?.success && response?.data?.dashboard) {
          setDashboard(response.data.dashboard);
        } else {
          // Set default empty dashboard to prevent errors
          setDashboard({
            users: { total: 0, patients: 0, providers: 0, admins: 0, superAdmins: 0 },
            providers: { pendingApproval: 0 },
            appointments: { today: 0, completed: 0, scheduled: 0, cancelled: 0 },
            subscriptions: { estimatedMRR: 0, free: 0, gold: 0, platinum: 0 },
            weeklyActivity: []
          });
        }
      } catch (error) {
        // Set default empty dashboard on error
        setDashboard({
          users: { total: 0, patients: 0, providers: 0, admins: 0, superAdmins: 0 },
          providers: { pendingApproval: 0 },
          appointments: { today: 0, completed: 0, scheduled: 0, cancelled: 0 },
          subscriptions: { estimatedMRR: 0, free: 0, gold: 0, platinum: 0 },
          weeklyActivity: []
        });
      } finally {
        setLoading(false);
      }
    };

    fetchDashboard();
  }, []);

  if (loading || !dashboard) {
    return (
      <div className="space-y-8">
        <div className="h-8 w-64 bg-muted rounded animate-pulse"></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-32 bg-muted rounded-xl animate-pulse"></div>
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
          <h1 className="text-3xl font-bold font-serif text-foreground">Admin Dashboard</h1>
          <p className="text-muted-foreground mt-1">Platform overview and management</p>
        </div>
        {dashboard?.providers?.pendingApproval > 0 && (
          <Link href="/admin/providers">
            <Button className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700">
              <AlertCircle className="w-4 h-4 mr-2" />
              {dashboard.providers.pendingApproval} Pending Approvals
            </Button>
          </Link>
        )}
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Users</p>
                <p className="text-3xl font-bold mt-1 text-foreground">{dashboard?.users?.total || 0}</p>
                <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                  +12% from last month
                </p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                <Users className="w-6 h-6 text-purple-600 dark:text-purple-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Providers</p>
                <p className="text-3xl font-bold mt-1 text-foreground">{dashboard?.users?.providers || 0}</p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  {dashboard?.providers?.pendingApproval || 0} pending
                </p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <UserCheck className="w-6 h-6 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Appointments Today</p>
                <p className="text-3xl font-bold mt-1 text-foreground">{dashboard?.appointments?.today || 0}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {dashboard?.appointments?.completed || 0} completed
                </p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                <Calendar className="w-6 h-6 text-purple-600 dark:text-purple-400" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Est. MRR</p>
                <p className="text-3xl font-bold mt-1 text-foreground">${dashboard?.subscriptions?.estimatedMRR || 0}</p>
                <p className="text-xs text-purple-600 dark:text-purple-400 mt-1">
                  <TrendingUp className="w-3 h-3 inline mr-1" />
                  +8% growth
                </p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <DollarSign className="w-6 h-6 text-amber-600 dark:text-amber-400" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* User Breakdown & Subscriptions */}
      <div className="grid lg:grid-cols-2 gap-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">User Distribution</CardTitle>
            <CardDescription>Breakdown by role</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                { 
                  label: 'Patients', 
                  count: dashboard?.users?.patients || 0, 
                  barClass: 'bg-purple-500', 
                  percent: dashboard?.users?.total > 0 ? Math.round((dashboard?.users?.patients || 0) / dashboard?.users?.total * 100) : 0 
                },
                { 
                  label: 'Providers', 
                  count: dashboard?.users?.providers || 0, 
                  barClass: 'bg-blue-500', 
                  percent: dashboard?.users?.total > 0 ? Math.round((dashboard?.users?.providers || 0) / dashboard?.users?.total * 100) : 0 
                },
                { 
                  label: 'Admins', 
                  count: (dashboard?.users?.admins || 0) + (dashboard?.users?.superAdmins || 0), 
                  barClass: 'bg-amber-500', 
                  percent: dashboard?.users?.total > 0 ? Math.round(((dashboard?.users?.admins || 0) + (dashboard?.users?.superAdmins || 0)) / dashboard?.users?.total * 100) : 0 
                }
              ].map((item) => (
                <div key={item.label}>
                  <div className="flex justify-between mb-1">
                    <span className="text-sm font-medium text-foreground">{item.label}</span>
                    <span className="text-sm text-muted-foreground">{item.count} ({item.percent}%)</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${item.barClass} rounded-full transition-all duration-500`}
                      style={{ width: `${item.percent}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Subscription Tiers</CardTitle>
            <CardDescription>Active subscriptions by plan</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[
                { label: 'Free', count: dashboard?.subscriptions?.free || 0, bgColor: 'bg-slate-500', dotColor: 'bg-slate-400' },
                { label: 'Docta Gold', count: dashboard?.subscriptions?.gold || 0, bgColor: 'bg-amber-500/20', dotColor: 'bg-amber-500' },
                { label: 'Platinum', count: dashboard?.subscriptions?.platinum || 0, bgColor: 'bg-purple-500/20', dotColor: 'bg-purple-500' }
              ].map((item) => (
                <div key={item.label} className={`flex items-center justify-between p-3 rounded-xl ${item.bgColor} dark:bg-opacity-20`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${item.dotColor}`}></div>
                    <span className="font-medium text-foreground">{item.label}</span>
                  </div>
                  <span className="text-lg font-bold text-foreground">{item.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Weekly Activity Chart */}
      {dashboard?.weeklyActivity && Array.isArray(dashboard.weeklyActivity) && dashboard.weeklyActivity.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Weekly Activity</CardTitle>
            <CardDescription>Appointment trends over the last 7 days</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64 flex items-end justify-between gap-2">
              {dashboard.weeklyActivity.map((day, index) => {
                if (!day || !day.date) return null;
                const appointments = dashboard.weeklyActivity.map(d => parseInt(d?.appointments || 0));
                const maxAppointments = appointments.length > 0 ? Math.max(...appointments) : 0;
                const height = maxAppointments > 0 ? (parseInt(day.appointments || 0) / maxAppointments) * 100 : 0;
                return (
                  <div key={index} className="flex-1 flex flex-col items-center">
                    <div 
                      className="w-full bg-gradient-to-t from-purple-600 to-purple-400 rounded-t-lg transition-all hover:from-purple-700 hover:to-purple-500"
                      style={{ height: `${height}%`, minHeight: height > 0 ? '4px' : '0' }}
                      title={`${day.date}: ${day.appointments || 0} appointments`}
                    />
                    <span className="text-xs text-muted-foreground mt-2">
                      {day.date ? new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' }) : 'N/A'}
                    </span>
                    <span className="text-xs font-semibold text-foreground mt-1">{day.appointments || 0}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Links */}
      <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-4">
        <Link href="/admin/users">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                  <Users className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">User Management</h3>
                  <p className="text-sm text-muted-foreground">View and manage all users</p>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground ml-auto" />
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/admin/credentialing">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                  <UserCheck className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Credentialing</h3>
                  <p className="text-sm text-muted-foreground">Provider verification</p>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground ml-auto" />
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/admin/audit-logs">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                  <Shield className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Audit Logs</h3>
                  <p className="text-sm text-muted-foreground">HIPAA compliance logs</p>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground ml-auto" />
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/admin/analytics">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                  <Activity className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Analytics</h3>
                  <p className="text-sm text-muted-foreground">Platform statistics</p>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground ml-auto" />
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/admin/invites">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
                  <UserCheck className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Invitations</h3>
                  <p className="text-sm text-muted-foreground">Provider & admin invites</p>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground ml-auto" />
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/admin/access-urls">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center">
                  <LineChart className="w-6 h-6 text-teal-600 dark:text-teal-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Access URLs</h3>
                  <p className="text-sm text-muted-foreground">Portal links & sharing</p>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground ml-auto" />
              </div>
            </CardContent>
          </Card>
        </Link>

        {user?.role === 'super_admin' && (
          <Link href="/admin/roles">
            <Card className="hover:shadow-lg transition-shadow cursor-pointer border-2 border-purple-500/30 dark:border-purple-400/30">
              <CardContent className="p-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-600 to-purple-800 flex items-center justify-center">
                    <Database className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">Role Management</h3>
                    <p className="text-sm text-muted-foreground">Manage admin roles</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground ml-auto" />
                </div>
              </CardContent>
            </Card>
          </Link>
        )}

        <Link href="/admin/financial">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <BarChart3 className="w-6 h-6 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Financial Tools</h3>
                  <p className="text-sm text-muted-foreground">Forecasting & accounting</p>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground ml-auto" />
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}

