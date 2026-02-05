'use client';

import Link from 'next/link';
import { ArrowLeft, HelpCircle, Search, BookOpen, MessageSquare, Video, CreditCard, Shield, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ThemeToggle } from '@/components/ui/theme-toggle';

export default function HelpCenterPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-purple-50/30 to-background dark:from-slate-950 dark:via-purple-950/20 dark:to-slate-950">
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>
      <div className="container mx-auto px-6 py-16 max-w-6xl">
        <Link href="/">
          <Button variant="ghost" className="mb-8">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
        </Link>

        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-purple-600 to-indigo-700 flex items-center justify-center shadow-lg shadow-purple-500/25">
              <HelpCircle className="w-9 h-9 text-white" />
            </div>
            <h1 className="text-4xl md:text-5xl font-bold text-foreground font-serif">Help Center</h1>
          </div>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Find answers to common questions and get support
          </p>
        </div>

        {/* Search Bar */}
        <div className="mb-12 max-w-2xl mx-auto">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-muted-foreground w-5 h-5" />
            <Input
              type="search"
              placeholder="Search for help articles..."
              className="pl-12 h-14 text-lg bg-card"
            />
          </div>
        </div>

        {/* Help Categories */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          {[
            { title: 'Getting Started', description: 'Learn how to create an account and book your first appointment', icon: BookOpen, gradient: 'from-purple-500 to-indigo-600' },
            { title: 'Appointments', description: 'How to schedule, reschedule, or cancel appointments', icon: MessageSquare, gradient: 'from-indigo-500 to-purple-600' },
            { title: 'Video Consultations', description: 'Troubleshooting and tips for video visits', icon: Video, gradient: 'from-blue-500 to-indigo-600' },
            { title: 'Billing & Payments', description: 'Understanding charges, subscriptions, and refunds', icon: CreditCard, gradient: 'from-amber-500 to-orange-600' },
            { title: 'Health Records', description: 'Accessing and managing your medical records', icon: Shield, gradient: 'from-rose-500 to-pink-600' },
            { title: 'Account Settings', description: 'Managing your profile, password, and preferences', icon: User, gradient: 'from-purple-500 to-indigo-600' }
          ].map((category, index) => (
            <div
              key={index}
              className="bg-card rounded-xl p-6 shadow-md hover:shadow-lg transition-shadow cursor-pointer border border-border hover:border-primary/30"
            >
              <div className={`w-12 h-12 rounded-lg bg-gradient-to-br ${category.gradient} flex items-center justify-center mb-4 shadow-lg`}>
                <category.icon className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-2">{category.title}</h3>
              <p className="text-muted-foreground text-sm">{category.description}</p>
            </div>
          ))}
        </div>

        {/* Contact Support */}
        <div className="bg-card rounded-2xl shadow-lg p-8 text-center border border-border">
          <h2 className="text-2xl font-bold text-foreground mb-4">Still need help?</h2>
          <p className="text-muted-foreground mb-6">
            Our support team is here to assist you. Email us at{' '}
            <a href="mailto:info@doctarx.com" className="text-purple-600 hover:underline font-medium">
              info@doctarx.com
            </a>
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/contact">
              <Button className="bg-gradient-to-r from-purple-600 to-indigo-700 hover:from-purple-700 hover:to-indigo-800 text-white shadow-lg shadow-purple-500/25">
                Contact Support
              </Button>
            </Link>
            <Link href="/faq">
              <Button variant="outline">
                View FAQs
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
