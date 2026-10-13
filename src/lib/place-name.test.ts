import { describe, expect, it } from "vitest";
import { civilName, placeLabel, type BdcPlace } from "./place-name";

const admin = (county: string, township: string) => [
  { name: "United States of America", adminLevel: 2, order: 2 },
  { name: "Ohio", adminLevel: 4, order: 6 },
  { name: county, adminLevel: 6, order: 7, description: "county in Ohio, United States" },
  { name: township, adminLevel: 7, order: 10, description: `township in ${county}, Ohio` },
];

// Trimmed from BigDataCloud's answers at Seneca (Senecaville) Lake, Ohio.
const onLake: BdcPlace = {
  city: "Township of Wayne",
  locality: "Township of Wayne",
  principalSubdivisionCode: "US-OH",
  localityInfo: {
    administrative: admin("Noble County", "Township of Wayne"),
    informative: [
      { name: "North America", description: "continent in the Americas", order: 1 },
      { name: "Central Lowlands", order: 4 },
      { name: "43780", description: "postal code", order: 8 },
      { name: "Senecaville Lake", description: "reservoir in Ohio, United States", order: 11 },
    ],
  },
};

describe("civilName", () => {
  it("turns legal township names into everyday ones", () => {
    expect(civilName("Township of Wayne")).toEqual({ name: "Wayne Township", township: true });
    expect(civilName("Charter Township of Canton")).toEqual({ name: "Canton Township", township: true });
    expect(civilName("Richland Township")).toEqual({ name: "Richland Township", township: true });
    expect(civilName("Town of Torrey")).toEqual({ name: "Torrey", township: false });
    expect(civilName("Norman")).toEqual({ name: "Norman", township: false });
  });
});

describe("placeLabel", () => {
  it("names the lake you're on instead of the township", () => {
    expect(placeLabel(onLake)).toBe("Senecaville Lake, OH");
  });

  it("gives a township its county when there's no lake", () => {
    const shore: BdcPlace = { ...onLake, localityInfo: { ...onLake.localityInfo, informative: onLake.localityInfo!.informative!.slice(0, 3) } };
    expect(placeLabel(shore)).toBe("Wayne Township, Noble County, OH");
  });

  it("ignores lake regions and groups", () => {
    const ny: BdcPlace = {
      city: "Township of Richland",
      principalSubdivisionCode: "US-OH",
      localityInfo: {
        administrative: admin("Guernsey County", "Township of Richland"),
        informative: [
          { name: "Finger Lakes region", description: "region surrounding the Finger Lakes", order: 7 },
          { name: "Finger Lakes", description: "group of lakes in New York, USA", order: 9 },
        ],
      },
    };
    expect(placeLabel(ny)).toBe("Richland Township, Guernsey County, OH");
  });

  it("leaves towns and cities alone", () => {
    expect(placeLabel({ city: "Norman", principalSubdivisionCode: "US-OK" })).toBe("Norman, OK");
    expect(placeLabel({ city: "Town of Torrey", principalSubdivisionCode: "US-NY", localityInfo: { informative: [{ name: "Seneca Lake", description: "lake in New York", order: 10 }] } })).toBe(
      "Torrey, NY",
    );
    expect(placeLabel({ city: "", locality: "Paris" })).toBe("Paris");
    expect(placeLabel({})).toBe("My location");
  });
});
