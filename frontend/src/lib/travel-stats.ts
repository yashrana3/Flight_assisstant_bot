import { randomUUID } from "crypto";

import { prisma } from "@/lib/prisma";

type AchievementSeed = {
  name: string;
  description: string;
  icon: string;
};

const ACHIEVEMENTS: AchievementSeed[] = [
  { name: "Frequent Flyer", description: "Completed 20+ flights", icon: "Plane" },
  { name: "Globe Trotter", description: "Visited 10+ countries", icon: "Globe" },
  { name: "Early Bird", description: "Took multiple early morning flights", icon: "Sunrise" },
  { name: "Lounge Access", description: "Premium travel member", icon: "Star" },
  { name: "Long Haul Hero", description: "Completed 10+ international flights", icon: "Trophy" },
  { name: "Miles Master", description: "Flew 50,000+ miles", icon: "TrendingUp" },
];

type AchievementRow = {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
};

type UserAchievementRow = {
  achievement_id: string;
};

function normalizePlace(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function getTravelLevel(totalMiles: number) {
  if (totalMiles >= 100000) return { travel_level: "Voyager", level_number: 6 };
  if (totalMiles >= 75000) return { travel_level: "Adventurer", level_number: 5 };
  if (totalMiles >= 50000) return { travel_level: "Explorer", level_number: 4 };
  if (totalMiles >= 25000) return { travel_level: "Navigator", level_number: 3 };
  if (totalMiles >= 10000) return { travel_level: "Wanderer", level_number: 2 };
  return { travel_level: "Traveler", level_number: 1 };
}

export async function recomputeTravelStatsForUser(userId: string) {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const yearStart = new Date(Date.UTC(currentYear, 0, 1));

  type TripStatRow = {
    destination: string | null;
    departure_at: Date | null;
    cabin_class: string | null;
    created_at: Date | null;
  };
  type ItineraryStatRow = {
    destinations: string[] | null;
  };

  const [existingStats, preference] = await Promise.all([
    prisma.travelStats.findUnique({
      where: { user_id: userId },
    }),
    prisma.travelPreference.findFirst({
      where: { user_id: userId },
      orderBy: { updated_at: "desc" },
      select: { travel_style: true },
    }),
  ]);

  let trips: TripStatRow[] = [];
  try {
    trips = await prisma.$queryRaw<TripStatRow[]>`
      SELECT
        destination_label::text AS destination,
        departure_at AS departure_at,
        cabin_class::text AS cabin_class,
        created_at AS created_at
      FROM trips
      WHERE user_id = ${userId}
    `;
  } catch {
    try {
      trips = await prisma.$queryRaw<TripStatRow[]>`
        SELECT
          destination::text AS destination,
          "departureDate" AS departure_at,
          "cabinClass"::text AS cabin_class,
          "createdAt" AS created_at
        FROM trips
        WHERE "userId" = ${userId}
      `;
    } catch {
      trips = [];
    }
  }

  let itineraries: ItineraryStatRow[] = [];
  try {
    itineraries = await prisma.$queryRaw<ItineraryStatRow[]>`
      SELECT destination_labels::text[] AS destinations
      FROM itineraries
      WHERE user_id = ${userId}
    `;
  } catch {
    try {
      itineraries = await prisma.$queryRaw<ItineraryStatRow[]>`
        SELECT destinations::text[] AS destinations
        FROM itineraries
        WHERE "userId" = ${userId}
      `;
    } catch {
      itineraries = [];
    }
  }

  const totalFlights = trips.length;
  const flightsThisYear = trips.filter((trip) => {
    const baseDate = trip.departure_at ?? trip.created_at;
    if (!baseDate) return false;
    return baseDate >= yearStart;
  }).length;

  const visitedPlaces = new Set<string>();
  for (const trip of trips) {
    const destination = normalizePlace(trip.destination);
    if (destination) visitedPlaces.add(destination);
  }
  for (const itinerary of itineraries) {
    for (const destination of itinerary.destinations ?? []) {
      const normalized = normalizePlace(destination);
      if (normalized) visitedPlaces.add(normalized);
    }
  }
  const countriesVisited = visitedPlaces.size;

  let totalMiles = Number(existingStats?.total_miles ?? 0);
  const looksLikeOldSeed =
    Number(existingStats?.total_miles ?? 0) === 47320 &&
    Number(existingStats?.total_flights ?? 0) === 23 &&
    Number(existingStats?.countries_visited ?? 0) === 12;
  if (!existingStats || looksLikeOldSeed) {
    totalMiles = totalFlights * 1200;
  }

  const level = getTravelLevel(totalMiles);
  const travelPersonality =
    preference?.travel_style?.trim() ||
    (countriesVisited >= 10 ? "Globe Trotter" : totalFlights >= 10 ? "Frequent Flyer" : "Traveler");

  const flightYears = Array.from(
    new Set(
      trips
        .map((trip) => (trip.departure_at ?? trip.created_at)?.getUTCFullYear())
        .filter((year): year is number => typeof year === "number" && Number.isFinite(year))
        .filter((year) => Number.isFinite(year)),
    ),
  ).sort((a, b) => b - a);
  let streakYears = 0;
  let expectedYear = currentYear;
  for (const year of flightYears) {
    if (year !== expectedYear) break;
    streakYears += 1;
    expectedYear -= 1;
  }

  const earlyBirdFlights = trips.filter((trip) => {
    const date = trip.departure_at;
    return date ? date.getUTCHours() < 9 : false;
  }).length;
  const premiumTrips = trips.filter((trip) => {
    const cabin = (trip.cabin_class ?? "").toLowerCase();
    return cabin.includes("business") || cabin.includes("first");
  }).length;
  const prefersPremium = ["comfort optimized", "luxury", "premium"].some((token) =>
    (preference?.travel_style ?? "").toLowerCase().includes(token),
  );

  const unlockedByName: Record<string, boolean> = {
    "Frequent Flyer": totalFlights >= 20,
    "Globe Trotter": countriesVisited >= 10,
    "Early Bird": earlyBirdFlights >= 3,
    "Lounge Access": premiumTrips >= 3 || prefersPremium,
    "Long Haul Hero": totalFlights >= 10,
    "Miles Master": totalMiles >= 50000,
  };

  const stats = await prisma.travelStats.upsert({
    where: { user_id: userId },
    create: {
      id: randomUUID(),
      user_id: userId,
      total_flights: totalFlights,
      countries_visited: countriesVisited,
      total_miles: totalMiles,
      travel_level: level.travel_level,
      level_number: level.level_number,
      streak_years: streakYears,
      flights_this_year: flightsThisYear,
      travel_personality: travelPersonality,
      updated_at: now,
    },
    update: {
      total_flights: totalFlights,
      countries_visited: countriesVisited,
      total_miles: totalMiles,
      travel_level: level.travel_level,
      level_number: level.level_number,
      streak_years: streakYears,
      flights_this_year: flightsThisYear,
      travel_personality: travelPersonality,
      updated_at: now,
    },
  });

  const existingAchievements = await prisma.$queryRaw<AchievementRow[]>`
    SELECT id, name, description, icon
    FROM achievements
    WHERE name = ANY(${ACHIEVEMENTS.map((a) => a.name)}::text[])
  `;
  const existingByName = new Map(existingAchievements.map((row) => [row.name, row]));

  for (const seed of ACHIEVEMENTS) {
    if (existingByName.has(seed.name)) continue;
    await prisma.$executeRaw`
      INSERT INTO achievements (id, name, description, icon)
      VALUES (${randomUUID()}::uuid, ${seed.name}, ${seed.description}, ${seed.icon})
      ON CONFLICT (name) DO NOTHING
    `;
  }

  const ensuredAchievements = await prisma.$queryRaw<AchievementRow[]>`
    SELECT id, name, description, icon
    FROM achievements
    WHERE name = ANY(${ACHIEVEMENTS.map((a) => a.name)}::text[])
  `;

  const userUnlocked = await prisma.$queryRaw<UserAchievementRow[]>`
    SELECT achievement_id
    FROM user_achievements
    WHERE user_id = ${userId}
  `;
  const unlockedSet = new Set(userUnlocked.map((row) => row.achievement_id));
  const ensuredByName = new Map(ensuredAchievements.map((row) => [row.name, row]));

  for (const seed of ACHIEVEMENTS) {
    if (!unlockedByName[seed.name]) continue;
    const achievement = ensuredByName.get(seed.name);
    if (!achievement) continue;
    if (unlockedSet.has(achievement.id)) continue;
    await prisma.$executeRaw`
      INSERT INTO user_achievements (id, user_id, achievement_id, unlocked_at)
      VALUES (${randomUUID()}::uuid, ${userId}, ${achievement.id}::uuid, ${now})
      ON CONFLICT DO NOTHING
    `;
    unlockedSet.add(achievement.id);
  }

  const orderedAchievements = ACHIEVEMENTS.map((seed) => {
    const row = ensuredByName.get(seed.name);
    return {
      name: seed.name,
      desc: row?.description ?? seed.description,
      icon: row?.icon ?? seed.icon,
      unlocked: row ? unlockedSet.has(row.id) : Boolean(unlockedByName[seed.name]),
    };
  });

  return {
    stats: {
      total_flights: stats.total_flights ?? 0,
      countries_visited: stats.countries_visited ?? 0,
      total_miles: stats.total_miles ?? 0,
      travel_level: stats.travel_level ?? "Explorer",
      level_number: stats.level_number ?? 1,
      streak_years: stats.streak_years ?? 0,
      flights_this_year: stats.flights_this_year ?? 0,
      travel_personality: stats.travel_personality ?? "Traveler",
    },
    achievements: orderedAchievements,
  };
}

