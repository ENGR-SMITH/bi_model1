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
    colorPrimary: '#e55b4c',
    colorForeground: '#292b45',
    colorMutedForeground: '#77717a',
    colorBackground: '#fff4e6',
    colorInput: '#f7eddf',
    colorInputForeground: '#292b45',
    colorNeutral: '#d6cbb9',
    fontFamily: 'Manrope, sans-serif',
    borderRadius: '0.85rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#fff4e6] border-2 border-[#d6cbb9] rounded-[1.5rem] w-[440px] max-w-full overflow-hidden shadow-[10px_12px_0_rgba(41,43,69,0.10)]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#292b45] font-extrabold tracking-[-0.05em]',
    headerSubtitle: 'text-[#77717a]',
    socialButtonsBlockButtonText: 'text-[#292b45] font-bold',
    formFieldLabel: 'text-[#625f6d] font-bold',
    footerActionLink: 'text-[#e55b4c] font-bold',
    footerActionText: 'text-[#77717a]',
    dividerText: 'text-[#77717a]',
    logoBox: 'hidden',
    socialButtonsBlockButton: 'border-2 border-[#d6cbb9] bg-[#f7eddf] hover:bg-[#ebe0d0]',
    formButtonPrimary: 'bg-[#292b45] text-[#fff4e6] hover:bg-[#3e8074] font-bold',
    formFieldInput: 'border-2 border-[#d6cbb9] bg-[#f7eddf] text-[#292b45] focus:border-[#e55b4c]',
    alert: 'border-2 border-[#e55b4c] bg-[#fbe4dc]',
    alertText: 'text-[#8e342b]',
    formFieldSuccessText: 'text-[#3e8074]',
    identityPreviewEditButton: 'text-[#e55b4c] font-bold',
    dividerLine: 'bg-[#d6cbb9]',
    main: 'gap-5',
  },
};

export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="paper-noise atrium-grid flex min-h-[100dvh] flex-col items-center px-5 py-7 sm:px-8 sm:py-10">
      <div className="flex w-full max-w-[1060px] items-center justify-between">
        <TandemLogo />
        <Link href="/" className="focus-house inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-bold text-[#625f6d] hover:bg-[#ebe0d0]" data-testid="link-auth-back-home">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to the house
        </Link>
      </div>
      <div className="grid w-full max-w-[1060px] flex-1 items-center gap-10 py-12 lg:grid-cols-[.78fr_1fr] lg:gap-20">
        <div className="hidden lg:block">
          <p className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-[#e55b4c]">A private door</p>
          <h1 className="mt-6 max-w-[8ch] text-7xl font-extrabold leading-[.86] tracking-[-0.08em] text-[#292b45]">Come in, there&apos;s room.</h1>
          <p className="mt-7 max-w-[20rem] text-sm leading-[1.8] text-[#625f6d]">Tandem is where unfinished ideas find the person who can change their shape.</p>
          <div className="mt-10 h-2 w-20 rounded-full bg-[#f0c85c]" />
        </div>
        <div className="flex justify-center">{children}</div>
      </div>
      <p className="font-mono-ui text-[10px] uppercase tracking-[0.16em] text-[#98909a]">Tandem / a house for creative connection</p>
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