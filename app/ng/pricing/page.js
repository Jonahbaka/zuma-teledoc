'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle, ArrowRight, Sparkles, Zap, Users, Hospital,
  Package, Stethoscope, Phone, Mail, Shield, Star,
  Building2, Globe
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import NgNav from '../components/NgNav';
import { SUBSCRIPTION_PLANS, formatNaira } from '../lib/ngUtils';

const FAQs = [
  { q: 'Is there a free tier for patients?', a: 'Yes. Patients can use the platform at no cost — searching medications, uploading prescriptions, and ordering from pharmacies. Subscriptions unlock included consultations and discounts.' },
  { q: 'How is organisation billing calculated?', a: 'You can choose between per-member pricing (₦1,000–₦2,000/member/month based on size) or bundle pricing (Starter, Growth, Enterprise). Annual billing saves 20%.' },
  { q: 'What payment methods are accepted?', a: 'We accept card (Visa, Mastercard, Verve), bank transfer, and USSD via Paystack and Flutterwave.' },
  { q: 'Can organisations get custom contracts?', a: 'Yes. Enterprise organisations — HMOs, government bodies, hospitals with 100+ staff — can contact our sales team for custom pricing and SLA.' },
  { q: 'What happens if a payment fails?', a: 'We retry failed payments and notify you by email and SMS. Subscriptions enter a grace period before being downgraded.' },
  { q: 'Are provider subscriptions required?', a: 'Providers can also work on a per-consult commission model (10–20% platform fee). Subscriptions unlock featured listings and reduced commission rates.' },
];

