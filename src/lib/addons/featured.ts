/**
 * Add-ons made for Storm Central (examples/addons), bundled so they install
 * with one tap and no network. Their ids are the GitHub raw URLs, the same as
 * installing them by link, so either way they replace each other.
 */

import themeNord from "../../../examples/addons/themes/nord/stormcentral.json";
import themeSky from "../../../examples/addons/themes/sky/stormcentral.json";
import themePaper from "../../../examples/addons/themes/paper/stormcentral.json";
import themeDracula from "../../../examples/addons/themes/dracula/stormcentral.json";
import themeSolarizedDark from "../../../examples/addons/themes/solarized-dark/stormcentral.json";
import themeSolarizedLight from "../../../examples/addons/themes/solarized-light/stormcentral.json";
import themeMidnight from "../../../examples/addons/themes/midnight/stormcentral.json";
import themeForest from "../../../examples/addons/themes/forest/stormcentral.json";
import themeSunset from "../../../examples/addons/themes/sunset/stormcentral.json";
import themeOcean from "../../../examples/addons/themes/ocean/stormcentral.json";
import themeHalloween from "../../../examples/addons/themes/halloween/stormcentral.json";
import themeHighContrast from "../../../examples/addons/themes/high-contrast/stormcentral.json";
import pluginRainfall from "../../../examples/addons/plugins/rainfall/stormcentral.json";
import pluginWildfires from "../../../examples/addons/plugins/wildfires/stormcentral.json";
import pluginEarthquakes from "../../../examples/addons/plugins/earthquakes/stormcentral.json";
import pluginBoundaries from "../../../examples/addons/plugins/boundaries/stormcentral.json";
import pluginEarthViews from "../../../examples/addons/plugins/earth-views/stormcentral.json";
import { GITHUB_REPO } from "../platform";
import { parseAddon, type PluginAddon, type ThemeAddon } from "./manifest";

const RAW = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/examples/addons`;
const PAGE = `https://github.com/${GITHUB_REPO}/tree/main/examples/addons`;

function load<T>(path: string, json: unknown): T[] {
  try {
    return [parseAddon(json, { id: `${RAW}/${path}/stormcentral.json`, homepage: `${PAGE}/${path}` }) as T];
  } catch {
    return [];
  }
}

export const FEATURED_THEMES: ThemeAddon[] = [
  ...load<ThemeAddon>("themes/sky", themeSky),
  ...load<ThemeAddon>("themes/nord", themeNord),
  ...load<ThemeAddon>("themes/paper", themePaper),
  ...load<ThemeAddon>("themes/dracula", themeDracula),
  ...load<ThemeAddon>("themes/solarized-dark", themeSolarizedDark),
  ...load<ThemeAddon>("themes/solarized-light", themeSolarizedLight),
  ...load<ThemeAddon>("themes/midnight", themeMidnight),
  ...load<ThemeAddon>("themes/forest", themeForest),
  ...load<ThemeAddon>("themes/sunset", themeSunset),
  ...load<ThemeAddon>("themes/ocean", themeOcean),
  ...load<ThemeAddon>("themes/high-contrast", themeHighContrast),
  ...load<ThemeAddon>("themes/halloween", themeHalloween),
];

export const FEATURED_PLUGINS: PluginAddon[] = [
  ...load<PluginAddon>("plugins/rainfall", pluginRainfall),
  ...load<PluginAddon>("plugins/wildfires", pluginWildfires),
  ...load<PluginAddon>("plugins/earthquakes", pluginEarthquakes),
  ...load<PluginAddon>("plugins/boundaries", pluginBoundaries),
  ...load<PluginAddon>("plugins/earth-views", pluginEarthViews),
];
