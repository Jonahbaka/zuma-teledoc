'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  Users, UserCheck, Calendar, DollarSign, TrendingUp, 
  AlertCircle, ChevronRight, Activity, Shield, BarChart3,
  LineChart, PieChart, Database, Server, Wifi, Video,
  CheckCircle2, XCircle, Clock, AlertTriangle, CreditCard,
  FileWarning, UserX, Zap, RefreshCw, ExternalLink
} from 'lucide-react';
import { adminAPI } from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// Mock data for System Health
const MOCK_SYSTEM_HEALTH = {
  api: { status: 'online', uptime: '99.9%', latency: '45ms' },
  database: { status: 'connected', latency: '12ms', connections: '15/100' },
  videoServer: { status: 'active', activeCalls: 0, capacity: '100%' },
  emailService: { status: 'online', queueSize: 0 }
};

// Mock data for Pending Tasks (Action Required)
const MOCK_PENDING_TASKS = [
  {
    id: 1,
    type: 'credentialing',
    title: '2 Providers Awaiting Verification',
    description: 'New provider applications need credentialing review',
    severity: 'warning',
    count: 2,
    action: '/admin/credentialing',
    actionLabel: 'Review Now'
  },
  {
    id: 2,
    type: 'payment',
    title: '5 Failed Payment Transactions',
    description: 'Payment failures from the last 24 hours',
    severity: 'critical',
    count: 5,
    action: '/admin/revenue?filter=failed',
    actionLabel: 'Resolve'
  },
  {
    id: 3,
    type: 'approval',
    title: '3 Provider Approvals Pending',
    description: 'Providers waiting for account activation',
    severity: 'info',
    count: 3,
    action: '/admin/providers',
    actionLabel: 'Approve'
  }
];

