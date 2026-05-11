"use client";

import { useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Download, Trash2, ArrowRight } from "lucide-react";
import { userSettingsSchema, type UserSettingsValues } from "@/lib/validations";

const SELECT_STYLE = {
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236B7280'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
  backgroundPosition: "right 0.75rem center",
  backgroundRepeat: "no-repeat" as const,
  backgroundSize: "1em 1em",
  paddingRight: "2.5rem",
};

const selectClass =
  "h-10 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#0A2140] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent appearance-none cursor-pointer";

export default function SettingsPage() {
  const { user: clerkUser, isLoaded } = useUser();

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    formState: { isSubmitting },
  } = useForm<UserSettingsValues>({
    resolver: zodResolver(userSettingsSchema),
    defaultValues: {
      email_notif: true,
      price_alerts: true,
      sms_updates: false,
      push_notif: true,
      voice_input: true,
      notif_time: "morning",
      ai_style: "friendly",
      two_factor: false,
      language: "english",
      currency: "usd",
      date_format: "mdy",
      time_format: "12",
      theme: "light",
      text_size: "medium",
      high_contrast: false,
      keyboard_nav: true,
    },
  });

  // Load settings from API
  useEffect(() => {
    if (!isLoaded || !clerkUser) return;
    const email = clerkUser.emailAddresses[0]?.emailAddress;
    if (!email) return;

    const load = async () => {
      try {
        // First get DB user ID
        const profileRes = await fetch(
          `/api/user/profile-by-email?email=${encodeURIComponent(email)}`
        );
        if (!profileRes.ok) return;
        const profile = await profileRes.json();

        const settingsRes = await fetch(`/api/user/settings?user_id=${profile.id}`);
        if (!settingsRes.ok) return;
        const settings = await settingsRes.json();
        reset(settings);
      } catch {
        // Non-fatal: keep defaults
      }
    };
    load();
  }, [isLoaded, clerkUser, reset]);

  const onSubmit = async (values: UserSettingsValues) => {
    const email = clerkUser?.emailAddresses[0]?.emailAddress;
    if (!email) {
      toast.error("Not signed in.");
      return;
    }

    const toastId = toast.loading("Saving settings…");
    try {
      // Look up DB user ID
      const profileRes = await fetch(
        `/api/user/profile-by-email?email=${encodeURIComponent(email)}`
      );
      if (!profileRes.ok) throw new Error("Could not find your account.");
      const profile = await profileRes.json();

      const res = await fetch(`/api/user/settings?user_id=${profile.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? "Save failed");

      toast.success("Settings saved!", { id: toastId });
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save settings.",
        { id: toastId }
      );
    }
  };

  // Toggle component — purely presentational, reads/writes via form state
  const Toggle = ({ name }: { name: keyof UserSettingsValues }) => (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <button
          type="button"
          role="switch"
          aria-checked={!!field.value}
          onClick={() => field.onChange(!field.value)}
          className="relative inline-flex h-[22px] w-[42px] flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:ring-offset-2"
          style={{ backgroundColor: field.value ? "#1D4ED8" : "#D1D5DB" }}
        >
          <span
            className="pointer-events-none inline-block h-[18px] w-[18px] transform rounded-full bg-white shadow-md ring-0 transition-transform duration-200 ease-in-out"
            style={{ transform: field.value ? "translateX(20px)" : "translateX(0px)" }}
          />
        </button>
      )}
    />
  );

  const twoFactor = watch("two_factor");

  return (
    <div className="min-h-screen bg-[#FFFFFF] font-sans">
      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="max-w-[800px] mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-24 lg:pb-8"
      >
        {/* Header */}
        <div className="mb-6 sm:mb-10">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-[#0A2140] text-[24px] font-bold mb-2">Settings</h1>
              <p className="text-[#6B7280] text-sm">Manage your preferences and account settings</p>
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="hidden sm:inline-flex items-center gap-2 bg-[#0B5FFF] hover:bg-[#0047CC] disabled:bg-[#93C5FD] text-white text-sm font-medium h-9 px-4 rounded-lg transition-colors cursor-pointer"
            >
              {isSubmitting ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>

        {/* ── Notifications & AI ───────────────────────────────────────────── */}
        <Section title="Notifications & AI" subtitle="Manage how you receive updates and AI behavior">
          <SettingRow label="Email Notifications" desc="Booking confirmations and updates">
            <Toggle name="email_notif" />
          </SettingRow>
          <Divider />
          <SettingRow label="Price Alerts" desc="Get notified of price drops">
            <Toggle name="price_alerts" />
          </SettingRow>
          <Divider />
          <SettingRow label="SMS Updates" desc="Real-time travel updates via text">
            <Toggle name="sms_updates" />
          </SettingRow>
          <Divider />
          <SettingRow label="Push Notifications" desc="Mobile app notifications">
            <Toggle name="push_notif" />
          </SettingRow>
          <Divider />
          <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4">
            <div className="sm:w-52 flex-shrink-0">
              <p className="text-[#0A2140] sm:text-[#9CA3AF] text-[13px] font-medium">
                Notification Time
              </p>
            </div>
            <div className="flex-1">
              <select {...register("notif_time")} className={selectClass} style={SELECT_STYLE}>
                <option value="morning">Morning (8:00 AM – 12:00 PM)</option>
                <option value="afternoon">Afternoon (12:00 PM – 6:00 PM)</option>
                <option value="evening">Evening (6:00 PM – 10:00 PM)</option>
                <option value="anytime">Anytime</option>
              </select>
            </div>
          </div>
          <Divider />
          <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4">
            <div className="sm:w-52 flex-shrink-0">
              <p className="text-[#0A2140] sm:text-[#9CA3AF] text-[13px] font-medium">
                AI Conversation Style
              </p>
            </div>
            <div className="flex-1">
              <select {...register("ai_style")} className={selectClass} style={SELECT_STYLE}>
                <option value="friendly">Friendly &amp; Conversational</option>
                <option value="professional">Professional &amp; Formal</option>
                <option value="concise">Concise &amp; Direct</option>
                <option value="detailed">Detailed &amp; Informative</option>
              </select>
            </div>
          </div>
          <Divider />
          <SettingRow label="Voice Input" desc="Talk to the AI assistant using your voice">
            <Toggle name="voice_input" />
          </SettingRow>
        </Section>

        {/* ── Privacy & Security ───────────────────────────────────────────── */}
        <Section title="Privacy & Security" subtitle="Manage your data and account security">
          <SettingRow label="Two-Factor Authentication" desc="Add an extra layer of security">
            <Toggle name="two_factor" />
          </SettingRow>
          {twoFactor && (
            <div className="bg-[#F0F9FF] border border-[#BAE6FD] rounded-lg px-3 sm:px-4 py-2.5 sm:py-3 mt-2">
              <p className="text-[#0369A1] text-xs">
                Two-factor authentication is enabled. Your account is protected with an additional security code.
              </p>
            </div>
          )}
          <Divider />
          <SettingRow label="Download Your Data" desc="Export all your personal information and travel history">
            <button
              type="button"
              onClick={() => toast.info("Data export coming soon.")}
              className="inline-flex items-center justify-center border border-[#E5E7EB] bg-white hover:bg-[#F9FAFB] text-[#374151] text-sm font-medium h-9 px-4 rounded-lg transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4 mr-2" />
              Download
            </button>
          </SettingRow>
          <Divider />
          <SettingRow label="Clear AI Memory" desc="AI will forget your search history and personalisation data">
            <button
              type="button"
              onClick={() => toast.warning("This will reset AI personalisation. Feature coming soon.")}
              className="inline-flex items-center justify-center border border-[#E5E7EB] bg-white hover:bg-[#F9FAFB] text-[#D97706] text-sm font-medium h-9 px-4 rounded-lg transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Clear
            </button>
          </SettingRow>
          <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-lg px-3 sm:px-4 py-2.5 sm:py-3">
            <p className="text-[#92400E] text-xs">
              Clearing AI memory will reset personalised recommendations but won&apos;t affect your booking history.
            </p>
          </div>
          <Divider />
          <SettingRow label="Delete Account" desc="Permanently delete your account and all associated data">
            <button
              type="button"
              onClick={() => toast.error("Please contact support to delete your account.")}
              className="inline-flex items-center justify-center border border-[#FCA5A5] bg-white text-[#DC2626] hover:bg-[#FEE2E2] text-sm font-medium h-9 px-4 rounded-lg transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </button>
          </SettingRow>
          <div className="bg-[#FEE2E2] border border-[#FECACA] rounded-lg px-3 sm:px-4 py-2.5 sm:py-3">
            <p className="text-[#991B1B] text-xs">
              <strong>Warning:</strong> This action cannot be undone. All bookings, preferences, and loyalty data will be permanently deleted.
            </p>
          </div>
        </Section>

        {/* ── Language & Region ────────────────────────────────────────────── */}
        <Section title="Language & Region" subtitle="Set your language and regional preferences">
          <SelectRow label="Language" name="language" register={register}>
            <option value="english">English</option>
            <option value="spanish">Spanish</option>
            <option value="french">French</option>
            <option value="german">German</option>
            <option value="japanese">Japanese</option>
            <option value="chinese">Chinese (Simplified)</option>
            <option value="arabic">Arabic</option>
            <option value="hindi">Hindi</option>
          </SelectRow>
          <Divider />
          <SelectRow label="Currency" name="currency" register={register}>
            <option value="usd">USD – US Dollar ($)</option>
            <option value="eur">EUR – Euro (€)</option>
            <option value="gbp">GBP – British Pound (£)</option>
            <option value="jpy">JPY – Japanese Yen (¥)</option>
            <option value="cad">CAD – Canadian Dollar (C$)</option>
            <option value="aud">AUD – Australian Dollar (A$)</option>
            <option value="inr">INR – Indian Rupee (₹)</option>
          </SelectRow>
          <Divider />
          <SelectRow label="Date Format" name="date_format" register={register}>
            <option value="mdy">MM/DD/YYYY (US)</option>
            <option value="dmy">DD/MM/YYYY (UK/Europe)</option>
            <option value="ymd">YYYY/MM/DD (ISO)</option>
          </SelectRow>
          <Divider />
          <SelectRow label="Time Format" name="time_format" register={register}>
            <option value="12">12 hour (3:45 PM)</option>
            <option value="24">24 hour (15:45)</option>
          </SelectRow>
        </Section>

        {/* ── Display & Accessibility ──────────────────────────────────────── */}
        <Section title="Display & Accessibility" subtitle="Customise your viewing experience">
          <SelectRow label="Theme" name="theme" register={register}>
            <option value="light">Light Mode</option>
            <option value="dark">Dark Mode</option>
            <option value="auto">Auto (System)</option>
          </SelectRow>
          <Divider />
          <SelectRow label="Text Size" name="text_size" register={register}>
            <option value="small">Small</option>
            <option value="medium">Medium (Default)</option>
            <option value="large">Large</option>
            <option value="xlarge">Extra Large</option>
          </SelectRow>
          <Divider />
          <SettingRow label="High Contrast Mode" desc="Increase text and UI contrast">
            <Toggle name="high_contrast" />
          </SettingRow>
          <Divider />
          <SettingRow label="Keyboard Navigation" desc="Enhanced keyboard shortcuts">
            <Toggle name="keyboard_nav" />
          </SettingRow>
        </Section>

        {/* ── Help & Support ───────────────────────────────────────────────── */}
        <Section title="Help & Support" subtitle="Get help and learn more about Book With AI">
          <HelpLink label="Help Center" desc="Browse articles and tutorials" />
          <HelpLink label="Contact Support" desc="Chat with our support team" />
          <HelpLink label="Report a Bug" desc="Help us improve the app" />
          <div className="border-t border-[#F3F4F6] mt-3 sm:mt-4 pt-3 sm:pt-4 px-3 sm:px-4 flex items-center justify-between">
            <span className="text-[#9CA3AF] text-xs">App Version</span>
            <span className="text-[#0A2140] text-xs font-medium">1.2.5</span>
          </div>
        </Section>

        {/* Mobile save button */}
        <div className="sm:hidden fixed bottom-20 left-0 right-0 px-4 pb-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-[#0B5FFF] hover:bg-[#0047CC] disabled:bg-[#93C5FD] text-white text-sm font-medium h-11 rounded-xl transition-colors"
          >
            {isSubmitting ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6 sm:mb-8">
      <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
        <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-[#E5E7EB]">
          <h2 className="text-[#0A2140] text-base font-semibold">{title}</h2>
          <p className="text-[#6B7280] mt-1 text-xs">{subtitle}</p>
        </div>
        <div className="px-4 sm:px-6 py-4 sm:py-5">
          <div className="space-y-4 sm:space-y-5">{children}</div>
        </div>
      </div>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-[#F3F4F6]" />;
}

function SettingRow({
  label,
  desc,
  children,
}: {
  label: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-[#0A2140] text-[13px] font-medium">{label}</p>
        <p className="text-[#9CA3AF] text-xs mt-0.5">{desc}</p>
      </div>
      {children}
    </div>
  );
}

function SelectRow({
  label,
  name,
  register,
  children,
}: {
  label: string;
  name: string;
  register: ReturnType<typeof useForm<UserSettingsValues>>["register"];
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4">
      <div className="sm:w-40 flex-shrink-0">
        <p className="text-[#0A2140] sm:text-[#9CA3AF] text-[13px] font-medium">{label}</p>
      </div>
      <div className="flex-1">
        <select
          {...register(name as keyof UserSettingsValues)}
          className="h-10 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#0A2140] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent appearance-none cursor-pointer"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236B7280'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
            backgroundPosition: "right 0.75rem center",
            backgroundRepeat: "no-repeat",
            backgroundSize: "1em 1em",
            paddingRight: "2.5rem",
          }}
        >
          {children}
        </select>
      </div>
    </div>
  );
}

function HelpLink({ label, desc }: { label: string; desc: string }) {
  return (
    <button
      type="button"
      onClick={() => toast.info(`${label} coming soon.`)}
      className="w-full flex items-center justify-between px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg hover:bg-[#F9FAFB] transition-colors text-left cursor-pointer border-none bg-transparent"
    >
      <div className="flex-1 min-w-0">
        <p className="text-[#0A2140] text-[13px] font-medium">{label}</p>
        <p className="text-[#9CA3AF] text-xs mt-0.5">{desc}</p>
      </div>
      <ArrowRight className="w-4 h-4 text-[#9CA3AF] flex-shrink-0 ml-2" />
    </button>
  );
}
