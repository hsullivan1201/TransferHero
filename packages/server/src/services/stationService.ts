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
  const parser = new ExitParser(path.resolve(__dirname, '../../../../metro-gtfs/stops.txt'));
  exitCache = await parser.parseStationExits();
  return exitCache;
};

export const getExitsForStation = (stationCode: string): StationExit[] => {
  return exitCache?.get(stationCode) || [];
};

export const getAllExits = (): Map<string, StationExit[]> => {
  return exitCache || new Map();
};