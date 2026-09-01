import { SignIn, SignUp } from '@clerk/react';
import { shadcn } from '@clerk/themes';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'wouter';
import { TandemLogo } from '@/components/tandem-house';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
    socialButtonsPlacement: 'top' as const,
    socialButtonsVariant: 'blockButton' as const,
  },
  variables: {
    colorPrimary: '#f973a8',
    colorForeground: '#fafafa',
    colorMutedForeground: '#71717a',
    colorBackground: '#0a0a0a',
    colorInput: '#111111',
    colorInputForeground: '#fafafa',
    colorNeutral: '#262626',
    fontFamily: 'Inter, sans-serif',
    borderRadius: '0.75rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#111111] border border-white/10 rounded-2xl w-[440px] max-w-full overflow-hidden shadow-2xl',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-white font-bold tracking-[-0.04em]',
    headerSubtitle: 'text-zinc-500',
    socialButtonsBlockButtonText: 'text-white font-semibold',
    formFieldLabel: 'text-zinc-400 font-medium',
    footerActionLink: 'text-[#f973a8] font-semibold',
    footerActionText: 'text-zinc-500',
    dividerText: 'text-zinc-500',
    logoBox: 'hidden',
    socialButtonsBlockButton: 'border border-white/10 bg-[#111111] hover:bg-[#161616]',
    formButtonPrimary: 'bg-white text-black hover:bg-zinc-200 font-semibold',
    formFieldInput: 'border border-white/10 bg-[#111111] text-white focus:border-[#f973a8]',
    alert: 'border border-[#f973a8]/40 bg-[#f973a8]/10',
    alertText: 'text-[#f9a8d4]',
    formFieldSuccessText: 'text-[#34d399]',
    identityPreviewEditButton: 'text-[#3b82f6] font-semibold',
    dividerLine: 'bg-white/10',
    main: 'gap-5',
  },
};

export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="tandem-public atrium-grid flex min-h-[100dvh] flex-col items-center px-5 py-7 sm:px-8 sm:py-10">
      <div className="flex w-full max-w-[1060px] items-center justify-between">
        <TandemLogo />
        <Link href="/" className="focus-house inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100" data-testid="link-auth-back-home">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to the house
        </Link>
      </div>
      <div className="grid w-full max-w-[1060px] flex-1 items-center gap-10 py-12 lg:grid-cols-[.78fr_1fr] lg:gap-20">
        <div className="hidden lg:block">
          <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#3b82f6]">A private door</p>
          <h1 className="mt-6 max-w-[8ch] text-7xl font-bold leading-[.9] tracking-[-0.05em] text-white">Come in, there&apos;s room.</h1>
          <p className="mt-7 max-w-[20rem] text-sm leading-[1.8] text-zinc-400">Tandem is where unfinished ideas find the person who can change their shape.</p>
           <div className="mt-10 h-1 w-20 rounded-full bg-gradient-to-r from-[#f973a8] to-transparent" />
        </div>
        <div className="flex justify-center">{children}</div>
      </div>
      <p className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-zinc-600">Tandem / a house for creative connection</p>
    </main>
  );
}

export function SignInPage() {
  return (
    <AuthFrame>
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} appearance={clerkAppearance} />
    </AuthFrame>
  );
}

export function SignUpPage() {
  return (
    <AuthFrame>
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} appearance={clerkAppearance} />
    </AuthFrame>
  );
}
