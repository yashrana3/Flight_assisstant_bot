"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useSignIn } from "@clerk/nextjs";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Eye, EyeOff, Lock, Mail, KeyRound } from "lucide-react";
import { z } from "zod";
import { passwordFieldSchema } from "@/lib/validations";

const requestSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
});

const verifySchema = z.object({
  code: z.string().min(4, "Code is required").max(6, "Code is too long"),
});

const resetSchema = z
  .object({
    password: passwordFieldSchema,
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type RequestValues = z.infer<typeof requestSchema>;
type VerifyValues = z.infer<typeof verifySchema>;
type ResetValues = z.infer<typeof resetSchema>;

export default function ForgotPasswordClient() {
  const router = useRouter();
  const { isLoaded, signIn, setActive } = useSignIn();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [email, setEmail] = useState<string>("");
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const requestForm = useForm<RequestValues>({
    resolver: zodResolver(requestSchema),
  });

  const verifyForm = useForm<VerifyValues>({
    resolver: zodResolver(verifySchema),
  });

  const resetForm = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
  });

  const title = useMemo(() => {
    if (step === 1) return "Reset your password";
    if (step === 2) return "Check your email";
    return "Choose a new password";
  }, [step]);

  const subtitle = useMemo(() => {
    if (step === 1) return "We’ll email you a verification code to reset it.";
    if (step === 2) return `Enter the code sent to ${email || "your email"}.`;
    return "Make sure it’s strong and unique.";
  }, [step, email]);

  const handleRequest = async (values: RequestValues) => {
    if (!isLoaded) return;
    const toastId = toast.loading("Sending reset email…");
    try {
      const result = await signIn.create({
        strategy: "reset_password_email_code",
        identifier: values.email,
      });

      if (result.status !== "needs_first_factor") {
        throw new Error("Unable to start password reset");
      }

      setEmail(values.email);
      setStep(2);
      toast.success("Reset code sent. Check your email.", { id: toastId });
    } catch (err: unknown) {
      const clerkError = err as { errors?: { message: string }[] };
      const message =
        clerkError.errors?.[0]?.message ??
        (err instanceof Error ? err.message : "Failed to send reset email");
      toast.error(message, { id: toastId });
    }
  };

  const handleVerify = async (values: VerifyValues) => {
    if (!isLoaded) return;
    const toastId = toast.loading("Verifying code…");
    try {
      const result = await signIn.attemptFirstFactor({
        strategy: "reset_password_email_code",
        code: values.code,
      });

      if (result.status !== "needs_new_password") {
        throw new Error("Invalid code");
      }

      setStep(3);
      toast.success("Code verified.", { id: toastId });
    } catch (err: unknown) {
      const clerkError = err as { errors?: { message: string }[] };
      const message =
        clerkError.errors?.[0]?.message ??
        (err instanceof Error ? err.message : "Invalid code");
      toast.error(message, { id: toastId });
    }
  };

  const handleReset = async (values: ResetValues) => {
    if (!isLoaded || !setActive) return;
    const toastId = toast.loading("Updating password…");
    try {
      const result = await signIn.resetPassword({
        password: values.password,
        signOutOfOtherSessions: true,
      });

      if (result.status !== "complete" || !result.createdSessionId) {
        throw new Error("Failed to reset password");
      }

      await setActive({ session: result.createdSessionId });
      toast.success("Password updated. Please sign in.", { id: toastId });
      router.push("/sign-in");
    } catch (err: unknown) {
      const clerkError = err as { errors?: { message: string }[] };
      const message =
        clerkError.errors?.[0]?.message ??
        (err instanceof Error ? err.message : "Failed to reset password");
      toast.error(message, { id: toastId });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50/30 flex items-center justify-center px-4">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-[radial-gradient(ellipse,rgba(99,102,241,0.12)_0%,transparent_70%)] pointer-events-none" />

      <div className="w-full max-w-[400px] relative">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white font-bold text-lg shadow-lg group-hover:shadow-indigo-200 transition-shadow">
              B
            </div>
            <span className="font-extrabold text-[18px] text-slate-900 tracking-tight">
              Book With AI
            </span>
          </Link>
        </div>

        <div className="bg-white rounded-3xl border border-slate-200 shadow-[0_8px_40px_rgba(15,23,42,0.08)] p-8">
          <div className="mb-6">
            <h1 className="text-[1.5rem] font-extrabold text-slate-900 tracking-tight mb-1">
              {title}
            </h1>
            <p className="text-[13px] text-slate-500">{subtitle}</p>
          </div>

          {step === 1 && (
            <form
              onSubmit={requestForm.handleSubmit(handleRequest)}
              noValidate
              className="flex flex-col gap-4 text-left"
            >
              <div>
                <label className="text-[12px] font-semibold text-slate-700 mb-1.5 block">
                  Email address
                </label>
                <div
                  className={`flex items-center gap-2.5 bg-slate-50 border rounded-xl px-3.5 py-2.5 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 transition-all ${
                    requestForm.formState.errors.email ? "border-rose-400" : "border-slate-200"
                  }`}
                >
                  <Mail size={15} className="text-slate-400 flex-shrink-0" />
                  <input
                    {...requestForm.register("email")}
                    type="email"
                    placeholder="you@example.com"
                    autoComplete="email"
                    className="flex-1 bg-transparent border-none outline-none text-[14px] text-slate-900 placeholder:text-slate-400"
                  />
                </div>
                {requestForm.formState.errors.email && (
                  <p className="mt-1 text-[11px] text-rose-500">
                    {requestForm.formState.errors.email.message}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={requestForm.formState.isSubmitting || !isLoaded}
                className={`mt-1 w-full py-3 rounded-xl text-white text-[14px] font-bold transition-all active:scale-[0.98] ${
                  !requestForm.formState.isSubmitting
                    ? "bg-gradient-to-br from-indigo-500 to-violet-500 hover:shadow-lg hover:shadow-indigo-200 hover:-translate-y-0.5 cursor-pointer"
                    : "bg-slate-200 text-slate-400 cursor-default"
                }`}
              >
                Send reset code
              </button>

              <Link
                href="/sign-in"
                className="text-[12px] text-slate-500 hover:text-indigo-600 font-medium transition-colors text-center"
              >
                ← Back to sign in
              </Link>
            </form>
          )}

          {step === 2 && (
            <form
              onSubmit={verifyForm.handleSubmit(handleVerify)}
              noValidate
              className="flex flex-col gap-4 text-left"
            >
              <div>
                <label className="text-[12px] font-semibold text-slate-700 mb-1.5 block">
                  Verification code
                </label>
                <div
                  className={`flex items-center gap-2.5 bg-slate-50 border rounded-xl px-3.5 py-2.5 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 transition-all ${
                    verifyForm.formState.errors.code ? "border-rose-400" : "border-slate-200"
                  }`}
                >
                  <KeyRound size={15} className="text-slate-400 flex-shrink-0" />
                  <input
                    {...verifyForm.register("code")}
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="123456"
                    autoComplete="one-time-code"
                    className="flex-1 bg-transparent border-none outline-none text-[18px] tracking-[0.5em] text-center text-slate-900 placeholder:text-slate-300"
                  />
                </div>
                {verifyForm.formState.errors.code && (
                  <p className="mt-1 text-[11px] text-rose-500">
                    {verifyForm.formState.errors.code.message}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={verifyForm.formState.isSubmitting || !isLoaded}
                className={`mt-1 w-full py-3 rounded-xl text-white text-[14px] font-bold transition-all active:scale-[0.98] ${
                  !verifyForm.formState.isSubmitting
                    ? "bg-gradient-to-br from-indigo-500 to-violet-500 hover:shadow-lg hover:shadow-indigo-200 hover:-translate-y-0.5 cursor-pointer"
                    : "bg-slate-200 text-slate-400 cursor-default"
                }`}
              >
                Verify code
              </button>

              <button
                type="button"
                onClick={() => setStep(1)}
                className="text-[12px] text-slate-500 hover:text-indigo-600 font-medium transition-colors text-center"
              >
                ← Use a different email
              </button>
            </form>
          )}

          {step === 3 && (
            <form
              onSubmit={resetForm.handleSubmit(handleReset)}
              noValidate
              className="flex flex-col gap-4 text-left"
            >
              <div>
                <label className="text-[12px] font-semibold text-slate-700 mb-1.5 block">
                  New password
                </label>
                <div
                  className={`flex items-center gap-2.5 bg-slate-50 border rounded-xl px-3.5 py-2.5 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 transition-all ${
                    resetForm.formState.errors.password ? "border-rose-400" : "border-slate-200"
                  }`}
                >
                  <Lock size={15} className="text-slate-400 flex-shrink-0" />
                  <input
                    {...resetForm.register("password")}
                    type={showPass ? "text" : "password"}
                    placeholder="Create a strong password"
                    autoComplete="new-password"
                    className="flex-1 bg-transparent border-none outline-none text-[14px] text-slate-900 placeholder:text-slate-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    className="text-slate-400 hover:text-slate-600 transition-colors"
                    aria-label={showPass ? "Hide password" : "Show password"}
                  >
                    {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {resetForm.formState.errors.password && (
                  <p className="mt-1 text-[11px] text-rose-500">
                    {resetForm.formState.errors.password.message}
                  </p>
                )}
              </div>

              <div>
                <label className="text-[12px] font-semibold text-slate-700 mb-1.5 block">
                  Confirm password
                </label>
                <div
                  className={`flex items-center gap-2.5 bg-slate-50 border rounded-xl px-3.5 py-2.5 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 transition-all ${
                    resetForm.formState.errors.confirmPassword ? "border-rose-400" : "border-slate-200"
                  }`}
                >
                  <Lock size={15} className="text-slate-400 flex-shrink-0" />
                  <input
                    {...resetForm.register("confirmPassword")}
                    type={showConfirm ? "text" : "password"}
                    placeholder="Repeat your password"
                    autoComplete="new-password"
                    className="flex-1 bg-transparent border-none outline-none text-[14px] text-slate-900 placeholder:text-slate-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="text-slate-400 hover:text-slate-600 transition-colors"
                    aria-label={showConfirm ? "Hide password" : "Show password"}
                  >
                    {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {resetForm.formState.errors.confirmPassword && (
                  <p className="mt-1 text-[11px] text-rose-500">
                    {resetForm.formState.errors.confirmPassword.message}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={resetForm.formState.isSubmitting || !isLoaded}
                className={`mt-1 w-full py-3 rounded-xl text-white text-[14px] font-bold transition-all active:scale-[0.98] ${
                  !resetForm.formState.isSubmitting
                    ? "bg-gradient-to-br from-indigo-500 to-violet-500 hover:shadow-lg hover:shadow-indigo-200 hover:-translate-y-0.5 cursor-pointer"
                    : "bg-slate-200 text-slate-400 cursor-default"
                }`}
              >
                Update password
              </button>
            </form>
          )}

          <p className="text-center text-[11px] text-slate-400 mt-6">
            Need an account?{" "}
            <Link href="/sign-up" className="text-indigo-600 font-semibold hover:text-indigo-700">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
