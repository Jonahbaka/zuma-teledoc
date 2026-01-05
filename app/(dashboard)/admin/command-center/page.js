'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Mail, MessageSquare, Megaphone, Share2, Bot, BarChart3,
  TrendingUp, TrendingDown, Users, Send, Eye, MousePointer,
  ArrowRight, Sparkles, AlertTriangle, Clock, CheckCircle
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const stats = [
  {
    label: 'Unread Messages',
    value: '12',
    change: '+3',
    trend: 'up',
    icon: Mail,
    color: 'from-blue-500 to-cyan-500'
  },
  {
    label: 'Active Campaigns',
    value: '4',
    change: '+1',
    trend: 'up',
    icon: Megaphone,
    color: 'from-violet-500 to-purple-500'
  },
  {
    label: 'Social Posts Scheduled',
    value: '8',
    change: '+5',
    trend: 'up',
    icon: Share2,
    color: 'from-pink-500 to-rose-500'
  },
  {
    label: 'AI Interactions Today',
    value: '47',
    change: '+12',
    trend: 'up',
    icon: Bot,
    color: 'from-emerald-500 to-teal-500'
  }
];

const recentActivities = [
  {
    type: 'email',
    title: 'New urgent message from Sarah Johnson',
    description: 'Regarding medication side effects',
    time: '5 minutes ago',
    priority: 'urgent'
  },
  {
    type: 'campaign',
    title: 'Newsletter campaign sent',
    description: 'January Health Tips - 2,450 recipients',
    time: '1 hour ago',
    priority: 'normal'
  },
  {
    type: 'social',
    title: 'LinkedIn post published',
    description: 'Telehealth services announcement',
    time: '2 hours ago',
    priority: 'normal'
  },
  {
    type: 'ai',
    title: 'HealthBot generated 5 email replies',
    description: 'All drafts ready for review',
    time: '3 hours ago',
    priority: 'normal'
  }
];

const quickActions = [
  {
    title: 'Compose Email',
    description: 'Write a new message',
    href: '/admin/command-center/inbox',
    icon: Mail,
    color: 'bg-blue-500'
  },
  {
    title: 'New Campaign',
    description: 'Create email campaign',
    href: '/admin/command-center/campaigns',
    icon: Megaphone,
    color: 'bg-violet-500'
  },
  {
    title: 'Schedule Post',
    description: 'Plan social content',
    href: '/admin/command-center/social',
    icon: Share2,
    color: 'bg-pink-500'
  },
  {
    title: 'Ask HealthBot',
    description: 'Get AI assistance',
    href: '/admin/command-center/healthbot',
    icon: Sparkles,
    color: 'bg-emerald-500'
  }
];

export default function CommandCenterDashboard() {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Command Center</h1>
        <p className="text-muted-foreground mt-1">
          Manage all your healthcare communications from one place
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, index) => (
          <Card key={index} className="overflow-hidden">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className={cn(
                  'w-12 h-12 rounded-xl bg-gradient-to-br flex items-center justify-center',
                  stat.color
                )}>
                  <stat.icon className="w-6 h-6 text-white" />
                </div>
                <div className={cn(
                  'flex items-center gap-1 text-sm',
                  stat.trend === 'up' ? 'text-green-500' : 'text-red-500'
                )}>
                  {stat.trend === 'up' ? (
                    <TrendingUp className="w-4 h-4" />
                  ) : (
                    <TrendingDown className="w-4 h-4" />
                  )}
                  {stat.change}
                </div>
              </div>
              <div className="mt-4">
                <p className="text-3xl font-bold">{stat.value}</p>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quick Actions */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common tasks at your fingertips</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {quickActions.map((action, index) => (
              <Link key={index} href={action.href}>
                <div className="flex items-center gap-4 p-3 rounded-lg hover:bg-accent transition-colors cursor-pointer">
                  <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', action.color)}>
                    <action.icon className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{action.title}</p>
                    <p className="text-sm text-muted-foreground">{action.description}</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest communications and events</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentActivities.map((activity, index) => (
                <div key={index} className="flex items-start gap-4 p-3 rounded-lg bg-accent/30">
                  <div className={cn(
                    'w-10 h-10 rounded-lg flex items-center justify-center',
                    activity.type === 'email' ? 'bg-blue-100 text-blue-600' :
                    activity.type === 'campaign' ? 'bg-violet-100 text-violet-600' :
                    activity.type === 'social' ? 'bg-pink-100 text-pink-600' :
                    'bg-emerald-100 text-emerald-600'
                  )}>
                    {activity.type === 'email' && <Mail className="w-5 h-5" />}
                    {activity.type === 'campaign' && <Megaphone className="w-5 h-5" />}
                    {activity.type === 'social' && <Share2 className="w-5 h-5" />}
                    {activity.type === 'ai' && <Bot className="w-5 h-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{activity.title}</p>
                      {activity.priority === 'urgent' && (
                        <Badge variant="destructive" className="text-xs">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          Urgent
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{activity.description}</p>
                    <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {activity.time}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Campaign Performance */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Campaign Performance</CardTitle>
          <CardDescription>Email campaign metrics at a glance</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="text-center p-4 rounded-lg bg-accent/30">
              <Send className="w-8 h-8 text-blue-500 mx-auto mb-2" />
              <p className="text-2xl font-bold">12,450</p>
              <p className="text-sm text-muted-foreground">Emails Sent</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-accent/30">
              <CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-2" />
              <p className="text-2xl font-bold">98.2%</p>
              <p className="text-sm text-muted-foreground">Delivery Rate</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-accent/30">
              <Eye className="w-8 h-8 text-violet-500 mx-auto mb-2" />
              <p className="text-2xl font-bold">42.8%</p>
              <p className="text-sm text-muted-foreground">Open Rate</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-accent/30">
              <MousePointer className="w-8 h-8 text-pink-500 mx-auto mb-2" />
              <p className="text-2xl font-bold">8.4%</p>
              <p className="text-sm text-muted-foreground">Click Rate</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

