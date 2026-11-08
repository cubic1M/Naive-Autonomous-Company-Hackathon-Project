// Run: npx vitest run apps/api/src/lib (from the repo root).
import { describe, expect, it } from "vitest";
import { MAX_ADDRESS_LENGTH, isStreetAddress } from "./geo";

describe("isStreetAddress", () => {
  it.each([
    "1 Ferry Building, San Francisco, CA 94111",
    "1 Ferry Building, San Francisco, CA 94111, USA",
    "420 22nd St, San Francisco, CA 94107",
    "2102 Union St, San Francisco, CA",
    "123A Main St, San Francisco",
    "1600 Holloway Ave, San Francisco, CA",
    "100-110 Market St, San Francisco",
    "1 Dr Carlton B Goodlett Pl, San Francisco",
    "One Market Plaza, San Francisco, CA",
    "Pier 70, San Francisco, CA",
    "Building 12, Pier 70, San Francisco",
    "22nd St & Illinois St, San Francisco, CA",
    "Market St and 4th St, San Francisco",
    "The Embarcadero & Market St",
    "Haight & Ashbury, San Francisco, CA",
    "24th and Mission, San Francisco",
    "Embarcadero/Market, SF",
    "Market St / Van Ness Ave, San Francisco",
  ])("accepts a street-level address: %s", (address) => {
    expect(isStreetAddress(address)).toBe(true);
  });

  it.each([
    "San Francisco, CA",
    "San Francisco, CA 94103",
    "San Francisco 94103, CA",
    "San Francisco, CA 94103 USA",
    "San Francisco, CA 94103, US",
    "San Francisco, CA 94103, United States of America",
    "San Francisco, CA (worker to locate Y Combinator's current SF office)",
    "San Francisco, CA 94107 (worker should find the YC office)",
    "San Francisco, CA 94107 (YC office)",
    "Y Combinator office, San Francisco, CA 94103 (exact address unknown)",
    "Y Combinator, San Francisco, CA",
    "San Francisco, CA (any of the 3 Safeway stores)",
    "Downtown San Francisco, within 2 blocks of the Ferry Building",
    "Any Walgreens in SF open 24 hours",
    "Floor 2, San Francisco, CA",
    "123 TBD, San Francisco",
    "TBD",
    "",
    "   ",
  ])("rejects a vague address: %j", (address) => {
    expect(isStreetAddress(address)).toBe(false);
  });

  it("rejects an address longer than the cap, and stays fast on hostile input", () => {
    expect(isStreetAddress(`1 Main St ${"x".repeat(MAX_ADDRESS_LENGTH)}`)).toBe(false);
    const started = performance.now();
    isStreetAddress(`a${" ".repeat(MAX_ADDRESS_LENGTH - 2)}b`);
    isStreetAddress("st ".repeat(MAX_ADDRESS_LENGTH / 3));
    expect(performance.now() - started).toBeLessThan(50);
  });
});