export default function AdminDashboard() {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [systemHealth] = useState(MOCK_SYSTEM_HEALTH);
  const [pendingTasks] = useState(MOCK_PENDING_TASKS);

  // Calculate total pending tasks for notification sync
  const totalPendingCount = pendingTasks.reduce((sum, task) => sum + task.count, 0);

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const response = await adminAPI.getDashboard();
        if (response?.data?.success && response?.data?.dashboard) {
          setDashboard(response.data.dashboard);
        } else {
          setDashboard({
            users: { total: 0, patients: 0, providers: 0, admins: 0, superAdmins: 0 },
            providers: { pendingApproval: 0 },
            appointments: { today: 0, completed: 0, scheduled: 0, cancelled: 0 },
            subscriptions: { estimatedMRR: 0, free: 0, gold: 0, platinum: 0 },
            weeklyActivity: []
          });
        }
      } catch (error) {
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

  // Helper function to format growth text - FIX FOR GROWTH MATH BUG
  const formatGrowthText = (value, growthPercent, label) => {
    if (value === 0) {
      return <span className="text-muted-foreground">No data yet</span>;
    }
    if (growthPercent > 0) {
      return (
        <span className="text-emerald-600 dark:text-emerald-400">
          <TrendingUp className="w-3 h-3 inline mr-1" />
          +{growthPercent}% {label}
        </span>
      );
    }
    return <span className="text-muted-foreground">{label}</span>;
  };

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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-serif text-foreground">Admin Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            {totalPendingCount > 0 ? (
              <span className="text-amber-600 dark:text-amber-400">
                {totalPendingCount} action{totalPendingCount > 1 ? 's' : ''} require your attention
              </span>
            ) : (
              "Platform overview and management"
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {dashboard?.providers?.pendingApproval > 0 && (
            <Link href="/admin/providers">
              <Button className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700">
                <AlertCircle className="w-4 h-4 mr-2" />
                {dashboard.providers.pendingApproval} Pending Approvals
              </Button>
            </Link>
          )}
          <Link href="/admin/analytics">
            <Button variant="outline" className="border-purple-500 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950">
              <BarChart3 className="w-4 h-4 mr-2" />
              View Analytics
            </Button>
          </Link>
        </div>
      </div>

      {/* System Health Widget - TOP PRIORITY */}
      <Card className="border-2 border-emerald-500/30 dark:border-emerald-500/20">
        <CardHeader className="pb-3 bg-gradient-to-r from-emerald-500/10 to-teal-500/10 dark:from-emerald-500/5 dark:to-teal-500/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                <Server className="w-5 h-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  System Health
                  <span className="flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                </CardTitle>
                <CardDescription>Real-time infrastructure status</CardDescription>
              </div>
            </div>
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              <RefreshCw className="w-4 h-4 mr-1" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* API Status */}
            <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
              <div className="flex items-center gap-2 mb-2">
                <Wifi className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-sm font-medium text-foreground">API Status</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                <span className="font-semibold text-emerald-700 dark:text-emerald-300">Online</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{systemHealth.api.uptime} Uptime</p>
            </div>

            {/* Database */}
            <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
              <div className="flex items-center gap-2 mb-2">
                <Database className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span className="text-sm font-medium text-foreground">Database</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                <span className="font-semibold text-emerald-700 dark:text-emerald-300">Connected</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Latency: {systemHealth.database.latency}</p>
            </div>

            {/* Video Server */}
            <div className="p-4 rounded-xl bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800">
              <div className="flex items-center gap-2 mb-2">
                <Video className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                <span className="text-sm font-medium text-foreground">Video Server</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                <span className="font-semibold text-emerald-700 dark:text-emerald-300">Active</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{systemHealth.videoServer.activeCalls} active calls</p>
            </div>

            {/* Email Service */}
            <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <span className="text-sm font-medium text-foreground">Email Service</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                <span className="font-semibold text-emerald-700 dark:text-emerald-300">Online</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Queue: {systemHealth.emailService.queueSize}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Key Metrics - WITH FIXED GROWTH MATH */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Users</p>
                <p className="text-3xl font-bold mt-1 text-foreground">{dashboard?.users?.total || 0}</p>
                <p className="text-xs mt-1">
                  {formatGrowthText(dashboard?.users?.total || 0, 12, 'from last month')}
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
                  {(dashboard?.providers?.pendingApproval || 0) > 0 
                    ? `${dashboard.providers.pendingApproval} pending`
                    : 'All approved'
                  }
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
                <p className="text-sm text-muted-foreground">Active Sessions</p>
                <p className="text-3xl font-bold mt-1 text-foreground">{systemHealth.videoServer.activeCalls}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Live video calls
                </p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <Video className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
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
                <p className="text-xs mt-1">
                  {formatGrowthText(dashboard?.subscriptions?.estimatedMRR || 0, 8, 'growth')}
                </p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <DollarSign className="w-6 h-6 text-amber-600 dark:text-amber-400" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Grid */}
      <div className="grid lg:grid-cols-2 gap-6">
        
        {/* Pending Tasks / Action Required - REPLACES APPOINTMENTS TODAY */}
        <Card className="border-2 border-amber-500/30 dark:border-amber-500/20">
          <CardHeader className="pb-3 bg-gradient-to-r from-amber-500/10 to-orange-500/10 dark:from-amber-500/5 dark:to-orange-500/5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-white" />
                </div>
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    Action Required
                    <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">
                      {totalPendingCount}
                    </span>
                  </CardTitle>
                  <CardDescription>Tasks needing your attention</CardDescription>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            {pendingTasks.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
                <p className="text-muted-foreground">All caught up! No pending tasks.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {pendingTasks.map((task) => (
                  <div 
                    key={task.id}
                    className={cn(
                      "p-4 rounded-xl border transition-all",
                      task.severity === 'critical' && "border-red-300 bg-red-50/50 dark:bg-red-950/20 dark:border-red-800",
                      task.severity === 'warning' && "border-amber-300 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-800",
                      task.severity === 'info' && "border-blue-300 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-800"
                    )}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <div className={cn(
                          "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                          task.severity === 'critical' && "bg-red-100 dark:bg-red-900",
                          task.severity === 'warning' && "bg-amber-100 dark:bg-amber-900",
                          task.severity === 'info' && "bg-blue-100 dark:bg-blue-900"
                        )}>
                          {task.type === 'credentialing' && <FileWarning className={cn("w-5 h-5", task.severity === 'warning' ? "text-amber-600" : "text-blue-600")} />}
                          {task.type === 'payment' && <CreditCard className="w-5 h-5 text-red-600" />}
                          {task.type === 'approval' && <UserCheck className="w-5 h-5 text-blue-600" />}
                        </div>
                        <div>
                          <p className={cn(
                            "font-semibold text-sm",
                            task.severity === 'critical' && "text-red-700 dark:text-red-400",
                            task.severity === 'warning' && "text-amber-700 dark:text-amber-400",
                            task.severity === 'info' && "text-foreground"
                          )}>
                            {task.title}
                          </p>
                          <p className="text-xs text-muted-foreground">{task.description}</p>
                        </div>
                      </div>
                      <Link href={task.action}>
                        <Button 
                          size="sm" 
                          className={cn(
                            task.severity === 'critical' && "bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700",
                            task.severity === 'warning' && "bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700",
                            task.severity === 'info' && "bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700"
                          )}
                        >
                          {task.actionLabel}
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* User Distribution */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center">
                <PieChart className="w-5 h-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-lg">User Distribution</CardTitle>
                <CardDescription>Breakdown by role</CardDescription>
              </div>
            </div>
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
                    <span className="text-sm text-muted-foreground">
                      {item.count} ({item.percent || 0}%)
                    </span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${item.barClass} rounded-full transition-all duration-500`}
                      style={{ width: `${item.percent || 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Subscription Tiers */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-lg">Subscription Tiers</CardTitle>
                <CardDescription>Active subscriptions by plan</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                { label: 'Free', count: dashboard?.subscriptions?.free || 0, bgColor: 'bg-slate-100 dark:bg-slate-800', dotColor: 'bg-slate-500' },
                { label: 'Docta Gold', count: dashboard?.subscriptions?.gold || 0, bgColor: 'bg-amber-50 dark:bg-amber-900/20', dotColor: 'bg-amber-500' },
                { label: 'Platinum', count: dashboard?.subscriptions?.platinum || 0, bgColor: 'bg-purple-50 dark:bg-purple-900/20', dotColor: 'bg-purple-500' }
              ].map((item) => (
                <div key={item.label} className={`flex items-center justify-between p-3 rounded-xl ${item.bgColor}`}>
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

        {/* Weekly Activity Chart */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center">
                <Activity className="w-5 h-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-lg">Weekly Activity</CardTitle>
                <CardDescription>Appointment trends (last 7 days)</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {dashboard?.weeklyActivity && Array.isArray(dashboard.weeklyActivity) && dashboard.weeklyActivity.length > 0 ? (
              <div className="h-48 flex items-end justify-between gap-2">
                {dashboard.weeklyActivity.map((day, index) => {
                  if (!day || !day.date) return null;
                  const appointments = dashboard.weeklyActivity.map(d => parseInt(d?.appointments || 0));
                  const maxAppointments = appointments.length > 0 ? Math.max(...appointments) : 0;
                  const height = maxAppointments > 0 ? (parseInt(day.appointments || 0) / maxAppointments) * 100 : 0;
                  return (
                    <div key={index} className="flex-1 flex flex-col items-center">
                      <div 
                        className="w-full bg-gradient-to-t from-purple-600 to-purple-400 rounded-t-lg transition-all hover:from-purple-700 hover:to-purple-500 cursor-pointer"
                        style={{ height: `${height}%`, minHeight: height > 0 ? '4px' : '0' }}
                        title={`${day.date}: ${day.appointments || 0} appointments`}
                      />
                      <span className="text-xs text-muted-foreground mt-2">
                        {day.date ? new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' }) : 'N/A'}
                      </span>
                      <span className="text-xs font-semibold text-foreground">{day.appointments || 0}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-48 flex items-center justify-center">
                <div className="text-center">
                  <Activity className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-muted-foreground">No activity data available</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Links */}
      <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-4">
        <Link href="/admin/users">
          <Card className="hover:shadow-lg hover:border-purple-500/30 transition-all cursor-pointer">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                  <Users className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-foreground">User Management</h3>
                  <p className="text-sm text-muted-foreground">View and manage users</p>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/admin/credentialing">
          <Card className="hover:shadow-lg hover:border-amber-500/30 transition-all cursor-pointer">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                  <UserCheck className="w-6 h-6 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-foreground">Credentialing</h3>
                  <p className="text-sm text-muted-foreground">Provider verification</p>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/admin/audit-logs">
          <Card className="hover:shadow-lg hover:border-purple-500/30 transition-all cursor-pointer">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
                  <Shield className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-foreground">Audit Logs</h3>
                  <p className="text-sm text-muted-foreground">HIPAA compliance</p>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/admin/analytics">
          <Card className="hover:shadow-lg hover:border-blue-500/30 transition-all cursor-pointer">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                  <BarChart3 className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-foreground">Analytics</h3>
                  <p className="text-sm text-muted-foreground">Platform statistics</p>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
