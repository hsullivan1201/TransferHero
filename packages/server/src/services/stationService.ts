import { ExitParser } from './gtfs/exitParser.js';
import { StationExit } from '@transferhero/shared';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let exitCache: Map<string, StationExit[]> | null = null;

export const loadStationExits = async (force = false) => {
  if (exitCache && !force) return exitCache;

  // ensure you have the correct path to your gtfs folder
  const stopsPath = path.resolve(__dirname, '../../../../metro-gtfs/stops.txt');
  try {
    const parser = new ExitParser(stopsPath);
    exitCache = await parser.parseStationExits();
  } catch (err) {
    console.error(`[StationService] Failed to load exits from ${stopsPath}:`, err)
    // return empty map so callers get a clean "no data" instead of a crash
    if (!exitCache) exitCache = new Map()
  }
  return exitCache;
};

export const getExitsForStation = (stationCode: string): StationExit[] => {
  return exitCache?.get(stationCode) || [];
};

export const getAllExits = (): Map<string, StationExit[]> => {
  return exitCache || new Map();
};