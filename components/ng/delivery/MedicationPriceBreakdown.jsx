'use client';

import { DeliveryPriceLine } from './DeliveryPresentation';
import MedicationFhirExport from './MedicationFhirExport';

export default function MedicationPriceBreakdown({ checkout }) {
  const { pricing, coordination, pharmacyConfirmedAt, deliveryType, quote } = checkout;
  return <section aria-label="Itemized medication and delivery charges" className="rounded-2xl border border-slate-200 bg-slate-50/80 p-5">
    <h3 className="text-lg font-semibold text-slate-950">Your itemized charges</h3>
    {!pharmacyConfirmedAt && <p className="mt-2 leading-7 text-amber-950">These medicine prices await final pharmacy confirmation. Checkout stays locked until the pharmacist confirms.</p>}
    <dl className="mt-3">
      <DeliveryPriceLine label="Medicines" kobo={pricing.medicinesMinor} />
      <DeliveryPriceLine label={deliveryType === 'pickup' ? 'Courier charge · collection' : 'Actual courier charge'} kobo={pricing.courierMinor} />
      <DeliveryPriceLine label={pricing.feeLabels?.management || 'DoctaRx delivery management'} kobo={pricing.managementMinor} />
      <DeliveryPriceLine label={pricing.feeLabels?.coordination || 'Pharmacy-order coordination'} kobo={pricing.coordinationMinor} />
      <DeliveryPriceLine label="Verified taxes / additional charges" kobo={pricing.taxMinor} />
      <DeliveryPriceLine label="Complete order amount" kobo={pricing.totalMinor} emphasis />
      <DeliveryPriceLine label="Verified insurer portion" kobo={pricing.insurerTotalMinor} />
      <DeliveryPriceLine label="Your total portion" kobo={pricing.patientTotalMinor} emphasis />
    </dl>
    {checkout.pharmacyQuote && <p className={`mt-3 leading-7 ${checkout.pharmacyQuote.expired ? 'text-amber-950' : 'text-slate-600'}`}>{checkout.pharmacyQuote.expired ? 'The pharmacy quote expired. A new pharmacist-confirmed quote is required before payment.' : `Pharmacy quote valid until ${new Date(checkout.pharmacyQuote.expiresAt).toLocaleString()}. The pharmacy receives its confirmed medicine price in full.`}</p>}
    {deliveryType === 'delivery' && !quote && <p className="mt-3 leading-7 text-slate-600">The complete amount awaits a live courier quote after pharmacy preparation. The displayed delivery service fee and future courier fare are excluded from a medicine-only payment.</p>}
    {coordination?.includedElsewhere && <p className="mt-3 leading-7 text-slate-600">The coordination service is included elsewhere; it is not charged a second time.</p>}
    {coordination?.authorized && coordination.payer === 'insurer' && <p className="mt-3 leading-7 text-blue-900">The separately authorized coordination service is recorded as an insurer receivable.</p>}
    <p className="mt-3 leading-7 text-slate-600">Insurer amounts appear only after a benefit has been verified and authorized. Payment status is confirmed by the payment provider.</p>
    {pharmacyConfirmedAt && <MedicationFhirExport orderId={checkout.orderId} />}
  </section>;
}
