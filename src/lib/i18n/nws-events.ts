/**
 * NWS event names in Spanish, as the NWS itself words them (Warning = Aviso,
 * Watch = Vigilancia, Advisory = Advertencia, Statement = Declaración).
 * Unknown events stay in English. Keep in step with Lang.java EVENTS.
 */
import type { Lang } from "./lang";

const ES: Record<string, string> = {
  "Tornado Warning": "Aviso de tornado",
  "Tornado Watch": "Vigilancia de tornado",
  "Tornado Emergency": "Emergencia de tornado",
  "Severe Thunderstorm Warning": "Aviso de tormenta eléctrica severa",
  "Severe Thunderstorm Watch": "Vigilancia de tormenta eléctrica severa",
  "Flash Flood Warning": "Aviso de inundación repentina",
  "Flash Flood Watch": "Vigilancia de inundación repentina",
  "Flash Flood Emergency": "Emergencia de inundación repentina",
  "Flood Warning": "Aviso de inundación",
  "Flood Watch": "Vigilancia de inundación",
  "Flood Advisory": "Advertencia de inundación",
  "Coastal Flood Warning": "Aviso de inundación costera",
  "Coastal Flood Advisory": "Advertencia de inundación costera",
  "Hurricane Warning": "Aviso de huracán",
  "Hurricane Watch": "Vigilancia de huracán",
  "Tropical Storm Warning": "Aviso de tormenta tropical",
  "Tropical Storm Watch": "Vigilancia de tormenta tropical",
  "Storm Surge Warning": "Aviso de marejada ciclónica",
  "Storm Surge Watch": "Vigilancia de marejada ciclónica",
  "Winter Storm Warning": "Aviso de tormenta invernal",
  "Winter Storm Watch": "Vigilancia de tormenta invernal",
  "Winter Weather Advisory": "Advertencia de tiempo invernal",
  "Blizzard Warning": "Aviso de ventisca",
  "Ice Storm Warning": "Aviso de tormenta de hielo",
  "Extreme Cold Warning": "Aviso de frío extremo",
  "Cold Weather Advisory": "Advertencia de tiempo frío",
  "Wind Chill Warning": "Aviso de sensación térmica",
  "Wind Chill Advisory": "Advertencia de sensación térmica",
  "Freeze Warning": "Aviso de congelación",
  "Frost Advisory": "Advertencia de escarcha",
  "Excessive Heat Warning": "Aviso de calor excesivo",
  "Extreme Heat Warning": "Aviso de calor extremo",
  "Heat Advisory": "Advertencia de calor",
  "High Wind Warning": "Aviso de vientos fuertes",
  "High Wind Watch": "Vigilancia de vientos fuertes",
  "Wind Advisory": "Advertencia de viento",
  "Extreme Wind Warning": "Aviso de vientos extremos",
  "Red Flag Warning": "Aviso de bandera roja",
  "Fire Weather Watch": "Vigilancia de tiempo de incendios",
  "Dense Fog Advisory": "Advertencia de niebla densa",
  "Dust Storm Warning": "Aviso de tormenta de polvo",
  "Air Quality Alert": "Alerta de calidad del aire",
  "Special Weather Statement": "Declaración especial del tiempo",
  "Severe Weather Statement": "Declaración de tiempo severo",
  "Small Craft Advisory": "Advertencia para embarcaciones pequeñas",
  "Gale Warning": "Aviso de vendaval",
  "Beach Hazards Statement": "Declaración de peligros en la playa",
  "Rip Current Statement": "Declaración de corrientes de resaca",
};

/** The event's name in `lang` (NWS wording), or as sent. */
export function eventName(lang: Lang, event: string): string {
  return lang === "es" ? (ES[event] ?? event) : event;
}