export default function NgPricingPage() {
  const [billingCycle, setBillingCycle] = useState('monthly');
  const [activeTab, setActiveTab] = useState('patients');

  const tabs = [
    { key: 'patients', label: 'Patients', icon: Stethoscope },
    { key: 'organizations', label: 'Organisations', icon: Users },
    { key: 'providers', label: 'Providers', icon: Stethoscope },
    { key: 'pharmacies', label: 'Pharmacies', icon: Package },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <NgNav />
      <div className="pt-14">

        {/* Hero */}
        <section className="py-20 px-6 text-center bg-gradient-to-b from-background via-green-50/10 to-background dark:via-green-950/10">
          <div className="max-w-4xl mx-auto space-y-5">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-500/10 text-green-600 text-xs font-semibold border border-green-500/20">
              <Sparkles size={10} /> Nigeria Pricing
            </span>
            <h1 className="text-4xl md:text-6xl font-bold text-foreground tracking-tight">Simple, transparent pricing</h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Every account type has a pricing model built for Nigeria — from individual patients to large enterprises.
            </p>
            <div className="flex items-center bg-card border border-border rounded-2xl p-1 gap-1 w-fit mx-auto">
              {['monthly', 'annual'].map(cycle => (
                <button key={cycle} onClick={() => setBillingCycle(cycle)} className={`px-5 py-2 rounded-xl text-sm font-semibold transition-all capitalize ${billingCycle === cycle ? 'bg-green-600 text-white' : 'text-muted-foreground hover:text-foreground'}`}>
                  {cycle}
                  {cycle === 'annual' && <span className="ml-1.5 text-[10px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded-full">Save 20%</span>}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Tab selector */}
        <div className="sticky top-14 z-30 bg-background/90 backdrop-blur-xl border-b border-border px-6 py-3">
          <div className="max-w-6xl mx-auto flex gap-2 overflow-x-auto">
            {tabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-all shrink-0 ${activeTab === tab.key ? 'bg-green-600 text-white border-green-600' : 'bg-card border-border text-muted-foreground hover:border-green-500/30'}`}>
                  <Icon size={14} />{tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-6 py-16 space-y-20">

          {/* PATIENTS */}
          {activeTab === 'patients' && (
            <div id="patients">
              <div className="text-center mb-10">
                <h2 className="text-3xl font-bold text-foreground">Patient Plans</h2>
                <p className="text-muted-foreground mt-2">Free to start. Upgrade for included consultations and discounts.</p>
              </div>

              {/* Pay as you go */}
              <div className="bg-card border border-border rounded-2xl p-6 mb-6 flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <div className="font-bold text-foreground text-lg">Pay-as-You-Go</div>
                  <div className="text-muted-foreground text-sm mt-1">No subscription. Pay per consultation only.</div>
                  <div className="flex flex-wrap gap-4 mt-3 text-sm">
                    <div className="flex items-center gap-1.5"><CheckCircle size={14} className="text-green-500" /> General Consultation: <strong>₦2,000–₦5,000</strong></div>
                    <div className="flex items-center gap-1.5"><CheckCircle size={14} className="text-green-500" /> Specialist: <strong>₦5,000–₦15,000</strong></div>
                    <div className="flex items-center gap-1.5"><CheckCircle size={14} className="text-green-500" /> Medication Search: <strong>Free</strong></div>
                    <div className="flex items-center gap-1.5"><CheckCircle size={14} className="text-green-500" /> Prescription Upload: <strong>Free</strong></div>
                  </div>
                </div>
                <Link href="/ng/patient/appointments"><Button variant="outline" className="rounded-xl shrink-0">Book Now</Button></Link>
              </div>

              <div className="grid md:grid-cols-3 gap-5">
                {SUBSCRIPTION_PLANS.patient.map((plan) => {
                  const price = billingCycle === 'annual' ? Math.round(plan.price * 0.8) : plan.price;
                  return (
                    <div key={plan.id} className={`relative bg-background rounded-3xl p-8 border flex flex-col ${plan.highlight ? 'border-green-500/40 shadow-[0_0_30px_rgba(22,163,74,0.1)]' : 'border-border'}`}>
                      {plan.highlight && <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-green-600 text-white text-[10px] font-bold px-4 py-1 rounded-full uppercase tracking-wider">Most Popular</div>}
                      <div className="text-sm font-semibold text-muted-foreground mb-2">{plan.name}</div>
                      <div className="text-4xl font-bold text-foreground">{formatNaira(price)}<span className="text-muted-foreground text-lg">/mo</span></div>
                      {billingCycle === 'annual' && <div className="text-xs text-green-600 font-medium mt-1">Billed annually</div>}
                      {plan.consultations > 0 && <div className="text-xs text-green-600 font-semibold mt-2 mb-4">{plan.consultations === -1 ? 'Unlimited consultations (fair use)' : `${plan.consultations} consultation/month included`}</div>}
                      <ul className="space-y-2.5 flex-1 mt-4 mb-6">
                        {plan.features.map((f, i) => <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground"><CheckCircle size={14} className="text-green-500 mt-0.5 shrink-0" />{f}</li>)}
                      </ul>
                      <Link href="/ng/patient/subscription" className={`block text-center py-3 rounded-xl font-bold transition-colors ${plan.highlight ? 'bg-green-600 hover:bg-green-500 text-white' : 'border border-border hover:bg-accent text-foreground'}`}>{plan.cta}</Link>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ORGANISATIONS */}
          {activeTab === 'organizations' && (
            <div id="organisations">
              <div className="text-center mb-10">
                <h2 className="text-3xl font-bold text-foreground">Organisation Plans</h2>
                <p className="text-muted-foreground mt-2">For companies, churches, schools, NGOs, government bodies, and more.</p>
              </div>

              {/* Per-member pricing */}
              <div className="bg-card border border-border rounded-2xl p-6 mb-8">
                <div className="font-bold text-foreground text-lg mb-3">Per-Member Pricing</div>
                <div className="grid sm:grid-cols-3 gap-4">
                  {[
                    { range: '1–50 members', price: '₦2,000', per: '/member/month' },
                    { range: '51–200 members', price: '₦1,500', per: '/member/month' },
                    { range: '200+ members', price: '₦1,000', per: '/member/month' },
                  ].map(tier => (
                    <div key={tier.range} className="bg-background rounded-xl border border-border p-4 text-center">
                      <div className="text-sm text-muted-foreground mb-1">{tier.range}</div>
                      <div className="text-2xl font-bold text-foreground">{tier.price}</div>
                      <div className="text-xs text-muted-foreground">{tier.per}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-5 mb-8">
                {SUBSCRIPTION_PLANS.organization.map((plan) => {
                  const price = plan.price ? (billingCycle === 'annual' ? Math.round(plan.price * 0.8) : plan.price) : null;
                  return (
                    <div key={plan.id} className={`relative bg-background rounded-3xl p-8 border flex flex-col ${plan.highlight ? 'border-green-500/40 shadow-[0_0_30px_rgba(22,163,74,0.1)]' : 'border-border'}`}>
                      {plan.highlight && <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-green-600 text-white text-[10px] font-bold px-4 py-1 rounded-full uppercase tracking-wider">Most Popular</div>}
                      <div className="text-sm font-semibold text-muted-foreground mb-2">{plan.name}</div>
                      <div className="text-4xl font-bold text-foreground">{price ? formatNaira(price) : 'Custom'}<span className="text-muted-foreground text-lg">{price ? '/mo' : ''}</span></div>
                      {plan.members && <div className="text-sm text-green-600 font-semibold mt-1">Up to {plan.members} members</div>}
                      <ul className="space-y-2.5 flex-1 mt-4 mb-6">
                        {plan.features.map((f, i) => <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground"><CheckCircle size={14} className="text-green-500 mt-0.5 shrink-0" />{f}</li>)}
                      </ul>
                      <Link href={plan.id === 'org_enterprise' ? '/contact' : '/ng/organization/register'} className={`block text-center py-3 rounded-xl font-bold transition-colors ${plan.highlight ? 'bg-green-600 hover:bg-green-500 text-white' : 'border border-border hover:bg-accent text-foreground'}`}>
                        {plan.id === 'org_enterprise' ? 'Contact Sales' : `Get ${plan.name}`}
                      </Link>
                    </div>
                  );
                })}
              </div>

              {/* Add-ons */}
              <div id="enterprise" className="bg-card border border-border rounded-2xl p-6">
                <h3 className="font-bold text-foreground text-lg mb-4">Organisation Add-ons</h3>
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    { label: 'Priority Doctor Access', price: '+₦500/member/mo' },
                    { label: 'Chronic Care Plan', price: '+₦1,000/member/mo' },
                    { label: 'AI Health Analytics', price: 'Premium add-on' },
                    { label: 'On-site Health Campaign', price: '₦100K–₦1M/event' },
                  ].map(addon => (
                    <div key={addon.label} className="bg-background rounded-xl border border-border p-4">
                      <div className="text-sm font-semibold text-foreground">{addon.label}</div>
                      <div className="text-xs text-green-600 font-medium mt-1">{addon.price}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* PROVIDERS */}
          {activeTab === 'providers' && (
            <div>
              <div className="text-center mb-10">
                <h2 className="text-3xl font-bold text-foreground">Provider Plans</h2>
                <p className="text-muted-foreground mt-2">For doctors and healthcare providers on DoctaRx Nigeria.</p>
              </div>

              {/* Commission model */}
              <div className="bg-card border border-border rounded-2xl p-6 mb-6">
                <div className="font-bold text-foreground text-lg mb-2">Commission Model (No Subscription)</div>
                <p className="text-muted-foreground text-sm mb-3">No monthly fee. Pay 10–20% platform commission per consultation.</p>
                <div className="flex flex-wrap gap-4 text-sm">
                  <div><span className="text-muted-foreground">General Consult: </span><strong className="text-foreground">15% commission</strong></div>
                  <div><span className="text-muted-foreground">Specialist Consult: </span><strong className="text-foreground">10% commission</strong></div>
                  <div><span className="text-muted-foreground">Payout schedule: </span><strong className="text-foreground">T+3</strong></div>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-5">
                {SUBSCRIPTION_PLANS.provider.map((plan) => {
                  const price = billingCycle === 'annual' ? Math.round(plan.price * 0.8) : plan.price;
                  return (
                    <div key={plan.id} className="bg-background rounded-3xl p-8 border border-border flex flex-col">
                      <div className="text-sm font-semibold text-muted-foreground mb-2">{plan.name}</div>
                      <div className="text-4xl font-bold text-foreground">{formatNaira(price)}<span className="text-muted-foreground text-lg">/mo</span></div>
                      <ul className="space-y-2.5 flex-1 mt-4 mb-6">
                        {plan.features.map((f, i) => <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground"><CheckCircle size={14} className="text-blue-500 mt-0.5 shrink-0" />{f}</li>)}
                      </ul>
                      <Link href="/ng/provider/auth/register" className="block text-center py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold transition-colors">Register as Provider</Link>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* PHARMACIES */}
          {activeTab === 'pharmacies' && (
            <div>
              <div className="text-center mb-10">
                <h2 className="text-3xl font-bold text-foreground">Pharmacy Plans</h2>
                <p className="text-muted-foreground mt-2">Join Nigeria's largest digital prescription network.</p>
              </div>

              <div className="grid md:grid-cols-3 gap-5">
                {SUBSCRIPTION_PLANS.pharmacy.map((plan) => {
                  const price = billingCycle === 'annual' ? Math.round(plan.price * 0.8) : plan.price;
                  return (
                    <div key={plan.id} className="bg-background rounded-3xl p-8 border border-border flex flex-col">
                      <div className="text-sm font-semibold text-muted-foreground mb-2">{plan.name}</div>
                      <div className="text-4xl font-bold text-foreground">{formatNaira(price)}<span className="text-muted-foreground text-lg">/mo</span></div>
                      <ul className="space-y-2.5 flex-1 mt-4 mb-6">
                        {plan.features.map((f, i) => <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground"><CheckCircle size={14} className="text-teal-500 mt-0.5 shrink-0" />{f}</li>)}
                      </ul>
                      <Link href="/ng/pharmacy/onboarding" className="block text-center py-3 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-bold transition-colors">Register Pharmacy</Link>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 bg-card border border-border rounded-2xl p-6">
                <h3 className="font-bold text-foreground mb-3">Pharmacy Revenue Model</h3>
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                  <div className="bg-background rounded-xl border border-border p-4"><div className="text-muted-foreground">Pharmacy Margin</div><div className="font-bold text-foreground mt-1">5%–20%</div></div>
                  <div className="bg-background rounded-xl border border-border p-4"><div className="text-muted-foreground">Dispense Fee</div><div className="font-bold text-foreground mt-1">₦200–₦500/order</div></div>
                  <div className="bg-background rounded-xl border border-border p-4"><div className="text-muted-foreground">Featured Placement</div><div className="font-bold text-foreground mt-1">₦20K–₦200K/mo</div></div>
                  <div className="bg-background rounded-xl border border-border p-4"><div className="text-muted-foreground">Settlement</div><div className="font-bold text-foreground mt-1">T+1 to T+5</div></div>
                </div>
              </div>
            </div>
          )}

          {/* Enterprise CTA */}
          <div className="bg-gradient-to-r from-green-700 to-emerald-600 rounded-3xl p-10 text-center">
            <h2 className="text-3xl font-bold text-white mb-3">Enterprise & Institutional Pricing</h2>
            <p className="text-green-100 mb-6 max-w-xl mx-auto">
              HMOs, government bodies, hospitals with 100+ staff, and large schools or churches can get custom contracts starting from ₦500,000/month.
            </p>
            <div className="flex flex-wrap gap-4 justify-center">
              <a href="mailto:ng@doctarx.com" className="inline-flex items-center gap-2 bg-white text-green-700 font-bold px-6 py-3 rounded-xl hover:bg-green-50 transition-colors">
                <Mail size={16} /> Contact Enterprise Sales
              </a>
              <a href="tel:+2349000000000" className="inline-flex items-center gap-2 bg-white/10 text-white font-bold px-6 py-3 rounded-xl hover:bg-white/20 transition-colors border border-white/20">
                <Phone size={16} /> Call Us
              </a>
            </div>
          </div>

          {/* FAQ */}
          <div>
            <h2 className="text-3xl font-bold text-foreground text-center mb-10">Frequently Asked Questions</h2>
            <div className="grid md:grid-cols-2 gap-5">
              {FAQs.map((faq) => (
                <div key={faq.q} className="bg-card border border-border rounded-2xl p-6">
                  <h4 className="font-bold text-foreground mb-2">{faq.q}</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">{faq.a}</p>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
