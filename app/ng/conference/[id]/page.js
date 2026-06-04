import RoomDetail from '@/components/ng/conference/RoomDetail';

export const metadata = {
  title: 'Room — DoctaRx Clinical Video',
};

export default function RoomPage({ params }) {
  return <RoomDetail roomId={params.id} />;
}
