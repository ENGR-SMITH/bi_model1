import { ArrowUpRight, DoorOpen } from 'lucide-react';
import { useUser } from '@clerk/react';
import { Link } from 'wouter';
import { SectionEyebrow } from '@/components/protected-shell';
import { tandemCategories } from '@/data/categories';

const accentClasses = {
  coral: 'bg-[#e55b4c] border-[#c7473c] text-[#fff4e6]',
  teal: 'bg-[#3e8074] border-[#2f675e] text-[#fff4e6]',
  gold: 'bg-[#e1b956] border-[#c49a38] text-[#292b45]',
  plum: 'bg-[#75617f] border-[#5c4a66] text-[#fff4e6]',
  blue: 'bg-[#657a9c] border-[#4e6486] text-[#fff4e6]',
  ink: 'bg-[#292b45] border-[#1d1f34] text-[#fff4e6]',
} as const;

export default function Dashboard() {
  const { user } = useUser();
  const name = user?.firstName || user?.username || 'maker';

  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="reveal flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
        <div>
          <SectionEyebrow>The private atrium / six doors</SectionEyebrow>
          <h1 className="mt-5 max-w-[10ch] text-6xl font-extrabold leading-[.86] tracking-[-0.08em] text-[#292b45] sm:text-8xl">Welcome, {name}.</h1>
        </div>
        <div className="max-w-[23rem] border-l-2 border-[#d6cbb9] pl-5 text-sm leading-[1.8] text-[#625f6d]">
          <p>The house is opening one room at a time. Start where your practice already has a pulse.</p>
        </div>
      </div>

      <div className="reveal reveal-1 mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {tandemCategories.map((category, index) => {
          const Icon = category.icon;
          const available = category.status === 'Available';
          return (
            <Link
              key={category.slug}
              href={`/categories/${category.slug}`}
              className={`soft-lift focus-house group relative min-h-[272px] overflow-hidden rounded-[1.5rem] border-2 p-6 ${accentClasses[category.accent]} ${available ? 'door-shadow' : 'opacity-90'}`}
              data-testid={`card-category-${category.slug}`}
            >
              <span className="absolute -right-10 -top-12 h-36 w-36 rounded-full border border-current opacity-20 transition-transform duration-500 group-hover:scale-125" />
              <span className="absolute right-6 top-6 font-mono-ui text-[10px] uppercase tracking-[0.16em] opacity-65">{String(index + 1).padStart(2, '0')} / 06</span>
              <div className="relative flex h-full flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full border border-current bg-black/5">
                    <Icon className="h-5 w-5" strokeWidth={1.7} />
                  </span>
                  <span className={`rounded-full border border-current px-2.5 py-1 font-mono-ui text-[9px] uppercase tracking-[0.13em] ${available ? 'bg-[#fff4e6]/15' : 'bg-black/10'}`}>
                    {category.status}
                  </span>
                </div>
                <div className="mt-12">
                  <p className="font-mono-ui text-[10px] uppercase tracking-[0.16em] opacity-70">{available ? 'The first light' : 'On the blueprint'}</p>
                  <h2 className="mt-2 max-w-[13ch] text-3xl font-extrabold leading-[.95] tracking-[-0.06em]">{category.name}</h2>
                  <p className="mt-3 max-w-[19rem] text-sm leading-relaxed opacity-85">{category.description}</p>
                </div>
                <span className="absolute bottom-0 right-0 flex h-9 w-9 items-center justify-center rounded-full border border-current opacity-75 transition-transform group-hover:rotate-45">
                  <ArrowUpRight className="h-4 w-4" />
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="reveal reveal-2 mt-16 grid gap-5 border-t-2 border-[#d6cbb9] pt-7 sm:grid-cols-[auto_1fr] sm:items-center">
        <DoorOpen className="h-7 w-7 text-[#e55b4c]" strokeWidth={1.5} />
        <p className="max-w-2xl text-sm leading-relaxed text-[#77717a]">Every room starts with two. Tandem keeps the contribution visible, the connection human, and the strange route an idea took intact.</p>
      </div>
    </div>
  );
}