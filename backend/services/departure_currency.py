"""Resolve flight-search currency and SerpAPI `gl` from departure airport (IATA).

When the caller does not pass an explicit ISO 4217 currency, we choose one from the
departure airport's country so pricing matches the traveller's home market.
"""

from __future__ import annotations

import os
import re
from typing import Dict, Optional

from services.flight_ai import get_iata

# ISO 3166-1 alpha-2 -> ISO 4217 (primary cash currency for flight retail).
_COUNTRY_TO_CURRENCY: Dict[str, str] = {
    "US": "USD",
    "CA": "CAD",
    "MX": "MXN",
    "GB": "GBP",
    "CH": "CHF",
    "NO": "NOK",
    "SE": "SEK",
    "DK": "DKK",
    "IS": "ISK",
    "PL": "PLN",
    "CZ": "CZK",
    "HU": "HUF",
    "RO": "RON",
    "BG": "BGN",
    "HR": "EUR",
    "RS": "RSD",
    "BA": "BAM",
    "AL": "ALL",
    "MK": "MKD",
    "RU": "RUB",
    "UA": "UAH",
    "TR": "TRY",
    "IL": "ILS",
    "AE": "AED",
    "SA": "SAR",
    "QA": "QAR",
    "KW": "KWD",
    "BH": "BHD",
    "OM": "OMR",
    "JO": "JOD",
    "LB": "LBP",
    "EG": "EGP",
    "MA": "MAD",
    "TN": "TND",
    "ZA": "ZAR",
    "KE": "KES",
    "NG": "NGN",
    "IN": "INR",
    "PK": "PKR",
    "BD": "BDT",
    "LK": "LKR",
    "NP": "NPR",
    "CN": "CNY",
    "HK": "HKD",
    "MO": "MOP",
    "TW": "TWD",
    "JP": "JPY",
    "KR": "KRW",
    "SG": "SGD",
    "MY": "MYR",
    "TH": "THB",
    "VN": "VND",
    "ID": "IDR",
    "PH": "PHP",
    "AU": "AUD",
    "NZ": "NZD",
    "FJ": "FJD",
    "BR": "BRL",
    "AR": "ARS",
    "CL": "CLP",
    "CO": "COP",
    "PE": "PEN",
    "UY": "UYU",
    "ET": "ETB",
    "TZ": "TZS",
    "GH": "GHS",
    "CR": "CRC",
    "PA": "USD",
    "EC": "USD",
    # Eurozone + EUR adopters used for flight shopping
    "AT": "EUR",
    "BE": "EUR",
    "CY": "EUR",
    "EE": "EUR",
    "FI": "EUR",
    "FR": "EUR",
    "DE": "EUR",
    "GR": "EUR",
    "IE": "EUR",
    "IT": "EUR",
    "LV": "EUR",
    "LT": "EUR",
    "LU": "EUR",
    "MT": "EUR",
    "NL": "EUR",
    "PT": "EUR",
    "SK": "EUR",
    "SI": "EUR",
    "ES": "EUR",
    "VA": "EUR",
    "AD": "EUR",
    "MC": "EUR",
    "SM": "EUR",
    "ME": "EUR",
}

