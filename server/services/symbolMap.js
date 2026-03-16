// TradingView symbol -> Yahoo Finance symbol mapping
// This is the canonical mapping for the initial asset list.

const SYMBOL_MAP = {
  'BRK.B': 'BRK-B',
  'XOM': 'XOM',
  'HUM': 'HUM',
  'AAPL': 'AAPL',
  'META': 'META',
  'NVO': 'NVO',
  'LVMH': 'LVMHF',
  'ASML': 'ASML',
  'RMS': 'RMS.PA',
  'IWDA': 'IWDA.AS',
  'CSPX': 'CSPX.L',
  'SPX': '^SPX',
  'IYT': 'IYT',
  'DIA': 'DIA',
  'CVX': 'CVX',
  'LIN': 'LIN',
  'MSFT': 'MSFT',
  'AZO': 'AZO',
  'ORLY': 'ORLY',
  'WMT': 'WMT',
  'UNH': 'UNH',
  'HD': 'HD',
  'VT': 'VT',
  'INTC': 'INTC',
  'TSM': 'TSM',
  'VRTX': 'VRTX',
  'JPM': 'JPM',
  'RHM': 'RHM.DE',
  'RR': 'RR.L',
  'V': 'V',
  'GS': 'GS',
  'NFLX': 'NFLX',
  'NOC': 'NOC',
  'OR': 'OR.PA',
  'ACN': 'ACN',
  'SAP': 'SAP',
  'AZN': 'AZN',
  'SU': 'SU.PA',
  'ETN': 'ETN',
  'CB': 'CB',
  'AI': 'AI.PA',
  'ATCO_A': 'ATCO-B.ST',
  'ORCL': 'ORCL',
  'HLAG': 'HLAG.DE',
  'AXP': 'AXP',
  'MCO': 'MCO',
  'DVA': 'DVA',
  'KR': 'KR',
  'AMZN': 'AMZN',
  'AON': 'AON',
  'TMUS': 'TMUS',
  'HEI': 'HEI',
  'NVR': 'NVR',
  'KO': 'KO',
  'PEP': 'PEP',
  'MDLZ': 'MDLZ',
  'GIS': 'GIS',
  'SYY': 'SYY',
  'CAG': 'CAG',
  'HSY': 'HSY',
  'ADM': 'ADM',
  'SBUX': 'SBUX',
  'MCD': 'MCD',
  'IRM': 'IRM',
  'WELL': 'WELL',
  'SHW': 'SHW',
  'SCCO': 'SCCO',
  'ECL': 'ECL',
  'APD': 'APD',
  'CRH': 'CRH',
  'SIE': 'SIEMENS.NS',
  'HCA': 'HCA',
  'LLY': 'LLY',
  'FDX': 'FDX',
  'AVGO': 'AVGO',
  'GPC': 'GPC',
  'BMW': 'BMW.DE',
  'NEE': 'NEE',
  'PANW': 'PANW',
  'FTNT': 'FTNT',
  'SAAB_B': 'SAAB-B.ST',
  'LOW': 'LOW',
  'TJX': 'TJX',
  'TGT': 'TGT',
  'INTU': 'INTU',
  'DE': 'DE',
  'ROST': 'ROST',
  'DHI': 'DHI',
  'DPZ': 'DPZ',
  'KOZ': 'KOG.OL',
  'SAF': 'SAF.PA',
  'VST': 'VST',
  'BLDR': 'BLDR',
  'SOUN': 'SOUN',
  'APLD': 'APLD',
  'BBAI': 'BBAI',
  'TEM': 'TEM',
  'SMCI': 'SMCI',
  'QUBT': 'QUBT',
  'GOOG': 'GOOG',
  'PLTR': 'PLTR',
  'NYSE:TDY': 'TDY',
  'ARM': 'ARM',
  'MA': 'MA',
  'CRM': 'CRM',
  'KINS': 'KINS',
  'PLMR': 'PLMR',
  '4X0': '4X0.F',
  'R3ENK': 'R3NK.F',
  'MUFG': 'MUFG',
  'NTDOF': 'NTO.F',
  'ETOR': 'ETOR',
  'IREN': 'IREN',
  'OKLO': 'OKLO',
  'NBIS': 'NBIS',
  'HIVE': 'HIVE',
  'BTBT': 'BTBT',
  'BITF': 'BITF',
  'DB': 'DB',
  'SEMI': 'SEMI',
  'QNTM': 'QNTM',
  'PACW': 'PACW',
  'GLUE': 'GLUE',
  'NRIX': 'NRIX',
  'RCAT': 'RCAT',
  'QBTS': 'QBTS',
  'IONQ': 'IONQ',
  'SAI.MC': 'SAI.MC',
  'JANX': 'JANX'
};

// Get Yahoo symbol for a TradingView symbol
const getYahooSymbol = (tvSymbol) => {
  if (!tvSymbol) return null;
  const key = String(tvSymbol).trim();
  return SYMBOL_MAP[key] || null;
};

// Get all initial TradingView symbols
const getInitialSymbols = () => {
  return Object.keys(SYMBOL_MAP);
};

// Check if a TradingView symbol exists in the map
const hasSymbol = (tvSymbol) => {
  if (!tvSymbol) return false;
  return String(tvSymbol).trim() in SYMBOL_MAP;
};

// Add a new mapping (for dynamically discovered symbols)
const addMapping = (tvSymbol, yahooSymbol) => {
  if (tvSymbol && yahooSymbol) {
    SYMBOL_MAP[String(tvSymbol).trim()] = String(yahooSymbol).trim();
  }
};

exports.SYMBOL_MAP = SYMBOL_MAP;
exports.getYahooSymbol = getYahooSymbol;
exports.getInitialSymbols = getInitialSymbols;
exports.hasSymbol = hasSymbol;
exports.addMapping = addMapping;
