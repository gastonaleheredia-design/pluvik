import { createFileRoute } from '@tanstack/react-router';
import { ProfileScreen } from '@/components/ProfileScreen';

export const Route = createFileRoute('/profile')({
  component: () => <ProfileScreen />,
});
