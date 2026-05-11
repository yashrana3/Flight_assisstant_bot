export type LoyaltyProgramOption = {
  value: string;
  airline: string;
  programName: string;
  label: string;
};

const RAW_PROGRAM_OPTIONS: Array<{ airline: string; programName: string }> = [
  { airline: "Aegean Airlines", programName: "Miles+Bonus" },
  { airline: "Aer Lingus", programName: "AerClub" },
  { airline: "Aeromexico", programName: "Rewards" },
  { airline: "Air Arabia", programName: "AirRewards" },
  { airline: "Air Asia", programName: "AirAsia Rewards" },
  { airline: "Air Canada", programName: "Aeroplan" },
  { airline: "Air China", programName: "PhoenixMiles" },
  { airline: "Air Europa", programName: "SUMA" },
  { airline: "Air France", programName: "Flying Blue" },
  { airline: "Air India", programName: "Maharaja Club" },
  { airline: "Air New Zealand", programName: "Airpoints" },
  { airline: "Alaska Airlines", programName: "Mileage Plan" },
  { airline: "American Airlines", programName: "AAdvantage" },
  { airline: "ANA", programName: "Mileage Club" },
  { airline: "Asiana Airlines", programName: "Asiana Club" },
  { airline: "Avianca", programName: "LifeMiles" },
  { airline: "Azul", programName: "Fidelidade" },
  { airline: "British Airways", programName: "Club" },
  { airline: "Cathay Pacific", programName: "Asia Miles" },
  { airline: "China Airlines", programName: "Dynasty Flyer" },
  { airline: "China Eastern", programName: "Eastern Miles" },
  { airline: "China Southern", programName: "Sky Pearl Club" },
  { airline: "Copa Airlines", programName: "ConnectMiles" },
  { airline: "Delta Air Lines", programName: "SkyMiles" },
  { airline: "EgyptAir", programName: "Plus" },
  { airline: "EL AL", programName: "Matmid" },
  { airline: "Emirates", programName: "Skywards" },
  { airline: "Ethiopian Airlines", programName: "ShebaMiles" },
  { airline: "Etihad Airways", programName: "Guest" },
  { airline: "EVA Air", programName: "Infinity MileageLands" },
  { airline: "Finnair", programName: "Plus" },
  { airline: "Frontier Airlines", programName: "Frontier Miles" },
  { airline: "Garuda Indonesia", programName: "GarudaMiles" },
  { airline: "Hainan Airlines", programName: "Fortune Wings Club" },
  { airline: "Hawaiian Airlines", programName: "HawaiianMiles" },
  { airline: "Iberia", programName: "Club" },
  { airline: "IndiGo", programName: "BluChip" },
  { airline: "ITA Airways", programName: "Volare" },
  { airline: "Japan Airlines", programName: "JAL Mileage Bank" },
  { airline: "JetBlue", programName: "TrueBlue" },
  { airline: "Kenya Airways", programName: "Asante Rewards" },
  { airline: "KLM", programName: "Flying Blue" },
  { airline: "Korean Air", programName: "SKYPASS" },
  { airline: "Kuwait Airways", programName: "Oasis Club" },
  { airline: "LATAM Airlines", programName: "LATAM Pass" },
  { airline: "LOT Polish Airlines", programName: "Miles & More" },
  { airline: "Lufthansa", programName: "Miles & More" },
  { airline: "Malaysia Airlines", programName: "Enrich" },
  { airline: "Oman Air", programName: "Sindbad" },
  { airline: "Pegasus Airlines", programName: "BolBol" },
  { airline: "Philippine Airlines", programName: "Mabuhay Miles" },
  { airline: "Porter Airlines", programName: "VIPorter" },
  { airline: "Qantas", programName: "Frequent Flyer" },
  { airline: "Qatar Airways", programName: "Privilege Club" },
  { airline: "Royal Air Maroc", programName: "Safar Flyer" },
  { airline: "Royal Brunei Airlines", programName: "Royal Skies" },
  { airline: "Royal Jordanian", programName: "Royal Club" },
  { airline: "RwandAir", programName: "Dream Miles" },
  { airline: "Saudia", programName: "AlFursan" },
  { airline: "SAS", programName: "EuroBonus" },
  { airline: "Singapore Airlines", programName: "KrisFlyer" },
  { airline: "Southwest Airlines", programName: "Rapid Rewards" },
  { airline: "Spirit Airlines", programName: "Free Spirit" },
  { airline: "SpiceJet", programName: "SpiceClub" },
  { airline: "SriLankan Airlines", programName: "FlySmiLes" },
  { airline: "Sun Country Airlines", programName: "Rewards" },
  { airline: "SWISS", programName: "Miles & More" },
  { airline: "TAP Air Portugal", programName: "Miles&Go" },
  { airline: "Thai Airways", programName: "Royal Orchid Plus" },
  { airline: "Turkish Airlines", programName: "Miles&Smiles" },
  { airline: "United Airlines", programName: "MileagePlus" },
  { airline: "Vietnam Airlines", programName: "Lotusmiles" },
  { airline: "Virgin Atlantic", programName: "Flying Club" },
  { airline: "Virgin Australia", programName: "Velocity Frequent Flyer" },
  { airline: "Vueling", programName: "Club" },
  { airline: "WestJet", programName: "Rewards" },
];

export const CUSTOM_LOYALTY_PROGRAM_VALUE = "__custom__";

export const LOYALTY_PROGRAM_OPTIONS: LoyaltyProgramOption[] = RAW_PROGRAM_OPTIONS.map(
  ({ airline, programName }) => ({
    value: `${airline}::${programName}`,
    airline,
    programName,
    label: `${airline} - ${programName}`,
  }),
);

function normalizeLookupValue(value: string) {
  return value.trim().toLowerCase();
}

export function findLoyaltyProgramOption(value: string) {
  return LOYALTY_PROGRAM_OPTIONS.find((option) => option.value === value) ?? null;
}

export function findLoyaltyProgramOptionByProgram(
  airline: string,
  programName: string,
) {
  const airlineLookup = normalizeLookupValue(airline);
  const programLookup = normalizeLookupValue(programName);

  return (
    LOYALTY_PROGRAM_OPTIONS.find(
      (option) =>
        normalizeLookupValue(option.airline) === airlineLookup &&
        normalizeLookupValue(option.programName) === programLookup,
    ) ?? null
  );
}
