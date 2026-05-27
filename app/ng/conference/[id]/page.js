import RoomDetail from '@/components/ng/conference/RoomDetail';

export const metadata = {
  title: 'Room — DoctaRx Conferencing',
};

export default function RoomPage({ params }) {
  return <RoomDetail roomId={params.id} />;
}
