import {
  PiBroadcastDuotone,
  PiCompassRoseDuotone,
  PiFilmSlateDuotone,
  PiHeadphonesDuotone,
  PiMicrophoneStageDuotone,
  PiPaintBrushBroadDuotone,
  PiPenNibDuotone,
} from 'react-icons/pi';
import type { IconType } from 'react-icons';

export type NexetCategory = {
  slug: string;
  name: string;
  shortName: string;
  description: string;
  status: 'Available' | 'Coming Soon';
  icon: IconType;
  accent: 'coral' | 'teal' | 'gold' | 'plum' | 'blue' | 'ink';
};

export const nexetCategories: NexetCategory[] = [
  {
    slug: 'authors',
    name: 'Authors & Writers',
    shortName: 'Authors',
    description: 'Write beside a stranger. Find the sentence that was waiting for both of you.',
    status: 'Available',
    icon: PiPenNibDuotone,
    accent: 'coral',
  },
  {
    slug: 'content-creators',
    name: 'Content Creators',
    shortName: 'Creators',
    description: 'Turn raw footage into publish-ready masters with a four-role relay. The clips stay locked in the room.',
    status: 'Available',
    icon: PiFilmSlateDuotone,
    accent: 'blue',
  },
  {
    slug: 'singers',
    name: 'Singers & Vocalists',
    shortName: 'Singers',
    description: 'Trade a melody before you know what the other voice sounds like.',
    status: 'Coming Soon',
    icon: PiMicrophoneStageDuotone,
    accent: 'teal',
  },
  {
    slug: 'djs',
    name: 'DJs & Producers',
    shortName: 'DJs',
    description: 'Build a set from two instincts, connected without a shared brief.',
    status: 'Coming Soon',
    icon: PiHeadphonesDuotone,
    accent: 'gold',
  },
  {
    slug: 'artists',
    name: 'Visual Artists',
    shortName: 'Artists',
    description: 'Let two visual languages meet in the middle of the canvas.',
    status: 'Coming Soon',
    icon: PiPaintBrushBroadDuotone,
    accent: 'plum',
  },
  {
    slug: 'storytellers',
    name: 'Storytellers & Podcasters',
    shortName: 'Storytellers',
    description: 'Follow the thread another voice leaves in the room.',
    status: 'Coming Soon',
    icon: PiBroadcastDuotone,
    accent: 'blue',
  },
  {
    slug: 'explore',
    name: 'Explore All',
    shortName: 'Explore',
    description: 'A wider house for every way people make meaning together.',
    status: 'Coming Soon',
    icon: PiCompassRoseDuotone,
    accent: 'ink',
  },
];

// The cards the dashboard shows. Singers, DJs, Artists and Storytellers are
// still only on the blueprint, so their doors live behind /categories/<slug>
// (the waitlist page) instead of taking up a card on the front of the atrium.
const DASHBOARD_SLUGS = ['authors', 'content-creators', 'explore'];

export const nexetDashboardCategories = nexetCategories.filter((category) =>
  DASHBOARD_SLUGS.includes(category.slug),
);

// The rooms that are still only on the blueprint. Explore All is the doorway to
// these, not one of them, so it stays out of the list: the dashboard names them
// inside its Explore All card and the marketing page gives each one its own
// "Upcoming features" card.
export const nexetUpcomingCategories = nexetCategories.filter(
  (category) => category.status === 'Coming Soon' && category.slug !== 'explore',
);

export function getNexetCategory(slug?: string) {
  return nexetCategories.find((category) => category.slug === slug);
}
