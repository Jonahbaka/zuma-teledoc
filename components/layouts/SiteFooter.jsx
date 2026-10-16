'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowUpRight, Mail } from 'lucide-react';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';
import styles from './SiteFooter.module.css';

export default function SiteFooter() {
  const nigeria=(usePathname()||'/').startsWith('/ng');
  const patient=nigeria?'/ng/patient':'/patient', provider=nigeria?'/ng/provider':'/provider', pharmacy=nigeria?'/ng/pharmacy':'/pharmacy';
  const columns=[
    ['Your care',[['Find care',nigeria?'/ng/find-care':patient+'/appointments/book'],['Patient sign in',patient+'/login'],['Find pharmacies',nigeria?'/ng/pharmacies':'/pharmacies'],['Frequently asked questions','/faq']]],
    ['Professionals',[['Provider sign in',provider+'/login'],['Join as a provider',provider+'/register'],['Pharmacy sign in',pharmacy+'/login'],['DoctaRx CareOps','/careops/login']]],
    ['About DoctaRx',[['Contact us','/contact'],['Privacy policy','/privacy'],['Terms of use','/terms'],['Accessibility','/accessibility']]],
  ];
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.panel}>
          <div className={styles.brand}>
            <Link href={nigeria ? '/ng' : '/'} aria-label="DoctaRx home" className={styles.logoLink}>
              <DoctaRxLogo glow={false} className="h-11 w-auto max-w-[190px]" />
            </Link>
            <p className={styles.tagline}>Your care.<br /><span>Connected.</span></p>
            <a href="mailto:info@doctarx.com" className={styles.contact}>
              <Mail size={20} aria-hidden="true" />
              <span>info@doctarx.com</span>
              <ArrowUpRight size={18} aria-hidden="true" />
            </a>
          </div>
          <div className={styles.navigation}>
            {columns.map(([title, links]) => (
              <nav key={title} aria-label={title} className={styles.column}>
                <h2>{title}</h2>
                <ul>
                  {links.map(([label, href]) => (
                    <li key={href}><Link href={href}>{label}</Link></li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>
        <div className={styles.bottom}>
          <p>© {new Date().getFullYear()} DoctaRx. All rights reserved.</p>
          <nav aria-label="Service regions" className={styles.regions}>
            <Link href="/" aria-current={!nigeria ? 'page' : undefined}>
              United States<ArrowUpRight size={17} aria-hidden="true" />
            </Link>
            <Link href="/ng" aria-current={nigeria ? 'page' : undefined}>
              Nigeria<ArrowUpRight size={17} aria-hidden="true" />
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