# IATA (uppercase) -> ISO 3166-1 alpha-2. Curated global coverage; unknown -> fallback.
_IATA_COUNTRY_PAIRS = (
    # United States
    "JFK", "US", "EWR", "US", "LGA", "US", "IAD", "US", "DCA", "US", "BWI", "US",
    "ORD", "US", "MDW", "US", "ATL", "US", "LAX", "US", "SFO", "US", "SEA", "US",
    "DEN", "US", "LAS", "US", "PHX", "US", "DFW", "US", "DAL", "US", "IAH", "US", "HOU", "US",
    "MIA", "US", "FLL", "US", "MCO", "US", "TPA", "US", "BOS", "US", "DTW", "US", "MSP", "US",
    "PDX", "US", "SLC", "US", "SAN", "US", "SJC", "US", "OAK", "US", "SMF", "US", "STL", "US",
    "CLT", "US", "RDU", "US", "BNA", "US", "AUS", "US", "MSY", "US", "HNL", "US", "OGG", "US",
    "ANC", "US", "PHL", "US", "PIT", "US", "CLE", "US", "CVG", "US", "IND", "US", "CMH", "US",
    "MCI", "US", "MEM", "US", "OKC", "US", "TUL", "US", "OMA", "US", "DSM", "US", "SAT", "US",
    "ELP", "US", "ABQ", "US", "TUS", "US", "BOI", "US", "GEG", "US", "RNO", "US", "BUF", "US",
    "MKE", "US", "JAX", "US", "RSW", "US", "PBI", "US", "CHS", "US", "SAV", "US", "ORF", "US",
    "RIC", "US", "ALB", "US", "SYR", "US", "ROC", "US", "PVD", "US", "BDL", "US",
    # Canada
    "YYZ", "CA", "YVR", "CA", "YUL", "CA", "YYC", "CA", "YEG", "CA", "YOW", "CA", "YHZ", "CA",
    "YWG", "CA",
    # Mexico
    "MEX", "MX", "CUN", "MX", "GDL", "MX", "MTY", "MX",
    # United Kingdom
    "LHR", "GB", "LGW", "GB", "STN", "GB", "LTN", "GB", "MAN", "GB", "EDI", "GB", "GLA", "GB",
    "BHX", "GB", "BRS", "GB", "NCL", "GB",
    # Ireland
    "DUB", "IE", "ORK", "IE", "SNN", "IE",
    # France
    "CDG", "FR", "ORY", "FR", "BVA", "FR", "NCE", "FR", "LYS", "FR", "MRS", "FR", "TLS", "FR",
    "BOD", "FR", "NTE", "FR",
    # Germany
    "FRA", "DE", "MUC", "DE", "BER", "DE", "DUS", "DE", "CGN", "DE", "HAM", "DE", "STR", "DE",
    "TXL", "DE", "LEJ", "DE", "NUE", "DE",
    # Netherlands
    "AMS", "NL", "EIN", "NL", "RTM", "NL",
    # Belgium
    "BRU", "BE", "CRL", "BE",
    # Luxembourg
    "LUX", "LU",
    # Spain
    "MAD", "ES", "BCN", "ES", "AGP", "ES", "VLC", "ES", "PMI", "ES", "SVQ", "ES", "BIO", "ES",
    # Portugal
    "LIS", "PT", "OPO", "PT", "FAO", "PT",
    # Italy
    "FCO", "IT", "MXP", "IT", "LIN", "IT", "VCE", "IT", "NAP", "IT", "BLQ", "IT", "CTA", "IT",
    # Switzerland
    "ZRH", "CH", "GVA", "CH", "BSL", "CH",
    # Austria
    "VIE", "AT", "SZG", "AT", "INN", "AT",
    # Greece
    "ATH", "GR", "SKG", "GR",
    # Nordic
    "ARN", "SE", "GOT", "SE", "OSL", "NO", "BGO", "NO", "TRD", "NO",
    "CPH", "DK", "BLL", "DK", "HEL", "FI", "KEF", "IS",
    # Poland
    "WAW", "PL", "KRK", "PL", "GDN", "PL",
    # Czech / Hungary / Romania
    "PRG", "CZ", "BUD", "HU", "OTP", "RO",
    # Croatia / Slovenia / Serbia
    "ZAG", "HR", "SPU", "HR", "DBV", "HR", "LJU", "SI", "BEG", "RS",
    # Turkey
    "IST", "TR", "SAW", "TR", "AYT", "TR", "ESB", "TR",
    # Russia (common hubs)
    "SVO", "RU", "DME", "RU", "LED", "RU", "VKO", "RU",
    # Ukraine
    "KBP", "UA", "ODS", "UA",
    # Middle East
    "DXB", "AE", "AUH", "AE", "SHJ", "AE", "DWC", "AE",
    "DOH", "QA", "RUH", "SA", "JED", "SA", "DMM", "SA", "BAH", "BH", "KWI", "KW", "MCT", "OM",
    "AMM", "JO", "BEY", "LB", "TLV", "IL",
    # Africa
    "CAI", "EG", "CMN", "MA", "TUN", "TN", "ADD", "ET", "NBO", "KE", "DAR", "TZ",
    "JNB", "ZA", "CPT", "ZA", "LOS", "NG", "ACC", "GH",
    # South Asia
    "DEL", "IN", "BOM", "IN", "BLR", "IN", "MAA", "IN", "CCU", "IN", "HYD", "IN", "GOI", "IN",
    "PNQ", "IN", "AMD", "IN", "COK", "IN", "JAI", "IN", "LKO", "IN", "IXC", "IN", "GAU", "IN",
    "VNS", "IN", "TRV", "IN", "IXB", "IN",
    "KTM", "NP", "DAC", "BD", "CMB", "LK", "ISB", "PK", "LHE", "PK", "KHI", "PK",
    # East Asia
    "PEK", "CN", "PKX", "CN", "PVG", "CN", "SHA", "CN", "CAN", "CN", "SZX", "CN", "CTU", "CN",
    "TFU", "CN", "XIY", "CN", "KMG", "CN", "CKG", "CN", "HGH", "CN", "NKG", "CN", "TAO", "CN",
    "WUH", "CN", "SHE", "CN", "DLC", "CN",
    "HKG", "HK", "MFM", "MO", "TPE", "TW", "KHH", "TW",
    "NRT", "JP", "HND", "JP", "KIX", "JP", "NGO", "JP", "FUK", "JP", "CTS", "JP",
    "ICN", "KR", "GMP", "KR", "PUS", "KR",
    # Southeast Asia
    "SIN", "SG", "KUL", "MY", "PEN", "MY", "BKI", "MY",
    "BKK", "TH", "DMK", "TH", "HKT", "TH", "CNX", "TH",
    "SGN", "VN", "HAN", "VN", "DAD", "VN",
    "CGK", "ID", "DPS", "ID", "SUB", "ID",
    "MNL", "PH", "CEB", "PH",
    # Oceania
    "SYD", "AU", "MEL", "AU", "BNE", "AU", "PER", "AU", "ADL", "AU", "OOL", "AU", "CNS", "AU",
    "AKL", "NZ", "WLG", "NZ", "CHC", "NZ",
    # Latin America
    "GRU", "BR", "GIG", "BR", "BSB", "BR", "CNF", "BR", "POA", "BR", "SSA", "BR",
    "EZE", "AR", "AEP", "AR", "SCL", "CL", "LIM", "PE", "BOG", "CO", "MDE", "CO", "UIO", "EC",
    "PTY", "PA", "SJO", "CR",
)

