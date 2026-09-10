/**
 * Ambient types for the `zipcodes` package (v8), which ships no declarations
 * and has no @types counterpart.
 *
 * Only `lookup` is used by this server (see tools.ts / vendorsNear), but the
 * rest of the surface is declared so future code gets checking for free.
 * Shapes verified against the installed package at runtime.
 */
declare module "zipcodes" {
  export interface ZipInfo {
    zip: string;
    latitude: number;
    longitude: number;
    city: string;
    state: string;
    country: string;
  }

  /** Returns undefined for unknown/non-US ZIPs. */
  export function lookup(zip: string | number): ZipInfo | undefined;

  export function lookupByName(city: string, state: string): ZipInfo[];
  export function lookupByState(state: string): string[];
  export function lookupByCoords(
    latitude: number,
    longitude: number,
  ): ZipInfo | undefined;

  /** Distance in miles between two ZIPs; null if either is unknown. */
  export function distance(
    zipA: string | number,
    zipB: string | number,
  ): number | null;

  /** ZIPs within `miles` of `zip`. */
  export function radius(
    zip: string | number,
    miles: number,
    full?: boolean,
  ): string[];

  export function random(): ZipInfo;

  export function toMiles(kilometers: number): number;
  export function toKilometers(miles: number): number;

  export const codes: Record<string, ZipInfo>;
  export const states: Record<string, string>;

  const zipcodes: {
    lookup: typeof lookup;
    lookupByName: typeof lookupByName;
    lookupByState: typeof lookupByState;
    lookupByCoords: typeof lookupByCoords;
    distance: typeof distance;
    radius: typeof radius;
    random: typeof random;
    toMiles: typeof toMiles;
    toKilometers: typeof toKilometers;
    codes: typeof codes;
    states: typeof states;
  };

  export default zipcodes;
}
