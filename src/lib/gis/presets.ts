/**
 * Public placefiles offered with one tap. Each was checked to answer, to be
 * a placefile, and to allow reads from the browser (CORS), so they load
 * without the /api/gis proxy.
 */
export interface GisPreset {
  url: string;
  name: string;
  note: string;
}

export const GIS_PRESETS: readonly GisPreset[] = [
  {
    url: "https://www.spotternetwork.org/feeds/gr-no.txt",
    name: "Spotter Network positions",
    note: "Storm spotters and chasers sharing their location, updated every minute. Phone numbers and emails are hidden.",
  },
  {
    url: "https://mesonet.agron.iastate.edu/request/grx/l3attr.txt",
    name: "NEXRAD storm attributes",
    note: "Every radar's storm cells with their track, hail and rotation (Iowa Environmental Mesonet). Tracks show when zoomed in.",
  },
  {
    url: "https://mesonet.agron.iastate.edu/request/grx/time_mot_loc.txt",
    name: "Warning time, motion and location",
    note: "Where each tornado and severe thunderstorm warning's storm is and where it's heading (Iowa Environmental Mesonet).",
  },
];
