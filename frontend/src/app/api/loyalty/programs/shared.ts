import { z } from "zod";

export const loyaltyProgramSchema = z.object({
  airline: z.string().trim().min(2).max(100),
  current_miles: z.number().int().min(0).max(50000000),
  tier_status: z.string().trim().min(2).max(30),
  next_tier: z.string().trim().min(2).max(30),
  program_name: z.string().trim().min(2).max(150),
  member_number: z.string().trim().min(2).max(80),
  miles_to_next_tier: z.number().int().min(0).max(50000000).optional(),
  planned_origin: z.string().trim().max(10).optional().or(z.literal("")),
  planned_destination: z.string().trim().max(10).optional().or(z.literal("")),
  planned_flight_number: z.string().trim().max(20).optional().or(z.literal("")),
  traveler_name: z.string().trim().max(150).optional().or(z.literal("")),
  traveler_email: z.string().trim().email().max(255).optional().or(z.literal("")),
  traveler_phone: z.string().trim().max(50).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type LoyaltyProgramPayload = z.infer<typeof loyaltyProgramSchema>;

export type LoyaltyProgramMetadata = {
  planned_origin: string | null;
  planned_destination: string | null;
  planned_flight_number: string | null;
  traveler_name: string | null;
  traveler_email: string | null;
  traveler_phone: string | null;
  notes: string | null;
  recommendation_message: string | null;
};

export function toNullableTrimmedString(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function readMetadataString(
  metadata: Record<string, unknown>,
  key: keyof LoyaltyProgramMetadata,
) {
  const value = metadata[key];
  return typeof value === "string" ? value : null;
}

export function parseLoyaltyProgramMetadata(value: unknown): LoyaltyProgramMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      planned_origin: null,
      planned_destination: null,
      planned_flight_number: null,
      traveler_name: null,
      traveler_email: null,
      traveler_phone: null,
      notes: null,
      recommendation_message: null,
    };
  }

  const metadata = value as Record<string, unknown>;
  return {
    planned_origin: readMetadataString(metadata, "planned_origin"),
    planned_destination: readMetadataString(metadata, "planned_destination"),
    planned_flight_number: readMetadataString(metadata, "planned_flight_number"),
    traveler_name: readMetadataString(metadata, "traveler_name"),
    traveler_email: readMetadataString(metadata, "traveler_email"),
    traveler_phone: readMetadataString(metadata, "traveler_phone"),
    notes: readMetadataString(metadata, "notes"),
    recommendation_message: readMetadataString(metadata, "recommendation_message"),
  };
}

export function buildLoyaltyProgramMetadata(
  metadata: Partial<LoyaltyProgramMetadata>,
): LoyaltyProgramMetadata {
  return {
    planned_origin: metadata.planned_origin ?? null,
    planned_destination: metadata.planned_destination ?? null,
    planned_flight_number: metadata.planned_flight_number ?? null,
    traveler_name: metadata.traveler_name ?? null,
    traveler_email: metadata.traveler_email ?? null,
    traveler_phone: metadata.traveler_phone ?? null,
    notes: metadata.notes ?? null,
    recommendation_message: metadata.recommendation_message ?? null,
  };
}

export function buildRecommendationMessage(input: {
  tierStatus: string;
  nextTier: string;
  milesToNextTier?: number;
  plannedOrigin?: string | null;
  plannedDestination?: string | null;
  plannedFlightNumber?: string | null;
}) {
  const tier = input.tierStatus.trim();
  const nextTier = input.nextTier.trim();
  const milesLeft = (input.milesToNextTier ?? 0).toLocaleString();

  const route =
    input.plannedOrigin && input.plannedDestination
      ? `${input.plannedOrigin.toUpperCase()} to ${input.plannedDestination.toUpperCase()}`
      : "your next route";
  const flight = input.plannedFlightNumber?.trim()
    ? ` on ${input.plannedFlightNumber.toUpperCase()}`
    : "";

  if ((input.milesToNextTier ?? 0) > 0) {
    return `You are ${milesLeft} miles away from ${nextTier}. Consider taking ${route}${flight} to move from ${tier} toward ${nextTier} faster.`;
  }

  return `To move from ${tier} to ${nextTier}, consider traveling on ${route}${flight}. We'll save your request and help track progress toward the next tier.`;
}
