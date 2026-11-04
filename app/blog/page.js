'use client';

import Link from 'next/link';
import { ArrowLeft, Calendar, User, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

const blogPosts = [
  {
    id: 1,
    title: 'The Future of Telehealth: What to Expect in 2025',
    excerpt: 'Explore the latest trends and innovations shaping the telehealth industry this year.',
    author: 'Dr. Sarah Johnson',
    date: 'January 15, 2025',
    category: 'Industry News'
  },
  {
    id: 2,
    title: 'How to Prepare for Your First Virtual Appointment',
    excerpt: 'A comprehensive guide to help you get the most out of your telehealth visit.',
    author: 'DoctaRx Team',
    date: 'January 10, 2025',
    category: 'Patient Resources'
  },
  {
    id: 3,
    title: 'Understanding HIPAA Compliance in Telehealth',
    excerpt: 'Learn how we protect your health information and maintain HIPAA compliance.',
    author: 'Legal Team',
    date: 'January 5, 2025',
    category: 'Security & Privacy'
  },
  {
    id: 4,
    title: 'Mental Health Support Through Telehealth',
    excerpt: 'Discover how virtual therapy and counseling can improve access to mental healthcare.',
    author: 'Dr. Michael Chen',
    date: 'December 28, 2024',
    category: 'Healthcare'
  },
  {
    id: 5,
    title: 'Managing Chronic Conditions with Telehealth',
    excerpt: 'How regular virtual check-ins can help you better manage chronic health conditions.',
    author: 'Dr. Emily Rodriguez',
    date: 'December 20, 2024',
    category: 'Healthcare'
  },
  {
    id: 6,
    title: 'Telehealth vs. In-Person Visits: When to Choose What',
    excerpt: 'A guide to help you decide when telehealth is the right choice for your healthcare needs.',
    author: 'DoctaRx Team',
    date: 'December 15, 2024',
    category: 'Patient Resources'
  }
];

export default function BlogPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-purple-50 to-yellow-50">
      <div className="container mx-auto px-6 py-16 max-w-6xl">
        <Link href="/">
          <Button variant="ghost" className="mb-8">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
        </Link>

        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold text-purple-900 font-serif mb-4">
            Blog
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Insights, tips, and updates about telehealth and healthcare
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {blogPosts.map((post) => (
            <article
              key={post.id}
              className="bg-white rounded-xl shadow-md overflow-hidden hover:shadow-lg transition-shadow border border-gray-100"
            >
              <div className="p-6">
                <div className="flex items-center gap-2 mb-3">
                  <span className="px-3 py-1 bg-purple-100 text-purple-700 text-xs font-medium rounded-full">
                    {post.category}
                  </span>
                </div>
                
                <h2 className="text-xl font-bold text-gray-900 mb-3 line-clamp-2">
                  {post.title}
                </h2>
                
                <p className="text-gray-600 text-sm mb-4 line-clamp-3">
                  {post.excerpt}
                </p>
                
                <div className="flex items-center gap-4 text-xs text-gray-500 mb-4">
                  <div className="flex items-center gap-1">
                    <User className="w-3 h-3" />
                    <span>{post.author}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    <span>{post.date}</span>
                  </div>
                </div>
                
                <button className="text-purple-600 hover:text-purple-700 font-medium text-sm flex items-center gap-1 group">
                  Read More
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-12 text-center">
          <p className="text-gray-600 mb-4">Want to stay updated?</p>
          <Button className="bg-gradient-to-r from-purple-600 to-purple-800 hover:from-purple-700 hover:to-purple-900 text-white">
            Subscribe to Newsletter
          </Button>
        </div>
      </div>
    </div>
  );
}

