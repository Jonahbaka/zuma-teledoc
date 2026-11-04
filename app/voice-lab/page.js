import { notFound } from 'next/navigation';
import VoiceIntakeLab from '@/components/voice/VoiceIntakeLab';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Synthetic voice lab', robots: { index: false, follow: false } };

export default function VoiceLabPage() {
  // The server, not a public browser flag, owns this deployment boundary.
  if (process.env.NODE_ENV !== 'development' || process.env.DOCTARX_VOICE_SYNTHETIC_ENABLED !== 'true') notFound();
  return <VoiceIntakeLab />;
}
