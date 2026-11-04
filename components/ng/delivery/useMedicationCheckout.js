'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { deliveryError, getMedicationCheckout, hostedMedicationPaymentUrl, mutateMedicationCheckout, requestKey } from '@/lib/ngDeliveryApi';

export default function useMedicationCheckout(orderId, pharmacyId, onChanged) {
  const [checkout, setCheckout] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const controller = useRef(null);
  const active = useRef(false);
  const sequence = useRef(0);
  const writeLock = useRef(false);
  const keys = useRef(new Map());
  const changed = useRef(onChanged); changed.current = onChanged;

  const load = useCallback(async () => {
    if (writeLock.current) return;
    controller.current?.abort();
    const next = new AbortController(); controller.current = next;
    const current = ++sequence.current;
    setLoading(true); setError(''); setCheckout(null);
    try {
      const result = await getMedicationCheckout(orderId, pharmacyId, next.signal);
      if (active.current && !next.signal.aborted && current === sequence.current) setCheckout(result);
    } catch (failure) {
      if (active.current && !next.signal.aborted && current === sequence.current) setError(deliveryError(failure));
    } finally {
      if (active.current && !next.signal.aborted && current === sequence.current) setLoading(false);
    }
  }, [orderId, pharmacyId]);

  useEffect(() => {
    active.current = true; load();
    return () => { active.current = false; controller.current?.abort(); };
  }, [load]);

  const mutate = async (action, payload = {}) => {
    if (writeLock.current || !checkout || !active.current) return false;
    writeLock.current = true; setBusy(true); setError(''); setNotice('');
    const intent = JSON.stringify([action, checkout.version, payload]);
    try {
      if (!keys.current.has(intent)) keys.current.set(intent, requestKey());
      const result = await mutateMedicationCheckout(orderId, pharmacyId, action, { version: checkout.version, ...payload, idempotencyKey: keys.current.get(intent) }, controller.current?.signal);
      if (!active.current || controller.current?.signal.aborted) return false;
      if (action === 'pay') {
        const url = hostedMedicationPaymentUrl(result);
        window.location.assign(url);
      } else {
        setCheckout(result); keys.current.delete(intent);
        setNotice('Your order was updated. Review the current status and charges below.');
        changed.current?.();
      }
      return true;
    } catch (failure) {
      if (active.current && !controller.current?.signal.aborted) setError(deliveryError(failure));
      return false;
    } finally {
      writeLock.current = false;
      if (active.current) setBusy(false);
    }
  };

  return { checkout, loading, busy, error, notice, load, mutate };
}
