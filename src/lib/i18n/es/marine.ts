/** Marine conditions on the radar map: NDBC buoys and the wave forecast. */
export const MARINE: Record<string, string> = {
  // Layer menu
  Buoys: "Boyas",
  "NOAA buoys and coastal stations, coloured by their latest wave height (grey: no wave sensor). Tap one for its waves, wind and water temperature.":
    "Boyas y estaciones costeras de la NOAA, coloreadas según la altura de las olas más reciente (gris: sin sensor de oleaje). Toca una para ver sus olas, viento y temperatura del agua.",
  "Wave forecast (48 h)": "Pronóstico de oleaje (48 h)",
  "Wave height and direction over the sea from Open-Meteo's marine forecast. Pick the hour with the slider by the legend.":
    "Altura y dirección de las olas sobre el mar, del pronóstico marino de Open-Meteo. Elige la hora con el control deslizante junto a la leyenda.",

  // Buoy card
  "Buoy {id}": "Boya {id}",
  "Station {id}": "Estación {id}",
  "Close station": "Cerrar estación",
  "Wave height": "Altura de las olas",
  "Dominant period": "Período dominante",
  "Wave direction": "Dirección de las olas",
  "This station doesn't measure waves.": "Esta estación no mide las olas.",
  "Latest observation from NOAA's National Data Buoy Center": "Última observación del Centro Nacional de Datos de Boyas (NDBC) de la NOAA",
  "Station page (NDBC)": "Página de la estación (NDBC)",

  // Wave forecast legend
  "Wave forecast": "Pronóstico de oleaje",
  "+{n} h": "+{n} h",
  "No forecast": "Sin pronóstico",
  "Significant wave height, Open-Meteo marine forecast": "Altura significativa de las olas, pronóstico marino de Open-Meteo",
};
