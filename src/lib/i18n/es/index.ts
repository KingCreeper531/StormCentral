/**
 * Spanish (Latin American, US conventions). One file per area of the app so
 * each can be edited on its own; keys are the exact English text.
 *
 * Terms: Warning = Aviso, Watch = Vigilancia, Advisory = Advertencia (as the
 * NWS uses them in Spanish); spotter = observador; report = reporte.
 */
import { ALERTS } from "./alerts";
import { COMMON } from "./common";
import { COMMUNITY } from "./community";
import { DAILY } from "./daily";
import { LIB } from "./lib";
import { MAP } from "./map";
import { MODES } from "./modes";
import { NOTIFY } from "./notify";
import { RADAR } from "./radar";
import { SETTINGS } from "./settings";
import { SHELL } from "./shell";

export const ES: Readonly<Record<string, string>> = {
  ...LIB,
  ...COMMON,
  ...SHELL,
  ...DAILY,
  ...MODES,
  ...RADAR,
  ...MAP,
  ...COMMUNITY,
  ...SETTINGS,
  ...ALERTS,
  ...NOTIFY,
};
