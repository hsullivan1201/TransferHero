import { ExitParser } from './gtfs/exitParser';
import { StationExit } from '@transferhero/shared';
import path from 'path';

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