import { z } from "zod";

// ─── Auth Schemas ─────────────────────────────────────────────────────────────

export const signInSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Enter a valid email address"),
  password: z
    .string()
    .min(1, "Password is required")
    .min(6, "Password must be at least 6 characters"),
});
export type SignInFormValues = z.infer<typeof signInSchema>;

export const signUpStep1Schema = z.object({
  full_name: z
    .string()
    .min(2, "Full name must be at least 2 characters")
    .max(100, "Full name is too long"),
  email: z
    .string()
    .min(1, "Email is required")
    .email("Enter a valid email address"),
});
export type SignUpStep1Values = z.infer<typeof signUpStep1Schema>;

export const otpSchema = z.object({
  otp: z
    .string()
    .min(4, "OTP must be at least 4 digits")
    .max(6, "OTP must be at most 6 digits")
    .regex(/^\d+$/, "OTP must contain digits only"),
});
export type OtpFormValues = z.infer<typeof otpSchema>;

// Standalone password field — use this when you need to extend another schema
// (.refine() returns ZodEffects which has no .shape, so it can't be .extend()-ed)
export const passwordFieldSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number");

// Full password form including confirmation — use this in sign-up step 3
export const passwordSchema = z
  .object({
    password: passwordFieldSchema,
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
export type PasswordFormValues = z.infer<typeof passwordSchema>;

// ─── Profile Schemas ──────────────────────────────────────────────────────────

export const personalInfoSchema = z.object({
  first_name: z
    .string()
    .min(1, "First name is required")
    .max(100, "First name is too long"),
  last_name: z
    .string()
    .max(100, "Last name is too long")
    .optional()
    .or(z.literal("")),
  email: z
    .string()
    .min(1, "Email is required")
    .email("Enter a valid email address"),
  phone: z
    .string()
    .max(20, "Phone number is too long")
    .regex(/^[0-9+\-\s()]*$/, "Enter a valid phone number")
    .optional()
    .or(z.literal("")),
  date_of_birth: z.string().optional().or(z.literal("")),
  gender: z
    .enum(["Male", "Female", "Other", ""])
    .optional(),
  nationality: z.string().max(100).optional().or(z.literal("")),
  address: z.string().max(500).optional().or(z.literal("")),
});
export type PersonalInfoValues = z.infer<typeof personalInfoSchema>;

export const travelPreferenceSchema = z.object({
  seat_preference: z
    .enum(["Window", "Aisle", "Middle", "No preference", ""])
    .optional(),
  meal_preference: z
    .enum(["No preference", "Vegetarian", "Vegan", "Halal", "Kosher", "Gluten-free", ""])
    .optional(),
  cabin_class: z
    .enum(["Economy", "Premium Economy", "Business", "First", ""])
    .optional(),
  preferred_airlines: z.array(z.string()).optional(),
  travel_style: z
    .enum(["Budget Optimized", "Balanced", "Comfort Optimized", ""])
    .optional(),
  flight_timing: z.array(z.string()).optional(),
  layover_preference: z
    .enum(["Direct flights only", "Max 1 Stop", "Max 2 Stops", "No preference", ""])
    .optional(),
  max_layover_time: z
    .enum(["2 hours", "4 hours", "6 hours", "No restriction", ""])
    .optional(),
  airport_preference: z.array(z.string()).optional(),
  special_assistance: z
    .enum(["None", "Wheelchair assistance", "Extra legroom required", "Traveling with infant", "Medical assistance", ""])
    .optional(),
});
export type TravelPreferenceValues = z.infer<typeof travelPreferenceSchema>;

// ─── Settings Schema ──────────────────────────────────────────────────────────

export const userSettingsSchema = z.object({
  email_notif: z.boolean(),
  price_alerts: z.boolean(),
  sms_updates: z.boolean(),
  push_notif: z.boolean(),
  voice_input: z.boolean(),
  notif_time: z.enum(["morning", "afternoon", "evening", "anytime"]),
  ai_style: z.enum(["friendly", "professional", "concise", "detailed"]),
  two_factor: z.boolean(),
  language: z.string(),
  currency: z.string(),
  date_format: z.enum(["mdy", "dmy", "ymd"]),
  time_format: z.enum(["12", "24"]),
  theme: z.enum(["light", "dark", "auto"]),
  text_size: z.enum(["small", "medium", "large", "xlarge"]),
  high_contrast: z.boolean(),
  keyboard_nav: z.boolean(),
});
export type UserSettingsValues = z.infer<typeof userSettingsSchema>;
