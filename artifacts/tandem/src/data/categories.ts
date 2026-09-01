import {
  PiCompass,
  PiHeadphones,
  PiMicrophoneStage,
  PiPalette,
  PiPenNib,
  PiRadio,
  PiVideoCamera,
} from 'react-icons/pi';
import type { IconType } from 'react-icons';

export type TandemCategory = {
  slug: string;
  name: string;
  shortName: string;
  description: string;
  status: 'Available' | 'Coming Soon';
  icon: IconType;
  accent: 'coral' | 'teal' | 'gold' | 'plum' | 'blue' | 'ink';
};

export const tandemCategories: TandemCategory[] = [
  {
    slug: 'authors',
    name: 'Authors & Writers',
    shortName: 'Authors',
    description: 'Write beside a stranger. Find the sentence that was waiting for both of you.',
    status: 'Available',
    icon: PiPenNib,
    accent: 'coral',
  },
  {
    slug: 'content-creators',
    name: 'Content Creators',
    shortName: 'Creators',
    description: 'Turn raw footage into publish-ready masters with a four-role relay. The clips stay locked in the room.',
    status: 'Available',
    icon: PiVideoCamera,
    accent: 'blue',
  },
  {
    slug: 'singers',
    name: 'Singers & Vocalists',
    shortName: 'Singers',
    description: 'Trade a melody before you know what the other voice sounds like.',
    status: 'Coming Soon',
    icon: PiMicrophoneStage,
    accent: 'teal',
  },
  {
    slug: 'djs',
    name: 'DJs & Producers',
    shortName: 'DJs',
    description: 'Build a set from two instincts, connected without a shared brief.',
    status: 'Coming Soon',
    icon: PiHeadphones,
    accent: 'gold',
  },
  {
    slug: 'artists',
    name: 'Visual Artists',
    shortName: 'Artists',
    description: 'Let two visual languages meet in the middle of the canvas.',
    status: 'Coming Soon',
    icon: PiPalette,
    accent: 'plum',
  },
  {
    slug: 'storytellers',
    name: 'Storytellers & Podcasters',
    shortName: 'Storytellers',
    description: 'Follow the thread another voice leaves in the room.',
    status: 'Coming Soon',
    icon: PiRadio,
    accent: 'blue',
  },
  {
    slug: 'explore',
    name: 'Explore All',
    shortName: 'Explore',
    description: 'A wider house for every way people make meaning together.',
    status: 'Coming Soon',
    icon: PiCompass,
    accent: 'ink',
  },
];

export function getTandemCategory(slug?: string) {
  return tandemCategories.find((category) => category.slug === slug);
}
