"use client";

import Link from "next/link";
import { Lock, LogIn } from "lucide-react";

type AuthRequiredCardProps = {
  title: string;
  description: string;
  redirectUrl: string;
  loginLabel?: string;
};

export default function AuthRequiredCard({
  title,
  description,
  redirectUrl,
  loginLabel = "Login to continue",
}: AuthRequiredCardProps) {
  const encodedRedirectUrl = encodeURIComponent(redirectUrl);

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#F8FAFC] to-[#F1F5F9]">
      <div className="mx-auto flex min-h-screen max-w-[720px] items-center px-6 py-12">
        <div className="w-full rounded-3xl border border-[#DBEAFE] bg-white p-8 shadow-sm sm:p-10">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#EFF6FF] text-[#1D4ED8]">
            <Lock className="h-6 w-6" />
          </div>
          <div className="mt-6 text-center">
            <h1 className="text-2xl font-bold text-[#0A2140] sm:text-[30px]">
              {title}
            </h1>
            <p className="mt-3 text-sm leading-7 text-[#6B7280] sm:text-base">
              {description}
            </p>
          </div>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link
              href={`/sign-in?redirect_url=${encodedRedirectUrl}`}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1D4ED8] px-5 py-3 text-sm font-medium text-white no-underline transition-colors hover:bg-[#1E40AF]"
            >
              <LogIn className="h-4 w-4" />
              {loginLabel}
            </Link>
            <Link
              href={`/sign-up?redirect_url=${encodedRedirectUrl}`}
              className="inline-flex items-center justify-center rounded-xl border border-[#DBEAFE] px-5 py-3 text-sm font-medium text-[#1D4ED8] no-underline transition-colors hover:bg-[#EFF6FF]"
            >
              Sign up
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
