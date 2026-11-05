'use client';

import Link from 'next/link';
import { ArrowLeft, Mail, Send, Loader2, CheckCircle2, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useState } from 'react';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { toast } from '@/components/ui/use-toast';
import api from '@/lib/api';

export default function ContactPage() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: '',
    type: 'general' // general, enterprise, support
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [formError, setFormError] = useState('');
  const [acknowledgementSent, setAcknowledgementSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError('');

    try {
      const response = await api.post('/contact', formData, { skipAuth: true, timeout: 60000 });
      if (response.data?.success !== true) throw new Error('Unconfirmed submission');
      setAcknowledgementSent(response.data.acknowledgementSent === true);
      setIsSubmitted(true);
      toast({
        title: 'Message accepted',
        description: 'Our mail service accepted your enquiry for the DoctaRx team. No need to submit it again.',
      });
      setFormData({ name: '', email: '', subject: '', message: '', type: 'general' });
    } catch (error) {
      const code = error.response?.data?.code;
      const message = code === 'CONTACT_INVALID'
        ? 'Check the form: name 2–100 characters, a valid email, subject 5–200 characters and message 10–5,000 characters.'
        : code === 'CONTACT_UNAVAILABLE'
          ? 'The contact form is unavailable. Your message was not sent. Your text is still here; you can copy it and email info@doctarx.com.'
          : 'We could not confirm delivery. Your text is still here. Keep a copy and mention this attempt if you email us, to avoid duplicate enquiries.';
      setFormError(message);
      toast({
        title: 'Delivery not confirmed',
        description: message,
        variant: 'destructive'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-background via-purple-50/30 to-background dark:from-slate-950 dark:via-purple-950/20 dark:to-slate-950">
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>
      <div className="container mx-auto px-6 py-16 max-w-6xl">
          <Link href="/" className="mb-8 inline-flex min-h-11 items-center rounded-lg px-4 py-2 font-medium hover:bg-muted">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Link>

        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold text-foreground font-serif mb-4">
            Contact Us
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Business, partnership and nonclinical support enquiries.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Contact Information */}
          <div className="space-y-6">
            <div className="bg-card rounded-2xl shadow-lg p-8 border border-border">
              <h2 className="text-2xl font-bold text-foreground mb-6">Get in Touch</h2>
              
              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-purple-600 to-indigo-700 flex items-center justify-center flex-shrink-0 shadow-lg shadow-purple-500/20">
                    <Mail className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-1">Email</h3>
                    <a href="mailto:info@doctarx.com" className="text-primary hover:underline">
                      info@doctarx.com
                    </a>
                    <p className="text-sm text-muted-foreground mt-1">Opens your email app. Please send nonclinical enquiries only.</p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-indigo-500/20">
                    <Building2 className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-1">Enterprise Solutions</h3>
                    <a href="mailto:info@doctarx.com?subject=Enterprise%20Inquiry" className="text-primary hover:underline">
                      Contact Sales
                    </a>
                    <p className="text-sm text-muted-foreground mt-1">Custom solutions for healthcare organizations</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-2xl shadow-lg p-8 border border-border">
              <h3 className="font-semibold text-foreground mb-4">For Urgent Medical Issues</h3>
              <p className="text-muted-foreground text-sm mb-4">
                If you're experiencing a medical emergency, contact your local emergency service or go to the nearest emergency department.
              </p>
              <p className="text-muted-foreground text-sm">
                This form and email inbox are not for medical advice or emergencies. Use your care team's appropriate clinical channel for care questions.
              </p>
            </div>
          </div>

          {/* Contact Form */}
          <div className="bg-card rounded-2xl shadow-lg p-8 border border-border">
            <h2 className="text-2xl font-bold text-foreground mb-6">Send us a Message</h2>
            <p id="contact-privacy-note" className="mb-6 text-sm leading-6 text-muted-foreground">This enquiry is sent by email. Do not include health records, symptoms, prescriptions, payment details or provider credential documents.</p>
            
            {isSubmitted ? (
              <div className="text-center py-8" role="status" aria-live="polite">
                <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">Message accepted</h3>
                <p className="text-muted-foreground mb-4">Our mail service accepted your enquiry for the DoctaRx team. No need to submit it again.</p>
                <p className="text-muted-foreground mb-6">{acknowledgementSent ? 'A confirmation email was also accepted by the mail service for your address.' : 'We could not send a confirmation email to your address, but your enquiry was accepted for the team.'}</p>
                <Button variant="outline" onClick={() => setIsSubmitted(false)}>
                  Send Another Message
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} aria-describedby="contact-privacy-note" className="space-y-5">
                {formError && <div role="alert" className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm leading-6"><p>{formError}</p><a href="mailto:info@doctarx.com" className="mt-2 inline-block font-semibold underline underline-offset-4">Open your email app to contact info@doctarx.com</a></div>}
                <div>
                  <Label htmlFor="type" className="text-foreground">Inquiry Type</Label>
                  <select
                    id="type"
                    name="type"
                    value={formData.type}
                    onChange={handleChange}
                    className="mt-1 w-full h-10 rounded-lg border border-input bg-background px-3 text-sm"
                  >
                    <option value="general">General Inquiry</option>
                    <option value="support">Technical Support</option>
                    <option value="enterprise">Enterprise Solutions</option>
                    <option value="partnership">Partnership Opportunity</option>
                    <option value="billing">Billing Question</option>
                  </select>
                </div>

                <div>
                  <Label htmlFor="name" className="text-foreground">Name</Label>
                  <Input
                    id="name"
                    name="name"
                    type="text"
                    required
                    minLength={2}
                    maxLength={100}
                    autoComplete="name"
                    value={formData.name}
                    onChange={handleChange}
                    className="mt-1 bg-background"
                  />
                </div>

                <div>
                  <Label htmlFor="email" className="text-foreground">Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    required
                    maxLength={254}
                    autoComplete="email"
                    value={formData.email}
                    onChange={handleChange}
                    className="mt-1 bg-background"
                  />
                </div>

                <div>
                  <Label htmlFor="subject" className="text-foreground">Subject</Label>
                  <Input
                    id="subject"
                    name="subject"
                    type="text"
                    required
                    minLength={5}
                    maxLength={200}
                    value={formData.subject}
                    onChange={handleChange}
                    className="mt-1 bg-background"
                  />
                </div>

                <div>
                  <Label htmlFor="message" className="text-foreground">Message</Label>
                  <textarea
                    id="message"
                    name="message"
                    rows={5}
                    required
                    minLength={10}
                    maxLength={5000}
                    value={formData.message}
                    onChange={handleChange}
                    className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  />
                </div>

                <Button 
                  type="submit" 
                  disabled={isSubmitting}
                  className="w-full bg-gradient-to-r from-purple-600 to-indigo-700 hover:from-purple-700 hover:to-indigo-800 text-white shadow-lg shadow-purple-500/25"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      Send Message
                    </>
                  )}
                </Button>
              </form>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
