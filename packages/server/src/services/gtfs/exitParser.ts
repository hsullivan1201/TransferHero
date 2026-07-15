import fs from 'fs';
import csv from 'csv-parser';
import { StationExit } from '@transferhero/shared'; 

// add the actual accessibility field from the csv header
interface GtfsStop {
  stop_id: string;
  stop_name: string;
  stop_lat: string;
  stop_lon: string;
  location_type: string;
  parent_station: string;
  wheelchair_boarding?: string; // standard gtfs field
}

export class ExitParser {
  private stopsFilePath: string;

  constructor(stopsFilePath: string) {
    this.stopsFilePath = stopsFilePath;
  }

  public async parseStationExits(): Promise<Map<string, StationExit[]>> {
    const exits = new Map<string, StationExit[]>();

    return new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(this.stopsFilePath);

      // .pipe() does NOT forward errors from the source stream,
      // so we must handle ENOENT / read errors on the ReadStream directly
      readStream.on('error', (error) => reject(error));

      readStream
        .pipe(csv())
        .on('data', (row: GtfsStop) => {
          // location_type 2 = entrance/exit
          if (row.location_type === '2' && row.stop_id.startsWith('ENT_')) {
            const stationCode = this.normalizeStationCode(row.parent_station);

            // gtfs spec: 1 = accessible, 2 = not accessible, 0 = unknown
            // wmata seems to use 1 and 2 reliably
            const isAccessible = row.wheelchair_boarding === '1';

            const exit: StationExit = {
              id: row.stop_id,
              name: this.cleanExitName(row.stop_name),
              lat: parseFloat(row.stop_lat),
              lon: parseFloat(row.stop_lon),
              isAccessible
            };

            const existing = exits.get(stationCode);
            if (existing) {
              existing.push(exit);
            } else {
              exits.set(stationCode, [exit]);
            }
          }
        })
        .on('end', () => {
          console.log(`[GTFS] parsed entrances for ${exits.size} stations`);
          resolve(exits);
        })
        .on('error', (error) => reject(error));
    });
  }

  private normalizeStationCode(gtfsParentId: string): string {
    return gtfsParentId ? gtfsParentId.replace('STN_', '') : '';
  }

  private cleanExitName(rawName: string): string {
    const parts = rawName.split(' - ');
    const name = parts.length > 1 ? parts.slice(1).join(' - ').trim() : rawName.trim();
    // WMATA's GTFS title-cases ordinal suffixes ("M & 2Nd Sts. NE") — lower them
    return name.replace(/(\d)(St|Nd|Rd|Th)\b/g, (_, digit, suffix) => digit + suffix.toLowerCase());
  }
}