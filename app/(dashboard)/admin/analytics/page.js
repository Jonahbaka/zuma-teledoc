'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  BarChart3, TrendingUp, Users, Calendar, Clock, Zap, Globe
} from 'lucide-react';
import { adminAPI } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function RealtimeChart({ points = [] }) {
  const max = Math.max(1, ...points.map(p => p.activeUsers || 0));
  return (
    <div className="h-48 rounded-lg border bg-black/80 p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-gray-400">Active users per minute</p>
        <span className="text-[10px] text-blue-400">REALTIME</span>
      </div>
      <div className="flex h-32 items-end gap-1">
        {points.map((p, i) => {
          const h = Math.max(4, Math.round(((p.activeUsers || 0) / max) * 100));
          return (
            <div key={`${p.minuteOffset}-${i}`} className="group relative flex-1">
              <div className="w-full rounded-sm bg-blue-500/80 transition-all group-hover:bg-blue-400" style={{ height: `${h}%` }} />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-gray-500">
        <span>-30m</span>
        <span>-15m</span>
        <span>Now</span>
      </div>
    </div>
  );
}

const COUNTRY_COORDS = {
  'United States': { x: 22, y: 37 },
  Canada: { x: 18, y: 27 },
  Mexico: { x: 19, y: 46 },
  Brazil: { x: 32, y: 67 },
  Argentina: { x: 31, y: 82 },
  'United Kingdom': { x: 49, y: 30 },
  Germany: { x: 52, y: 33 },
  France: { x: 50, y: 35 },
  Spain: { x: 48, y: 40 },
  Nigeria: { x: 53, y: 58 },
  'South Africa': { x: 54, y: 80 },
  India: { x: 66, y: 50 },
  Japan: { x: 81, y: 42 },
  Indonesia: { x: 75, y: 64 },
  Australia: { x: 83, y: 78 },
  Unknown: { x: 50, y: 50 }
};

function WorldHeatmap({ countries = [] }) {
  const maxUsers = Math.max(1, ...countries.map(c => c.activeUsers || 0));
  const plotted = countries.slice(0, 15).map((c, idx) => ({
    ...c,
    ...(COUNTRY_COORDS[c.country] || COUNTRY_COORDS.Unknown),
    id: `${c.country}-${idx}`,
    intensity: (c.activeUsers || 0) / maxUsers
  }));

  return (
    <div className="rounded-lg border bg-[#0b0f14] p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-gray-400">Live audience heatmap</p>
        <span className="text-[10px] text-blue-400">{plotted.length} locations</span>
      </div>
      <div className="relative h-52 w-full overflow-hidden rounded border border-white/10 bg-[#090d12]">
        <svg viewBox="0 0 1000 520" className="absolute inset-0 h-full w-full">
          <rect x="0" y="0" width="1000" height="520" fill="#090d12" />
          <path d="M83 176l84-47 61 13 63-27 130-8 80 17 87-20 75 16 69 54-56 26-74-10-65 40-86 19-98-12-70 36-70-8-63 24-57-22-68-7-42-43z" fill="#111827" stroke="#374151" strokeWidth="2" opacity=".9" />
          <path d="M266 250l77-22 88 14 58 37-20 49-82 22-78-20-55-49z" fill="#111827" stroke="#374151" strokeWidth="2" opacity=".85" />
          <path d="M488 252l82-19 61 17 18 50-24 55-47 31-53-11-38-51z" fill="#111827" stroke="#374151" strokeWidth="2" opacity=".85" />
          <path d="M626 239l118-15 66 35-17 53-68 28-69-31-42-34z" fill="#111827" stroke="#374151" strokeWidth="2" opacity=".85" />
          <path d="M742 349l67-11 53 32-22 41-67 7-44-33z" fill="#111827" stroke="#374151" strokeWidth="2" opacity=".85" />
        </svg>
        {plotted.map((point) => {
          const size = 8 + Math.round(point.intensity * 14);
          return (
            <div
              key={point.id}
              className="group absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${point.x}%`, top: `${point.y}%` }}
            >
              <div
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500/30 blur-sm"
                style={{ width: `${size * 2}px`, height: `${size * 2}px` }}
              />
              <div
                className="rounded-full border border-blue-300/80 bg-blue-500"
                style={{ width: `${size}px`, height: `${size}px` }}
              />
              <div className="pointer-events-none absolute left-3 top-1 hidden whitespace-nowrap rounded border bg-black/90 px-2 py-1 text-[10px] text-white group-hover:block">
                {point.country}: {point.activeUsers}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  const [analytics, setAnalytics] = useState({ daily: [] });
  const [realtime, setRealtime] = useState(null);
  const [loadingRealtime, setLoadingRealtime] = useState(true);
  const [loadingHistorical, setLoadingHistorical] = useState(true);
  const [growthLogs, setGrowthLogs] = useState([]);
  const [dateRange, setDateRange] = useState({
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0]
  });
  const growthCooldownRef = useRef(0);

  useEffect(() => {
    const fetchHistorical = async () => {
      try {
        setLoadingHistorical(true);
        const response = await adminAPI.getAppointmentAnalytics({
          startDate: dateRange.startDate,
          endDate: dateRange.endDate
        });
        if (response?.data?.success) {
          setAnalytics(response.data.analytics);
        }
      } catch (error) {
        console.error('Error fetching analytics:', error);
        setAnalytics({ daily: [] });
      } finally {
        setLoadingHistorical(false);
      }
    };

    fetchHistorical();
  }, [dateRange.endDate, dateRange.startDate]);

  useEffect(() => {
    let mounted = true;
    const fetchRealtime = async () => {
      try {
        if (mounted) setLoadingRealtime(true);
        const response = await adminAPI.getRealtimeOverview();
        if (response?.data?.success && mounted) {
          setRealtime(response.data.data);
        }
      } catch (error) {
        console.error('Error fetching realtime analytics:', error);
      } finally {
        if (mounted) setLoadingRealtime(false);
      }
    };
    fetchRealtime();
    const poll = setInterval(fetchRealtime, 5000);
    return () => {
      mounted = false;
      clearInterval(poll);
    };
  }, []);

  useEffect(() => {
    const activeUsers = realtime?.activeUsers30m || 0;
    const now = Date.now();
    const lowTraffic = activeUsers < 5;
    const cooldownElapsed = now - growthCooldownRef.current > 60 * 1000;
    if (!lowTraffic || !cooldownElapsed) return;

    growthCooldownRef.current = now;
    adminAPI.runRealtimeGrowthAction()
      .then((res) => {
        const action = res?.data?.data?.action;
        if (action) {
          setGrowthLogs(prev => [...prev.slice(-9), { at: action.at, text: action.action }]);
        }
      })
      .catch(() => {});
  }, [realtime?.activeUsers30m]);

  if (loadingRealtime && loadingHistorical) {
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

  const trafficSeries = realtime?.trafficSeries || [];
  const topSources = realtime?.sources || [];
  const topPages = realtime?.pages || [];
  const topCountries = realtime?.topCountries || [];
  const dailyData = analytics?.daily || [];
  const totalAppointments = dailyData.reduce((sum, d) => sum + Number(d.total || 0), 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-serif">Realtime Analytics</h1>
          <p className="text-gray-600 mt-1">
            Compact live traffic + autonomous growth response
            <span className="ml-2 text-xs uppercase tracking-wide text-blue-600">
              source: {realtime?.provider === 'ga4' ? 'ga4 realtime' : 'internal realtime'}
            </span>
          </p>
        </div>
        <div className="flex items-end gap-3">
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

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-gray-500">Active users (30m)</p>
                <p className="text-3xl font-bold mt-1">{realtime?.activeUsers30m || 0}</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
                <Users className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Active users (5m)</p>
                <p className="text-3xl font-bold mt-1 text-green-600">{realtime?.activeUsers5m || 0}</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-green-100 flex items-center justify-center">
                <ActivityIcon className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Users per minute</p>
                <p className="text-3xl font-bold mt-1 text-purple-600">{realtime?.activeUsersPerMinute || 0}</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">GrowthBot</p>
                <p className="text-lg font-bold mt-1">{realtime?.growthBot?.status || 'Monitoring'}</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center">
                <Zap className="w-6 h-6 text-emerald-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Realtime overview</CardTitle>
            <CardDescription>This report uses 100% of available live data</CardDescription>
          </CardHeader>
          <CardContent>
            <RealtimeChart points={trafficSeries} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">GrowthBot Agent</CardTitle>
            <CardDescription>Connected to orchestrator growth missions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg border bg-black/90 p-3 text-xs text-emerald-400">
              {realtime?.growthBot?.status || 'Monitoring traffic...'}
            </div>
            <Button
              onClick={async () => {
                const response = await adminAPI.runRealtimeGrowthAction();
                const action = response?.data?.data?.action;
                if (action) {
                  setGrowthLogs(prev => [...prev.slice(-9), { at: action.at, text: action.action }]);
                }
              }}
              className="w-full"
            >
              Trigger Growth Action
            </Button>
            <div className="space-y-2 max-h-40 overflow-auto text-xs">
              {growthLogs.length === 0 ? (
                <p className="text-gray-500">No growth actions yet.</p>
              ) : (
                growthLogs.slice().reverse().map((log, idx) => (
                  <div key={`${log.at}-${idx}`} className="rounded border p-2">
                    <p className="font-medium">{log.text}</p>
                    <p className="text-gray-500">{new Date(log.at).toLocaleTimeString()}</p>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Active users by source</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {topSources.length > 0 ? topSources.map((s, idx) => (
              <div key={`${s.source}-${idx}`}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="truncate">{s.source}</span>
                  <span>{s.activeUsers}</span>
                </div>
                <div className="h-2 w-full rounded bg-gray-100">
                  <div className="h-full rounded bg-blue-500" style={{ width: `${Math.min(100, s.share || 0)}%` }} />
                </div>
              </div>
            )) : <p className="text-sm text-gray-500">No source data yet.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Views by page</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {topPages.length > 0 ? topPages.map((p, idx) => (
              <div key={`${p.path}-${idx}`} className="rounded border p-2">
                <p className="text-sm font-medium truncate">{p.title}</p>
                <p className="text-xs text-gray-500">{p.path}</p>
                <p className="text-xs mt-1">{p.views} views</p>
              </div>
            )) : <p className="text-sm text-gray-500">No page data yet.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Audience map (top countries)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <WorldHeatmap countries={topCountries} />
            {topCountries.length > 0 ? topCountries.map((c, idx) => (
              <div key={`${c.country}-${idx}`} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2"><Globe className="w-4 h-4 text-gray-500" /> {c.country}</span>
                <span>{c.activeUsers}</span>
              </div>
            )) : <p className="text-sm text-gray-500">No geo data yet.</p>}
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Historical appointments</CardTitle>
            <CardDescription>Selected date range summary</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-gray-500">Total appointments</p>
                <p className="text-2xl font-bold">{totalAppointments}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-gray-500">Days with activity</p>
                <p className="text-2xl font-bold">{dailyData.length}</p>
              </div>
            </div>
            {!loadingHistorical && dailyData.length === 0 && (
              <p className="text-sm text-gray-500 mt-4">No historical data in selected range.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">How it works</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-gray-600">
            <p>- Every route change sends a realtime beacon to internal analytics.</p>
            <p>- Dashboard polls every 5 seconds for last 30-minute activity.</p>
            <p>- GrowthBot auto-triggers mission actions when traffic drops below threshold.</p>
            <p>- Uses GA4 realtime feed when credentials are configured; falls back to internal feed.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ActivityIcon(props) {
  return <BarChart3 {...props} />;
}

