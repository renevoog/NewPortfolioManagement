// Sector / exposure tagging for macro awareness
// Small curated map of sector exposures for known symbols.
// Used to surface macro/sector-level alerts when relevant.

const SECTOR_MAP = {
  // Energy
  'XOM': 'energy', 'CVX': 'energy', 'SU': 'energy',

  // Defense / aerospace
  'NOC': 'defense', 'RHM': 'defense', 'SAF': 'defense',
  'SAAB_B': 'defense', 'RR': 'defense', 'HEI': 'defense',
  'NYSE:TDY': 'defense', 'RCAT': 'defense',

  // Semiconductors / AI
  'TSM': 'semis', 'AVGO': 'semis', 'INTC': 'semis', 'ASML': 'semis',
  'ARM': 'semis', 'SEMI': 'semis', 'SMCI': 'semis',
  'SOUN': 'semis', 'APLD': 'semis', 'IREN': 'semis',
  'PLTR': 'semis', 'BBAI': 'semis',

  // Banks / financial / rates-sensitive
  'JPM': 'banks', 'GS': 'banks', 'AXP': 'banks',
  'V': 'banks', 'MA': 'banks', 'MCO': 'banks',
  'DB': 'banks', 'MUFG': 'banks', 'CB': 'banks',
  'AON': 'banks',

  // Healthcare
  'UNH': 'healthcare', 'LLY': 'healthcare', 'HUM': 'healthcare',
  'NVO': 'healthcare', 'VRTX': 'healthcare', 'AZN': 'healthcare',
  'HCA': 'healthcare', 'DVA': 'healthcare',

  // Real estate / REITs
  'IRM': 'realestate', 'WELL': 'realestate',

  // Consumer staples
  'KO': 'consumer', 'PEP': 'consumer', 'WMT': 'consumer',
  'MDLZ': 'consumer', 'GIS': 'consumer', 'SYY': 'consumer',
  'CAG': 'consumer', 'HSY': 'consumer', 'ADM': 'consumer',
  'SBUX': 'consumer', 'MCD': 'consumer',

  // Luxury
  'LVMH': 'luxury', 'RMS': 'luxury', 'OR': 'luxury',

  // Tech / software
  'AAPL': 'tech', 'MSFT': 'tech', 'GOOG': 'tech', 'META': 'tech',
  'AMZN': 'tech', 'NFLX': 'tech', 'ORCL': 'tech', 'CRM': 'tech',
  'SAP': 'tech', 'ACN': 'tech', 'INTU': 'tech',
  'PANW': 'tech', 'FTNT': 'tech',

  // Utilities / energy infrastructure
  'NEE': 'utilities', 'VST': 'utilities',

  // Quantum computing
  'IONQ': 'quantum', 'QBTS': 'quantum', 'QUBT': 'quantum', 'QNTM': 'quantum',

  // Insurance
  'KINS': 'insurance', 'PLMR': 'insurance',

  // Industrials
  'ETN': 'industrials', 'DE': 'industrials', 'ATCO_A': 'industrials',
  'LIN': 'industrials', 'SHW': 'industrials', 'ECL': 'industrials',
  'APD': 'industrials', 'CRH': 'industrials', 'SIE': 'industrials',
  'BMW': 'industrials', 'HLAG': 'industrials', 'FDX': 'industrials',

  // Nuclear / energy transition
  'OKLO': 'nuclear', 'NBIS': 'nuclear',

  // Crypto-adjacent
  'HIVE': 'crypto', 'BTBT': 'crypto', 'BITF': 'crypto', 'ETOR': 'crypto'
};

const SECTOR_LABELS = {
  'energy': 'Energy',
  'defense': 'Defense',
  'semis': 'Semis / AI',
  'banks': 'Banks & Financial',
  'healthcare': 'Healthcare',
  'realestate': 'Real Estate',
  'consumer': 'Consumer Staples',
  'luxury': 'Luxury',
  'tech': 'Tech',
  'utilities': 'Utilities',
  'quantum': 'Quantum',
  'insurance': 'Insurance',
  'industrials': 'Industrials',
  'nuclear': 'Nuclear',
  'crypto': 'Crypto-adjacent'
};

const getSector = (tvSymbol) => {
  return SECTOR_MAP[tvSymbol] || null;
};

const getSectorLabel = (sectorKey) => {
  return SECTOR_LABELS[sectorKey] || sectorKey || null;
};

exports.getSector = getSector;
exports.getSectorLabel = getSectorLabel;
exports.SECTOR_MAP = SECTOR_MAP;
exports.SECTOR_LABELS = SECTOR_LABELS;
