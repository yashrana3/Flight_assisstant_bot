import { SignIn } from "@clerk/nextjs";

type SignInPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readRedirectUrl(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] || "/";
  }

  return value || "/";
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = searchParams ? await searchParams : undefined;
  const redirectUrl = readRedirectUrl(params?.redirect_url);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50/30 flex items-center justify-center px-4 py-10">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-[radial-gradient(ellipse,rgba(99,102,241,0.12)_0%,transparent_70%)] pointer-events-none" />
      <div className="relative w-full max-w-md">
        <SignIn
          path="/sign-in"
          routing="path"
          signUpUrl={`/sign-up?redirect_url=${encodeURIComponent(redirectUrl)}`}
          fallbackRedirectUrl={redirectUrl}
          forceRedirectUrl={redirectUrl}
        />
      </div>
    </div>
  );
}