IATA_TO_COUNTRY: Dict[str, str] = {
    _IATA_COUNTRY_PAIRS[i]: _IATA_COUNTRY_PAIRS[i + 1]
    for i in range(0, len(_IATA_COUNTRY_PAIRS), 2)
}


def country_for_iata(iata_code: str) -> Optional[str]:
    code = (iata_code or "").strip().upper()
    if not code or len(code) != 3 or not re.match(r"^[A-Z]{3}$", code):
        return None
    return IATA_TO_COUNTRY.get(code)


def currency_for_country(iso_country: str) -> str:
    cc = (iso_country or "").strip().upper()
    if not cc:
        return os.getenv("FLIGHT_FALLBACK_CURRENCY", "USD")
    return _COUNTRY_TO_CURRENCY.get(cc, os.getenv("FLIGHT_FALLBACK_CURRENCY", "USD"))


def currency_for_departure_iata(iata_code: str) -> str:
    country = country_for_iata(iata_code)
    if not country:
        return os.getenv("FLIGHT_FALLBACK_CURRENCY", "USD")
    return currency_for_country(country)


def serpapi_gl_for_iata(iata_code: str) -> str:
    """Lowercase `gl` for SerpAPI Google Flights (ISO 3166-1 alpha-2)."""
    country = country_for_iata(iata_code)
    if not country:
        return "us"
    return country.lower()


def resolve_search_currency(explicit_currency: Optional[str], origin_raw: str) -> str:
    """
    Return ISO 4217 currency for a flight search.

    If `explicit_currency` is a non-empty string, it wins (caller / user choice).
    Otherwise derive from departure IATA resolved from `origin_raw`.
    """
    if explicit_currency and str(explicit_currency).strip():
        return str(explicit_currency).strip().upper()
    origin_iata = get_iata(origin_raw or "")
    return currency_for_departure_iata(origin_iata)
