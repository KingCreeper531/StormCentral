/** The Daily page panels (components/daily). */
export const DAILY: Record<string, string> = {
  // ─── Shared by several panels ──────────────────────────────────────────────
  High: "Máxima",
  Low: "Mínima",
  Humidity: "Humedad",
  "Next 24 hours": "Próximas 24 horas",
  "chance of precipitation": "de probabilidad de precipitación",

  // ─── current-hero.tsx ──────────────────────────────────────────────────────
  "Feels like": "Sensación térmica",
  "Can't reach the forecast · showing the forecast saved at {time}":
    "No se puede obtener el pronóstico · se muestra el pronóstico guardado a las {time}",
  "Offline · showing the forecast saved at {time}": "Sin conexión · se muestra el pronóstico guardado a las {time}",
  "Updated just now · {source}": "Actualizado hace un momento · {source}",
  "Updated {n} min ago · {source}": "Actualizado hace {n} min · {source}",

  // ─── nowcast-card.tsx ──────────────────────────────────────────────────────
  "No precipitation expected in the next 3 hours": "No se espera precipitación en las próximas 3 horas",
  "{what} ending in about {n} min": "{what}, termina en unos {n} min",
  "{what} continuing for the next few hours": "{what} durante las próximas horas",
  "{what} starting in a few minutes": "{what} en pocos minutos",
  "{what} starting in about {n} min": "{what} en unos {n} min",
  "Next 3 hours, inches per 15 minutes": "Próximas 3 horas, pulgadas cada 15 minutos",
  "Next 3 hours, mm per 15 minutes": "Próximas 3 horas, mm cada 15 minutos",
  "Precipitation over the next three hours": "Precipitación en las próximas tres horas",

  // ─── incoming-storms-panel.tsx ─────────────────────────────────────────────
  "Storm with rotation (tornado vortex signature)": "Tormenta con rotación (firma de vórtice tornádico)",
  "Rotating storm (mesocyclone)": "Tormenta rotatoria (mesociclón)",
  "Storm with severe hail": "Tormenta con granizo severo",
  "Storm with hail or weak rotation": "Tormenta con granizo o rotación débil",
  "Strong thunderstorm": "Tormenta eléctrica fuerte",
  "Storm arriving around {time}": "Tormenta llega cerca de las {time}",
  "{n} storms heading your way, first around {time}": "{n} tormentas se dirigen hacia ti, la primera cerca de las {time}",
  "From radar storm tracking; follow official warnings": "Según el seguimiento de tormentas del radar; sigue los avisos oficiales",
  "hail up to {size}": "granizo de hasta {size}",
  "moving {dir} at {speed}": "se mueve hacia el {dir} a {speed}",
  "in {n} min": "en {n} min",

  // ─── radar-preview.tsx ─────────────────────────────────────────────────────
  "Radar preview": "Vista previa del radar",
  "NEXRAD national mosaic": "Mosaico nacional NEXRAD",
  "Open radar": "Abrir radar",

  // ─── details-grid.tsx ──────────────────────────────────────────────────────
  "Wind from {dir}": "Viento del {dir}",
  "Wind direction unknown": "Dirección del viento desconocida",
  "From {dir}, gusts {gust}": "Del {dir}, ráfagas de {gust}",
  "Dew point {temp}": "Punto de rocío {temp}",
  "{delta} in 3 h": "{delta} en 3 h",
  "Max {n} today": "Máx. {n} hoy",
  "Cloud cover {pct}": "Nubosidad {pct}",
  "Air quality (US AQI)": "Calidad del aire (AQI de EE. UU.)",
  "No data": "Sin datos",
  "Precipitation today": "Precipitación hoy",
  "{pct} chance": "{pct} de probabilidad",
  "Tomorrow {amount}": "Mañana {amount}",
  "{h} h {m} min of daylight": "{h} h {m} min de luz del día",
  Sunrise: "Amanecer",
  Sunset: "Atardecer",
  Moon: "Luna",
  "{pct}% illuminated": "{pct}% iluminada",

  // ─── hourly-panel.tsx ──────────────────────────────────────────────────────
  "Earlier hours": "Horas anteriores",
  "Later hours": "Horas siguientes",
  "Temperature, next 24 hours": "Temperatura, próximas 24 horas",

  // ─── fire-smoke-panel.tsx ──────────────────────────────────────────────────
  "Fire weather from humidity and wind; smoke from PM2.5": "Tiempo de incendios según humedad y viento; humo según PM2.5",
  Map: "Mapa",
  "Humidity {pct}": "Humedad {pct}",
  "Gusts {wind}": "Ráfagas {wind}",
  "{n} days since meaningful rain, so vegetation is drying out.":
    "{n} días sin lluvia significativa, así que la vegetación se está secando.",
  "Smoke and haze": "Humo y bruma",
  "Worsening: up to {n} µg/m³ around {day} {time}": "Empeorando: hasta {n} µg/m³ cerca del {day} a las {time}",
  "Active wildfires nearby": "Incendios forestales activos cercanos",
  "None reported within {distance}.": "Ninguno reportado a menos de {distance}.",
  "{acres} acres, {pct}% contained": "{acres} acres, {pct}% contenido",
  "{acres} acres": "{acres} acres",
  "Size unknown, {pct}% contained": "Tamaño desconocido, {pct}% contenido",
  "Size unknown": "Tamaño desconocido",
  "and {n} more": "y {n} más",
  "Guidance only. Official fire danger comes from your local NWS office's Red Flag Warnings and fire agencies.":
    "Solo como orientación. El peligro de incendio oficial lo indican los avisos de bandera roja de tu oficina local del NWS y las agencias de bomberos.",

  // ─── rainfall-panel.tsx ────────────────────────────────────────────────────
  Normal: "Normal",
  "Near flood stage": "Cerca del nivel de inundación",
  "Minor flooding": "Inundación menor",
  "Moderate flooding": "Inundación moderada",
  "Major flooding": "Inundación mayor",
  "Floods at {stage} {unit}": "Se inunda a {stage} {unit}",
  "{name} stage": "Nivel de {name}",
  "Forecast to reach {value} {unit} ({category})": "Se pronostica que llegue a {value} {unit} ({category})",
  "Forecast to rise to {value} {unit}": "Se pronostica que suba a {value} {unit}",
  "Forecast to fall to {value} {unit}": "Se pronostica que baje a {value} {unit}",
  "{date}: {amount} (forecast)": "{date}: {amount} (pronóstico)",
  "{date}: {amount}": "{date}: {amount}",
  "Totals estimated from weather models; river levels from NOAA gauges":
    "Totales estimados con modelos meteorológicos; niveles de ríos de los medidores de NOAA",
  "Rain totals are unavailable right now.": "Los totales de lluvia no están disponibles en este momento.",
  "Past 24 h": "Últimas 24 h",
  "Past 7 days": "Últimos 7 días",
  "Past hour": "Última hora",
  "Next 24 h": "Próximas 24 h",
  "Next 3 days": "Próximos 3 días",
  "No day with 1 mm or more in the past month.": "Ningún día con 1 mm o más en el último mes.",
  "Rain has fallen today.": "Hoy ha llovido.",
  "Last rain (1 mm or more) was yesterday.": "La última lluvia (1 mm o más) fue ayer.",
  "Last rain (1 mm or more) was {n} days ago.": "La última lluvia (1 mm o más) fue hace {n} días.",
  "Daily rainfall, past two weeks and next days": "Lluvia diaria, últimas dos semanas y próximos días",
  "Rivers and streams": "Ríos y arroyos",
  "{flooding} of {n} gauge flooding": "{flooding} de {n} medidor con inundación",
  "{flooding} of {n} gauges flooding": "{flooding} de {n} medidores con inundación",
  "{n} gauge, none flooding": "{n} medidor, sin inundación",
  "{n} gauges, none flooding": "{n} medidores, ninguno con inundación",

  // ─── climate-panel.tsx ─────────────────────────────────────────────────────
  "Today is close to normal for the date": "Hoy está cerca de lo normal para la fecha",
  "Today is {d}° warmer than normal": "Hoy está {d}° más cálido de lo normal",
  "Today is {d}° warmer than normal, well out of the ordinary": "Hoy está {d}° más cálido de lo normal, algo muy fuera de lo común",
  "Today is {d}° cooler than normal": "Hoy está {d}° más fresco de lo normal",
  "Today is {d}° cooler than normal, well out of the ordinary": "Hoy está {d}° más fresco de lo normal, algo muy fuera de lo común",
  "Forecast highs compared with normal, next 7 days": "Máximas pronosticadas comparadas con lo normal, próximos 7 días",
  "Climate for {date}": "Clima del {date}",
  "Normals unavailable for today": "No hay valores normales para hoy",
  "Forecast high beats the record for the date": "La máxima pronosticada supera el récord para la fecha",
  "Forecast high is near the record": "La máxima pronosticada está cerca del récord",
  "Forecast low beats the record for the date": "La mínima pronosticada supera el récord para la fecha",
  "Forecast low is near the record": "La mínima pronosticada está cerca del récord",
  "Normal {value}": "Normal {value}",
  "Record high": "Máxima récord",
  "Record low": "Mínima récord",
  "in {year}": "en {year}",
  "Rain in {month} so far": "Lluvia en {month} hasta ahora",
  "{pct}% of normal": "{pct}% de lo normal",
  "Normal {toDate} to date, {month} for the month": "Normal {toDate} a la fecha, {month} para el mes",
  "Last 30 days": "Últimos 30 días",
  "Official {from}–{to} normals and records since {since} for {station}, from NOAA ACIS.":
    "Normales oficiales {from}–{to} y récords desde {since} para {station}, de NOAA ACIS.",
  "Official {from}–{to} normals and records since {since} for {station} ({distance} away), from NOAA ACIS.":
    "Normales oficiales {from}–{to} y récords desde {since} para {station} (a {distance}), de NOAA ACIS.",

  // ─── forecaster-notes-panel.tsx ────────────────────────────────────────────
  "The big picture": "El panorama general",
  "Latest thinking": "Análisis más reciente",
  "National Weather Service": "Servicio Nacional de Meteorología",
  Original: "Original",
  "Read the full discussion": "Leer la discusión completa",
  "More: {sections}": "Más: {sections}",
  "Jargon decoder ({n} term)": "Glosario ({n} término)",
  "Jargon decoder ({n} terms)": "Glosario ({n} términos)",

  // ─── forecast-source-bar.tsx ───────────────────────────────────────────────
  "Your Google Weather API key": "Tu clave de la API Google Weather",
  "It stays on this device and goes straight to Google, so it uses your own free allowance (10,000 calls a month).":
    "Se queda en este dispositivo y va directo a Google, así que usa tu propia cuota gratuita (10,000 llamadas al mes).",
  "In {link}, enable the Weather API, then create a key under APIs & Services → Credentials.":
    "En {link}, activa la API Weather y luego crea una clave en APIs y servicios → Credenciales.",
  "Google Weather API key": "Clave de la API Google Weather",
  "Hide key": "Ocultar clave",
  "Show key": "Mostrar clave",
  "Forecast from": "Pronóstico de",
  "{label} ({region} only)": "{label} (solo {region})",
  Key: "Clave",

  // ─── severe-risk-panel.tsx ─────────────────────────────────────────────────
  "Show on map": "Ver en el mapa",
  "No severe risk": "Sin riesgo de tiempo severo",
  "SPC Day 1, valid until {time}": "SPC día 1, válida hasta {time}",
  ", level {n} of 5": ", nivel {n} de 5",
  "SPC risk level": "Nivel de riesgo del SPC",
  Unavailable: "No disponible",
  "Chance of each hazard within 25 miles of this location.": "Probabilidad de cada peligro a menos de 25 millas de este lugar.",
};
