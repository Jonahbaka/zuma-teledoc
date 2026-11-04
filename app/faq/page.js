'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';
import { doctarxFAQs } from '@/lib/faqData';

export default function FAQPage() {
  const [openIndex, setOpenIndex] = useState(null);
  return <div className="doctarx-site bg-[#f4f7fc] text-slate-950">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex min-h-24 max-w-5xl items-center justify-between gap-4 px-5 sm:px-8"><Link href="/" aria-label="DoctaRx home"><DoctaRxLogo tone="dark" glow={false} className="h-10 max-w-[160px]" /></Link><Link href="/" className="inline-flex min-h-12 items-center gap-2 px-4 font-semibold text-blue-700"><ArrowLeft size={20} /> Home</Link></div></header>
    <main className="mx-auto max-w-5xl px-5 py-14 sm:px-8 sm:py-20">
      <p className="font-semibold text-blue-700">DOCTARX · HELP</p><h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">Frequently asked questions</h1><p className="mt-5 max-w-3xl text-lg leading-8 text-slate-600">Find your next step with booking, visits, insurance, records, and pharmacy choices.</p>
      <div className="mt-10 space-y-4">{doctarxFAQs.map((faq, index) => <section key={faq.question} className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><h2><button onClick={() => setOpenIndex(openIndex === index ? null : index)} aria-expanded={openIndex === index} aria-controls={'faq-answer-' + index} id={'faq-question-' + index} className="flex min-h-16 w-full items-center justify-between gap-5 px-6 py-5 text-left text-lg font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">{faq.question}<ChevronDown size={22} className={'shrink-0 text-blue-700 transition-transform ' + (openIndex === index ? 'rotate-180' : '')} aria-hidden="true" /></button></h2><div id={'faq-answer-' + index} hidden={openIndex !== index} aria-labelledby={'faq-question-' + index} className="border-t border-slate-100 px-6 py-5"><p className="text-base leading-8 text-slate-600">{faq.answer}</p></div></section>)}</div>
      <section className="mt-10 rounded-3xl bg-[#101d36] p-7 text-white sm:p-9"><h2 className="text-2xl font-semibold">Need help with your account?</h2><p className="mt-3 leading-7 text-slate-300">Contact DoctaRx with your question. Keep passwords and sensitive clinical details out of ordinary email.</p><Link href="/contact" className="mt-5 inline-flex min-h-12 items-center rounded-xl bg-white px-5 py-3 font-semibold text-slate-950">Contact DoctaRx</Link></section>
    </main>
  </div>;
}
