import Image from 'next/image';

export default function PortalPageHeader({ eyebrow = 'DoctaRx', title, description, children, image }) {
  return <section className="portal-page-header relative isolate overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 sm:p-8">
    {image && <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[35%] xl:block"><Image src={image} alt="" fill priority sizes="400px" className="object-cover" /><div className="absolute inset-0 bg-gradient-to-r from-white via-white/50 to-transparent" /></div>}
    <div className={image ? 'relative max-w-3xl xl:max-w-[68%]' : 'relative'}>
      <p className="font-medium text-blue-800">{eyebrow}</p><h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">{title}</h1>
      {description && <p className="mt-3 max-w-2xl leading-7 text-slate-600">{description}</p>}
      {children && <div className="mt-6 flex flex-wrap gap-3">{children}</div>}
    </div>
  </section>;
}
