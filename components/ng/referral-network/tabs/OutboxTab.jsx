'use client';
import ReferralList from './ReferralList';
export default function OutboxTab() {
  return <ReferralList mode="outbox" emptyHint="You haven't sent any referrals yet." />;
}
