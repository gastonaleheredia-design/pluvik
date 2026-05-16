import { createFileRoute } from '@tanstack/react-router';
import { ProfileScreen } from '@/components/ProfileScreen';

export const Route = createFileRoute('/profile/$username')({
  component: ProfileRoute,
});

function ProfileRoute() {
  const { username } = Route.useParams();
  return <ProfileScreen username={username} />;
}
