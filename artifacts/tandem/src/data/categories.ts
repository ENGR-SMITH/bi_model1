import {
  AudioLines,
  Clapperboard,
  Compass,
  Headphones,
  Mic2,
  PenLine,
  Podcast,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type TandemCategory = {
  slug: string;
  name: string;
  shortName: string;
  description: string;
  status: 'Available' | 'Coming Soon';
  icon: LucideIcon;
  accent: 'coral' | 'teal' | 'gold' | 'plum' | 'blue' | 'ink';
};

export const tandemCategories: TandemCategory[] = [
  {
    slug: 'authors',
    name: 'Authors & Writers',
    shortName: 'Authors',
    description: 'Write beside a stranger. Find the sentence that was waiting for both of you.',
    status: 'Available',
    icon: PenLine,
    accent: 'coral',
  },
  {
    slug: 'content-creators',
    name: 'Content Creators',
    shortName: 'Creators',
    description: 'Turn raw footage into publish-ready masters with a four-role relay. The clips stay locked in the room.',
    status: 'Available',
    icon: Clapperboard,
    accent: 'blue',
  },
  {
    slug: 'singers',
    name: 'Singers & Vocalists',
    shortName: 'Singers',
    description: 'Trade a melody before you know what the other voice sounds like.',
    status: 'Coming Soon',
    icon: Mic2,
    accent: 'teal',
  },
  {
    slug: 'djs',
    name: 'DJs & Producers',
    shortName: 'DJs',
    description: 'Build a set from two instincts, connected without a shared brief.',
    status: 'Coming Soon',
    icon: Headphones,
    accent: 'gold',
  },
  {
    slug: 'artists',
    name: 'Visual Artists',
    shortName: 'Artists',
    description: 'Let two visual languages meet in the middle of the canvas.',
    status: 'Coming Soon',
    icon: AudioLines,
    accent: 'plum',
  },
  {
    slug: 'storytellers',
    name: 'Storytellers & Podcasters',
    shortName: 'Storytellers',
    description: 'Follow the thread another voice leaves in the room.',
    status: 'Coming Soon',
    icon: Podcast,
    accent: 'blue',
  },
  {
    slug: 'explore',
    name: 'Explore All',
    shortName: 'Explore',
    description: 'A wider house for every way people make meaning together.',
    status: 'Coming Soon',
    icon: Compass,
    accent: 'ink',
  },
];

export function getTandemCategory(slug?: string) {
  return tandemCategories.find((category) => category.slug === slug);
}