'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, AudioLines, Calendar, Check, ChevronRight, FileText, HeartHandshake, Languages, Menu, MessageSquare, Pill, ShieldCheck, Stethoscope, Users, Video, X } from 'lucide-react';
import DoctaRxLogo from '@/components/branding/DoctaRxLogo';
import CareLocationPicker from '@/components/discovery/CareLocationPicker';
import useCareLocation from '@/lib/useCareLocation';
import styles from './MarketHomepage.module.css';

const sections=[['Language voice','#language-voice'],['Care','#features'],['How it works','#workflow'],['Pharmacies','#network']];

export default function MarketHomepage({ market = 'US' }) {
  const nigeria=market==='NG', home=nigeria?'/ng':'/', patient=nigeria?'/ng/patient':'/patient';
  const visual = (name) => `/marketing/doctarx/${nigeria ? 'ng-' : ''}${name}-v1.webp`;
  const careLocation=useCareLocation(market);
  const [menuOpen,setMenuOpen]=useState(false);
  const menuButton=useRef(null);
  // Precise device coordinates belong only in the directory lookup, never a
  // navigation URL that may be captured by history or page-view analytics.
  const params=careLocation.location.mode==='manual'?new URLSearchParams(careLocation.params).toString():'';
  const findCare=nigeria?'/ng/find-care'+(params?'?'+params:''):patient+'/appointments/book';
  const pharmacies=(nigeria?'/ng/pharmacies':'/pharmacies')+(params?'?'+params:'');
  useEffect(()=>{if(!menuOpen)return undefined;const close=event=>{if(event.key==='Escape'){setMenuOpen(false);menuButton.current?.focus();}};document.addEventListener('keydown',close);return()=>document.removeEventListener('keydown',close);},[menuOpen]);
  return <div className={`doctarx-site bg-white text-slate-950 ${styles.site}`}>
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur-lg"><div className="mx-auto flex min-h-24 max-w-[1440px] items-center justify-between gap-4 px-5 sm:px-8">
      <Link href={home} aria-label="DoctaRx home" className="shrink-0"><DoctaRxLogo tone="dark" glow={false} className="h-10 w-auto max-w-[160px]" /></Link>
      <nav aria-label="Primary navigation" className="hidden items-center gap-7 xl:flex">{sections.map(([label,href])=><Link key={href} href={href} className="inline-flex min-h-12 items-center font-medium text-slate-700 hover:text-blue-700">{label}</Link>)}</nav>
      <div className="flex items-center gap-3"><div className="hidden items-center gap-4 lg:flex"><span className="text-slate-600">{nigeria?'Nigeria services':'United States services'}</span><Link href={nigeria?'/':'/ng'} className="inline-flex min-h-12 items-center font-medium text-blue-700">Change region</Link></div><Link href={patient+'/login'} className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-300 px-4 font-semibold hover:bg-slate-50">Sign in</Link><button ref={menuButton} type="button" aria-label={menuOpen?'Close main navigation':'Open main navigation'} aria-expanded={menuOpen} className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-xl border border-slate-300 xl:hidden" onClick={()=>setMenuOpen(value=>!value)}>{menuOpen?<X aria-hidden="true" className="h-6 w-6" />:<Menu aria-hidden="true" className="h-6 w-6" />}</button></div>
    </div>{menuOpen&&<nav aria-label="Mobile primary navigation" className="border-t border-slate-200 bg-white px-5 py-4 xl:hidden">{sections.map(([label,href])=><Link key={href} href={href} className="flex min-h-12 items-center rounded-xl px-3 font-medium hover:bg-blue-50" onClick={()=>setMenuOpen(false)}>{label}</Link>)}<Link href={nigeria?'/':'/ng'} className="flex min-h-12 items-center px-3 font-medium text-blue-700">{nigeria?'United States services':'Nigeria services'}</Link></nav>}</header>
    <main>
      <section className={styles.aiHero} aria-labelledby="hero-heading">
        <div className={styles.heroGrid}>
          <div className={styles.heroCopy}>
            <p className={styles.brandPill}><span aria-hidden="true" />DOCTARX · AI-FIRST TELEHEALTH</p>
            <h1 id="hero-heading">AI-first telehealth.<br /><span>Human care.</span></h1>
            <p className={styles.heroDescription}>Intelligent technology. Personal care. A connected experience that brings your voice, your care team, and your next step together.</p>
            <div className={styles.heroActions}>
              <Link href={findCare} className={styles.primaryAction}>Find care<ArrowRight aria-hidden="true" /></Link>
              <Link href="#language-voice" className={styles.secondaryAction}>Explore language voice<AudioLines aria-hidden="true" /></Link>
            </div>
            <ul className={styles.heroPrinciples} aria-label="Our approach to care">
              <li><AudioLines aria-hidden="true" />Voice-led connection</li>
              <li><Stethoscope aria-hidden="true" />Clinician-led care</li>
            </ul>
          </div>
          <div className={styles.heroArt}>
            <Image src="/marketing/doctarx/ai-language-voice-hero-v1.webp" alt="3D concept illustration of blue and teal speech bubbles, a voice waveform and a clinician symbol" width={1536} height={1024} priority sizes="(max-width: 900px) 100vw, 55vw" className={styles.heroImage} />
            <div className={styles.heroArtCaption}><span><AudioLines aria-hidden="true" /></span><div><p>Built around a conversation.</p><strong>Connected around you.</strong></div></div>
          </div>
        </div>
        <div className={styles.heroBridge}><p>Intelligence that connects.<br className={styles.mobileBreak} /> Care that stays human.</p><span>VOICE <span aria-hidden="true">/</span> VIRTUAL CARE <span aria-hidden="true">/</span> CONNECTED HEALTH</span></div>
      </section>
      <section id="language-voice" className={styles.voiceSection} aria-labelledby="voice-heading">
        <div className={styles.voiceIntro}>
          <div><p className={styles.eyebrow}>MULTILINGUAL LANGUAGE VOICE</p><h2 id="voice-heading">Your voice.<br /><span>Your language.</span></h2></div>
          <div className={styles.voiceIntroCopy}><p>Care starts with being understood. Speak naturally, share what matters, and bring your story into the conversation with your clinician.</p><ul className={styles.languageList} aria-label="Language voice"><li>English</li><li>Nigerian English</li><li>Hausa</li><li>Igbo</li><li>Yoruba</li></ul></div>
        </div>
        <div className={styles.voiceCards}>
          <article className={styles.voiceCard}><span className={styles.voiceCardIcon}><AudioLines aria-hidden="true" /></span><p className={styles.voiceStep}>01 / A NATURAL START</p><h3>Less typing.<br />More conversation.</h3><p>Tell your care story in your own words. Voice brings a more personal rhythm to the first step.</p></article>
          <article className={`${styles.voiceCard} ${styles.voiceTranslation}`}><span className={styles.voiceCardIcon}><Languages aria-hidden="true" /></span><p className={styles.voiceStep}>02 / MEANING MATTERS</p><h3>Language is part<br />of good care.</h3><p>Make space for familiar expressions and the details that matter to you. Your voice belongs in the conversation.</p></article>
          <article className={styles.voiceCard}><span className={styles.voiceCardIcon}><HeartHandshake aria-hidden="true" /></span><p className={styles.voiceStep}>03 / PEOPLE AT THE CENTRE</p><h3>AI connects.<br />Clinicians care.</h3><p>Bring your story to a care team for review, clinical decisions, and a clear next step.</p></article>
        </div>
      </section>
      <div className={styles.experience}>
        <section id="features" className={styles.section} aria-labelledby="care-heading">
          <div className={styles.sectionIntro}>
            <div><p className={styles.eyebrow}>CARE, A LITTLE CLOSER</p><h2 id="care-heading">Your day. Your care.<br />All connected.</h2></div>
            <p>Less to navigate.<br />More room for you.</p>
          </div>
          <div className={styles.careGrid}>
            <Link href={findCare} className={`${styles.card} ${styles.visitCard}`}>
              <div className={styles.visitVisual}><Image src={visual('connected-care')} alt={nigeria ? 'Illustration of a Nigerian woman having a virtual care conversation at home' : 'Illustration of a woman having a relaxed virtual care conversation at home'} width={1280} height={853} sizes="(min-width: 768px) 50vw, 100vw" className={styles.fittedImage} /></div>
              <div className={styles.photoCaption}>
                <div><h3>Doctor visits</h3><p>A personal conversation. A clearer next step.</p></div>
                <span className={styles.cardArrow}><ArrowRight aria-hidden="true" /></span>
              </div>
            </Link>
            <Link href={patient+'/prescriptions'} className={`${styles.card} ${styles.prescriptionCard}`}>
              <div className={styles.essentialsVisual}><Image src="/marketing/doctarx/care-essentials-v1.webp" alt="Glass illustration of a health record folder and an unlabelled medicine bottle" width={1280} height={853} sizes="(min-width: 768px) 50vw, 100vw" className={styles.fittedImage} /></div>
              <div className={styles.cardCopy}><h3>Prescription care</h3><p>Medication instructions. Pharmacy coordination.</p><span className={styles.textLink}>View prescriptions<ArrowRight aria-hidden="true" /></span></div>
            </Link>
            <Link href={patient+'/records'} className={`${styles.card} ${styles.recordsCard}`}>
              <div className={styles.recordVisual} aria-hidden="true"><div><FileText /><span /><span /><span /></div><span className={styles.recordLock}><ShieldCheck /></span></div>
              <div className={styles.cardCopy}><h3>Your health records</h3><p>Your visits and released documents. Within reach.</p><span className={styles.textLink}>Open your records<ArrowRight aria-hidden="true" /></span></div>
            </Link>
            <Link href={patient+'/messages'} className={`${styles.card} ${styles.smallCard}`}>
              <div className={styles.messageVisual} aria-hidden="true"><span><MessageSquare /></span><span><HeartHandshake /></span></div>
              <div className={styles.smallCardCopy}><h3>Stay in touch</h3><p>Keep the conversation with your care team going.</p></div><ArrowRight className={styles.smallArrow} aria-hidden="true" />
            </Link>
            <Link href={findCare} className={`${styles.card} ${styles.smallCard} ${styles.specialistCard}`}>
              <span className={styles.specialistVisual} aria-hidden="true"><Stethoscope /></span>
              <div className={styles.smallCardCopy}><h3>Specialist support</h3><p>Explore the right clinician for your next step.</p></div><ArrowRight className={styles.smallArrow} aria-hidden="true" />
            </Link>
            <Link href="/careops/login" className={`${styles.card} ${styles.smallCard} ${styles.teamCard}`}>
              <span className={styles.teamVisual} aria-hidden="true"><Users /><span /><span /></span>
              <div className={styles.smallCardCopy}><h3>Care for your organization</h3><p>One workspace. A more connected care team.</p></div><ArrowRight className={styles.smallArrow} aria-hidden="true" />
            </Link>
          </div>
        </section>

        <section id="network" className={`${styles.section} ${styles.locationSection}`} aria-labelledby="location-heading">
          <div className={styles.pharmacyVisual}>
            <Image src={visual('pharmacy-care')} alt={nigeria ? 'Illustration of a Nigerian pharmacist preparing a medicine bag in a community pharmacy' : 'Illustration of a pharmacist preparing a medicine bag in a modern pharmacy'} width={1280} height={853} sizes="(min-width: 768px) 50vw, 100vw" className={styles.fittedImage} />
            <div className={styles.pharmacyCaption}><span className={styles.cardIcon}><Pill aria-hidden="true" /></span><div><p>Your location. Your choice.</p><strong>Care around your life.</strong></div></div>
          </div>
          <div className={styles.locationContent}>
            <p className={styles.eyebrow}>NEAR YOU. OR WHERE YOU NEED.</p><h2 id="location-heading">A familiar place.<br />A simpler next step.</h2>
            <p className={styles.sectionDescription}>Find pharmacy options near your device, home, work, or another area you choose.</p>
            <div className={styles.locationGlass}><CareLocationPicker careLocation={careLocation} /></div>
            <div className={styles.actions}><Link href={pharmacies} className={styles.primaryAction}>Find pharmacies<ArrowRight aria-hidden="true" /></Link><Link href={findCare} className={styles.secondaryAction}>Explore care options</Link></div>
            <p className={styles.locationNote}>Confirm services and medication availability with the selected pharmacy.</p>
          </div>
        </section>

        <section id="workflow" className={styles.section} aria-labelledby="workflow-heading">
          <div className={styles.sectionIntro}><div><p className={styles.eyebrow}>THOUGHTFULLY SIMPLE</p><h2 id="workflow-heading">From “I need care”<br />to “I know what’s next.”</h2></div><Link href={findCare} className={styles.secondaryAction}>Start your care journey<ArrowRight aria-hidden="true" /></Link></div>
          <ol className={styles.journeyGrid}>
            {[
              [MessageSquare,'Tell us what you need','Choose a service and share what brings you here.'],
              [Video,'Connect with your clinician','Choose an available visit and get ready to talk.'],
              [HeartHandshake,'Keep your care moving','Review your care instructions and next steps.'],
            ].map(([Icon,title,description],index)=><li key={title} className={styles.journeyCard}><div className={styles.journeyTop}><span className={styles.journeyNumber}>0{index+1}</span><span className={styles.journeyIcon}><Icon aria-hidden="true" /></span><ArrowRight aria-hidden="true" /></div><h3>{title}</h3><p>{description}</p></li>)}
          </ol>
        </section>

        <section id="organizations" className={styles.organizations} aria-labelledby="organizations-heading">
          <div className={styles.organizationInner}>
            <div className={styles.organizationCopy}><p className={styles.eyebrow}>DOCTARX CAREOPS</p><h2 id="organizations-heading">Great care<br />is a team effort.</h2><p>Connect facility teams, remote specialists, and the next step in care.</p><ul>{['Clinical collaboration','Patient records and follow-up','Role-based institutional reporting'].map(text=><li key={text}><Check aria-hidden="true" />{text}</li>)}</ul><Link href="/careops/login" className={styles.lightAction}>Open CareOps<ArrowRight aria-hidden="true" /></Link></div>
            <div className={styles.organizationVisual}><Image src={visual('clinical-team')} alt={nigeria ? 'Illustration of a Nigerian nurse and physician collaborating in a primary healthcare clinic' : 'Illustration of a nurse and clinician collaborating over a tablet in a clinic'} width={1280} height={853} sizes="(min-width: 768px) 50vw, 100vw" className={styles.fittedImage} /><div className={styles.teamCaption}><span><Users aria-hidden="true" /></span><p>Different expertise.<br /><strong>One connected team.</strong></p></div></div>
          </div>
        </section>

        <section id="security" className={`${styles.section} ${styles.confidenceSection}`} aria-label="Privacy and care options">
          <div className={`${styles.card} ${styles.confidenceCard}`}><span className={styles.confidenceIcon}><ShieldCheck aria-hidden="true" /></span><div><h2>Your information.<br />Treated with care.</h2><p>Understand how your information is handled.</p><Link href="/privacy" className={styles.textLink}>Read our privacy policy<ChevronRight aria-hidden="true" /></Link></div></div>
          <div id="pricing" className={`${styles.card} ${styles.confidenceCard}`}><span className={styles.confidenceIcon}><Calendar aria-hidden="true" /></span><div><h2>Your options.<br />Clear before you book.</h2><p>Review services, coverage, and payment choices for your account.</p><Link href={patient+'/login'} className={styles.textLink}>Review your options<ChevronRight aria-hidden="true" /></Link></div></div>
        </section>

        <section className={`${styles.section} ${styles.finalSection}`} aria-labelledby="next-step-heading"><div className={styles.finalCard}><div><p className={styles.eyebrow}>YOUR CARE. CONNECTED.</p><h2 id="next-step-heading">Feel good about<br />your next step.</h2></div><div className={styles.finalActions}><Link href={findCare} className={styles.primaryAction}>Find care<ArrowRight aria-hidden="true" /></Link><Link href={patient+'/login'} className={styles.textLink}>Already with DoctaRx? Sign in<ChevronRight aria-hidden="true" /></Link></div></div></section>
      </div>
    </main>
  </div>;
}
