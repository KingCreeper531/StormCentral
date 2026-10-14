/**
 * Text that comes from the shared library (src/lib/**) and the mode registry:
 * condition names, metric and category labels, score explanations, feed
 * labels and the sentences lib functions build with a translator.
 *
 * Some lib values are lowercase ids that double as text (pressure tendency,
 * pollen and flood levels, shear class, cloud layer, fire level). Their
 * Spanish is keyed by the lowercase id so it can't collide with "High" / "Low"
 * (Máxima / Mínima): show them with `sentence(t(id))`.
 *
 * Keys already in notify.ts (same Spanish) are not repeated here: "Light rain",
 * "Heavy rain", "Light snow", "Heavy snow", "Hail", "Wind damage", "Flooding".
 */
export const LIB: Record<string, string> = {
  // ─── time.ts ───────────────────────────────────────────────────────────────
  "just now": "hace un momento",

  // ─── weather/wmo.ts (condition labels) ─────────────────────────────────────
  Clear: "Despejado",
  "Mostly clear": "Mayormente despejado",
  "Partly cloudy": "Parcialmente nublado",
  Overcast: "Nublado",
  Fog: "Niebla",
  "Freezing fog": "Niebla helada",
  "Light drizzle": "Llovizna ligera",
  Drizzle: "Llovizna",
  "Heavy drizzle": "Llovizna fuerte",
  "Freezing drizzle": "Llovizna helada",
  "Heavy freezing drizzle": "Llovizna helada fuerte",
  Rain: "Lluvia",
  "Freezing rain": "Lluvia helada",
  "Heavy freezing rain": "Lluvia helada fuerte",
  Snow: "Nieve",
  "Snow grains": "Granos de nieve",
  "Light showers": "Chubascos ligeros",
  Showers: "Chubascos",
  "Violent showers": "Chubascos torrenciales",
  "Snow showers": "Chubascos de nieve",
  "Heavy snow showers": "Chubascos de nieve fuertes",
  Thunderstorm: "Tormenta eléctrica",
  "Thunderstorm, hail": "Tormenta eléctrica con granizo",
  "Severe thunderstorm, hail": "Tormenta eléctrica severa con granizo",

  // ─── modes/registry.ts ─────────────────────────────────────────────────────
  Daily: "Hoy",
  Radar: "Radar",
  "UAV pilot": "Drones",
  UAV: "Drones",
  Angler: "Pesca",
  "Air quality": "Calidad del aire",
  Air: "Aire",
  "Conditions, hourly and 10-day forecast": "Condiciones, pronóstico por hora y de 10 días",
  "NEXRAD radar, warnings and storm tracks": "Radar NEXRAD, avisos y trayectorias de tormentas",
  "Winds aloft, shear, Kp, ceiling and GNSS": "Vientos en altura, cizalladura, Kp, techo de nubes y GNSS",
  "River gauges, pressure trend and solunar": "Medidores de ríos, tendencia de la presión y tablas solunares",
  "AQI map, particulates, ozone and pollen": "Mapa del AQI, partículas, ozono y polen",

  // ─── alerting/metrics.ts ───────────────────────────────────────────────────
  Temperature: "Temperatura",
  "Wind gusts": "Ráfagas de viento",
  "Chance of rain": "Probabilidad de lluvia",
  "UV index": "Índice UV",
  "Wind at flight altitude": "Viento a altitud de vuelo",
  "Flyability score": "Índice de vuelo",
  "Bite index": "Índice de picada",
  "US AQI": "AQI de EE. UU.",
  "{metric} above {value}": "{metric} por encima de {value}",
  "{metric} below {value}": "{metric} por debajo de {value}",

  // ─── alerting/engine.ts (notifications) ────────────────────────────────────
  "{event}: {place}": "{event}: {place}",
  "Particularly dangerous situation.": "Situación particularmente peligrosa.",
  "Until {time}.": "Hasta las {time}.",
  Observed: "Observado",
  "Tornado possible": "Posible tornado",
  Considerable: "Considerable",
  Destructive: "Destructivo",
  "Tornado emergency": "Emergencia de tornado",
  "Flash flood emergency": "Emergencia de inundación repentina",
  "{place}: {rule}": "{place}: {rule}",
  "{metric} {value} now.": "{metric}: {value} ahora.",
  "{metric} {value} tomorrow at {time}.": "{metric}: {value} mañana a las {time}.",
  "{metric} {value} at {time}.": "{metric}: {value} a las {time}.",

  // ─── alerts.ts (TAG_LABEL) ─────────────────────────────────────────────────
  "Tornado observed": "Tornado observado",

  // ─── alerting/types.ts (ALERT_CATEGORIES) ──────────────────────────────────
  Tornado: "Tornado",
  "Severe thunderstorm": "Tormenta eléctrica severa",
  "Flood and flash flood": "Inundación e inundación repentina",
  "Hurricane and tropical storm": "Huracán y tormenta tropical",
  "Winter storm, ice and cold": "Tormenta invernal, hielo y frío",
  Heat: "Calor",
  "High wind": "Vientos fuertes",
  "Fire weather": "Tiempo de incendios",
  "Everything else (fog, air quality, marine…)": "Todo lo demás (niebla, calidad del aire, marino…)",

  // ─── community.ts ──────────────────────────────────────────────────────────
  Observation: "Observación",
  "Snow / ice": "Nieve / hielo",
  "Tornado / funnel": "Tornado / nube embudo",
  Lightning: "Rayos",
  "Fog / visibility": "Niebla / visibilidad",
  "Sky photo": "Foto del cielo",
  Info: "Información",
  Notable: "Notable",
  Significant: "Significativo",
  Dangerous: "Peligroso",
  Legend: "Leyenda",
  "Storm Chaser": "Cazador de tormentas",
  "Trusted Spotter": "Observador de confianza",
  Spotter: "Observador",
  Observer: "Aprendiz",
  Developer: "Desarrollador",
  "Username must be at least 3 characters": "El nombre de usuario debe tener al menos 3 caracteres",
  "Username must be at most 24 characters": "El nombre de usuario debe tener como máximo 24 caracteres",
  "Letters, numbers and underscores only": "Solo letras, números y guiones bajos",
  "Enter a valid email": "Ingresa un correo electrónico válido",
  "Use at least 10 characters": "Usa al menos 10 caracteres",
  "Password is too long": "La contraseña es demasiado larga",
  "Enter your current password": "Ingresa tu contraseña actual",
  "Enter a display name": "Ingresa un nombre para mostrar",
  "Keep it under 40 characters": "Usa menos de 40 caracteres",
  "Keep your bio under 300 characters": "Tu biografía debe tener menos de 300 caracteres",
  "Enter your password": "Ingresa tu contraseña",
  "Enter your username or email": "Ingresa tu nombre de usuario o correo electrónico",
  "Say a little more": "Cuenta un poco más",
  "Keep it under 1000 characters": "Usa menos de 1000 caracteres",
  "Keep it under 500 characters": "Usa menos de 500 caracteres",
  "Invalid input": "Dato no válido",
  "Spam or advertising": "Spam o publicidad",
  "Harassment or bullying": "Acoso o intimidación",
  "Hateful or abusive content": "Contenido de odio o abusivo",
  "Sexual or graphic content": "Contenido sexual o explícito",
  "Threats or violence": "Amenazas o violencia",
  "False or misleading weather report": "Reporte del tiempo falso o engañoso",
  "Shares someone's private information": "Comparte información privada de alguien",
  "Something else": "Otra cosa",
  "This account has been suspended.": "Esta cuenta fue suspendida.",
  "This account is suspended until {date}.": "Esta cuenta está suspendida hasta el {date}.",

  // ─── daily-layout.ts (DAILY_PANELS) ────────────────────────────────────────
  "Storms heading your way": "Tormentas que se dirigen hacia ti",
  "Shows when radar sees a strong storm coming": "Aparece cuando el radar detecta una tormenta fuerte en camino",
  "Current conditions": "Condiciones actuales",
  "Next 3 hours": "Próximas 3 horas",
  "Hourly forecast": "Pronóstico por hora",
  "Severe weather outlook": "Perspectiva de tiempo severo",
  "Shows when you're in an SPC risk area": "Aparece cuando estás en un área de riesgo del SPC",
  Conditions: "Condiciones",
  "10-day forecast": "Pronóstico de 10 días",
  "Sun and moon": "Sol y luna",
  "Forecaster notes": "Notas del pronosticador",
  "US only": "Solo EE. UU.",
  "Compared with normal": "Comparado con lo normal",
  "Rainfall and flooding": "Lluvia e inundaciones",
  "Fire and smoke": "Incendios y humo",
  "Reports near you": "Reportes cerca de ti",

  // ─── forecast-sources.ts ───────────────────────────────────────────────────
  "Best match": "Mejor opción",
  "Open-Meteo's blend of the best national models for your area.": "La combinación de Open-Meteo de los mejores modelos nacionales para tu zona.",
  "Google's Weather API, with your own API key.": "La API Weather de Google, con tu propia clave de API.",
  "ECMWF (Europe)": "ECMWF (Europa)",
  "The European Centre's global model, widely rated the most accurate.": "El modelo global del Centro Europeo, considerado por muchos el más preciso.",
  "The European Centre's machine-learning model.": "El modelo de aprendizaje automático del Centro Europeo.",
  "NOAA GFS (US)": "NOAA GFS (EE. UU.)",
  "The US global model, with HRRR for the first hours over the US.": "El modelo global de EE. UU., con HRRR para las primeras horas sobre EE. UU.",
  "NWS National Blend": "Combinación Nacional del NWS",
  "NWS Blend": "Combinación NWS",
  "The National Weather Service's statistical blend.": "La combinación estadística del Servicio Nacional de Meteorología.",
  "DWD ICON (Germany)": "DWD ICON (Alemania)",
  "The German Weather Service's model.": "El modelo del Servicio Meteorológico Alemán.",
  "GEM (Canada)": "GEM (Canadá)",
  "Environment Canada's model.": "El modelo de Environment Canada.",
  "The UK Met Office's global and UK models.": "Los modelos global y del Reino Unido de la Met Office.",
  "Météo-France's ARPEGE and AROME models.": "Los modelos ARPEGE y AROME de Météo-France.",
  "JMA (Japan)": "JMA (Japón)",
  "The Japan Meteorological Agency's model.": "El modelo de la Agencia Meteorológica de Japón.",

  // ─── forecast-load.ts and google-weather.ts (forecast notices) ─────────────
  "{source} has no forecast for this location, so this is Open-Meteo's best match.":
    "{source} no tiene pronóstico para este lugar, así que se muestra la mejor opción de Open-Meteo.",
  "Couldn't load {source} right now, so this is Open-Meteo's best match.":
    "No se pudo cargar {source} en este momento, así que se muestra la mejor opción de Open-Meteo.",
  "Add your Google Weather API key to see Google's forecast.": "Agrega tu clave de la API Google Weather para ver el pronóstico de Google.",
  "Google: {message}": "Google: {message}",
  "Couldn't reach Google right now, so this is Open-Meteo's best match.":
    "No se pudo conectar con Google en este momento, así que se muestra la mejor opción de Open-Meteo.",
  "Your Google key has used up its allowance for now.": "Tu clave de Google agotó su cuota por ahora.",
  "Google says this API key isn't valid.": "Google dice que esta clave de API no es válida.",
  "Turn on the Weather API for this key's project in Google Cloud.": "Activa la API Weather en el proyecto de esta clave en Google Cloud.",
  "Google needs a billing account on this key's project (the free tier still applies).":
    "Google requiere una cuenta de facturación en el proyecto de esta clave (el nivel gratuito sigue aplicando).",
  "This key's restrictions block Storm Central. Allow this website (or no website restriction) for the key.":
    "Las restricciones de esta clave bloquean Storm Central. Permite este sitio web (o quita la restricción de sitios web) para la clave.",

  // ─── widget-note.ts ────────────────────────────────────────────────────────
  "Record high possible: {temp} (record {record})": "Posible máxima récord: {temp} (récord {record})",
  "Near-record high: {temp} (record {record})": "Máxima cerca del récord: {temp} (récord {record})",
  "Record low possible: {temp} (record {record})": "Posible mínima récord: {temp} (récord {record})",
  "Near-record low: {temp} (record {record})": "Mínima cerca del récord: {temp} (récord {record})",
  "Much warmer than normal: {d}° above": "Mucho más cálido de lo normal: {d}° por encima",
  "Much colder than normal: {d}° below": "Mucho más frío de lo normal: {d}° por debajo",

  // ─── science/scores.ts: UAV flyability ─────────────────────────────────────
  "Sub-250 g (Mini class)": "Menos de 250 g (clase Mini)",
  "Prosumer (Air / Mavic class)": "Semiprofesional (clase Air / Mavic)",
  "Enterprise (IP55, Matrice class)": "Empresarial (IP55, clase Matrice)",
  "FPV / racing quad": "FPV / cuadricóptero de carreras",
  "Wind at altitude": "Viento en altitud",
  Gusts: "Ráfagas",
  Precipitation: "Precipitación",
  Visibility: "Visibilidad",
  "{pct}% of airframe limit": "{pct}% del límite de la aeronave",
  "{pct}% chance": "{pct}% de probabilidad",
  "Below 3 SM (Part 107 minimum)": "Menos de 3 SM (mínimo de la Parte 107)",
  "Meets VLOS minimums": "Cumple los mínimos de VLOS",
  "Cloud clearance": "Distancia a las nubes",
  "Under 500 ft below cloud base": "A menos de 500 ft bajo la base de las nubes",
  "{m} m below base": "{m} m bajo la base",
  "Battery temperature": "Temperatura de la batería",
  "Pre-warm batteries; expect reduced capacity": "Precalienta las baterías; espera menor capacidad",
  "Within operating range": "Dentro del rango de operación",
  "Geomagnetic (Kp)": "Geomagnético (Kp)",
  "G{g} storm — GNSS & compass degraded": "Tormenta G{g}: GNSS y brújula degradados",
  "Active — minor GNSS position scatter possible": "Activo: posible dispersión menor de la posición GNSS",
  "Quiet to unsettled": "Tranquilo a inestable",
  Daylight: "Luz del día",
  "Night ops: anti-collision lighting required": "Vuelo nocturno: se requieren luces anticolisión",
  "Civil twilight — lighting recommended": "Crepúsculo civil: se recomiendan luces",
  "Daytime operations": "Operación diurna",
  "GNSS satellites": "Satélites GNSS",
  "{n} above 10° mask": "{n} sobre la máscara de 10°",

  // ─── science/scores.ts: bite index ─────────────────────────────────────────
  Poor: "Mala",
  Fair: "Regular",
  Good: "Buena",
  Excellent: "Excelente",
  "Falling barometer ahead of a front": "Barómetro en descenso antes de un frente",
  "Stable pressure": "Presión estable",
  "Pressure rising slowly": "Presión en lento ascenso",
  "Sharp post-frontal pressure rise": "Fuerte subida de presión tras el frente",
  "Rapid pressure fall — feeding burst likely before the storm": "Caída rápida de presión: probable racha de actividad antes de la tormenta",
  "Solunar major period": "Periodo solunar mayor",
  "Solunar minor period": "Periodo solunar menor",
  "Moon phase rating {n}/4": "Calificación de fase lunar {n}/4",
  "Low-light feeding window (dawn/dusk)": "Ventana de alimentación con poca luz (amanecer/atardecer)",
  "Overcast keeps fish shallow": "El cielo nublado mantiene a los peces en aguas poco profundas",
  "Light chop breaks up the surface": "El oleaje ligero rompe la superficie",
  "Strong wind — difficult presentation": "Viento fuerte: presentación difícil",
  "Active water temperature": "Temperatura del agua favorable",
  "Lethargic water temperature": "Temperatura del agua que aletarga a los peces",
  "Flow rising fast — turbid water": "Caudal en rápido aumento: agua turbia",
  "Stable river flow": "Caudal del río estable",
  Thunderstorms: "Tormentas eléctricas",
  "Lightning risk — get off the water when thunder is audible.": "Riesgo de rayos: sal del agua cuando oigas truenos.",
  "Light rain washes in food": "La lluvia ligera arrastra alimento al agua",

  // ─── science/air.ts (US AQI categories; "Good" is with the bite index) ─────
  Moderate: "Moderada",
  "Unhealthy for Sensitive Groups": "Dañina a la salud para grupos sensibles",
  USG: "Grupos sensibles",
  Unhealthy: "Dañina a la salud",
  "Very Unhealthy": "Muy dañina a la salud",
  Hazardous: "Peligrosa",
  "Air quality is satisfactory. Great day to be outside.": "La calidad del aire es satisfactoria. Es un gran día para estar afuera.",
  "Unusually sensitive people should consider reducing prolonged or heavy exertion.":
    "Las personas inusualmente sensibles deberían considerar reducir el esfuerzo prolongado o intenso.",
  "Sensitive groups (asthma, heart disease, children, older adults) should limit prolonged exertion.":
    "Los grupos sensibles (asma, enfermedades del corazón, niños, adultos mayores) deberían limitar el esfuerzo prolongado.",
  "Everyone should reduce prolonged or heavy exertion; sensitive groups should avoid it.":
    "Todos deberían reducir el esfuerzo prolongado o intenso; los grupos sensibles deberían evitarlo.",
  "Health alert: everyone should avoid prolonged exertion outdoors.": "Alerta de salud: todos deberían evitar el esfuerzo prolongado al aire libre.",
  "Emergency conditions. Remain indoors with filtered air.": "Condiciones de emergencia. Permanece en interiores con aire filtrado.",

  // ─── Lowercase ids shown as text (show with `sentence(t(id))`) ─────────────
  // science/pressure.ts tendency
  steady: "estable",
  "rising slowly": "subiendo lentamente",
  rising: "subiendo",
  "rising quickly": "subiendo rápidamente",
  "rising very rapidly": "subiendo muy rápidamente",
  "falling slowly": "bajando lentamente",
  falling: "bajando",
  "falling quickly": "bajando rápidamente",
  "falling very rapidly": "bajando muy rápidamente",
  // science/air.ts pollen levels, feeds/flood-gauges.ts categories, science/atmosphere.ts cloud layers
  none: "ninguna",
  low: "baja",
  mid: "media",
  moderate: "moderada",
  high: "alta",
  "very high": "muy alta",
  action: "acción",
  minor: "menor",
  major: "mayor",
  // science/wind.ts shear class
  light: "ligera",
  strong: "fuerte",
  // fire-weather.ts FIRE_LEVELS ("Low" is left to `t("low")`: "Low" alone means Mínima)
  elevated: "elevada",
  critical: "crítica",
  extreme: "extrema",
  Elevated: "Elevada",
  Critical: "Crítica",
  Extreme: "Extrema",

  // ─── fire-weather.ts (smoke outlook) ───────────────────────────────────────
  "Heavy smoke": "Humo denso",
  "Very unhealthy air. Stay indoors with windows closed and filter the air if you can.":
    "Aire muy dañino a la salud. Quédate en interiores con las ventanas cerradas y filtra el aire si puedes.",
  "Very smoky": "Mucho humo",
  "Unhealthy air for everyone. Limit time outside.": "Aire dañino a la salud para todos. Limita el tiempo afuera.",
  Smoky: "Con humo",
  "Unhealthy for sensitive groups. Consider a mask outside if you have asthma or heart disease.":
    "Dañino a la salud para grupos sensibles. Considera usar mascarilla afuera si tienes asma o una enfermedad del corazón.",
  "Slightly elevated particles; only unusually sensitive people are likely to notice.":
    "Partículas ligeramente elevadas; solo las personas inusualmente sensibles lo notarán.",
  "Hazy sky": "Cielo brumoso",
  "Smoke or dust high overhead: hazy skies and vivid sunsets, but the air at ground level is fine.":
    "Humo o polvo en lo alto: cielo brumoso y atardeceres intensos, pero el aire a nivel del suelo está bien.",
  "Clear air": "Aire limpio",
  "No smoke or haze to speak of.": "Prácticamente sin humo ni bruma.",

  // ─── astro/moon.ts ─────────────────────────────────────────────────────────
  "New Moon": "Luna nueva",
  "Waxing Crescent": "Luna creciente",
  "First Quarter": "Cuarto creciente",
  "Waxing Gibbous": "Gibosa creciente",
  "Full Moon": "Luna llena",
  "Waning Gibbous": "Gibosa menguante",
  "Last Quarter": "Cuarto menguante",
  "Waning Crescent": "Luna menguante",

  // ─── feeds/parse.ts (SPC outlook) ──────────────────────────────────────────
  "General thunderstorms": "Tormentas eléctricas generales",
  "Marginal risk": "Riesgo marginal",
  "Slight risk": "Riesgo ligero",
  "Enhanced risk": "Riesgo mejorado",
  "Moderate risk": "Riesgo moderado",
  "High risk": "Riesgo alto",
  "Significant tornado (EF2 or stronger)": "Tornado significativo (EF2 o más fuerte)",
  "Significant hail (2 in. or larger)": "Granizo significativo (2 in o más grande)",
  "Significant wind (75 mph or stronger)": "Viento significativo (75 mph o más fuerte)",

  // ─── feeds/tropical-parse.ts (stormTitle, basins) ──────────────────────────
  "Hurricane {name}": "Huracán {name}",
  "Typhoon {name}": "Tifón {name}",
  "Super Typhoon {name}": "Supertifón {name}",
  "Tropical Storm {name}": "Tormenta tropical {name}",
  "Tropical Depression {name}": "Depresión tropical {name}",
  "Subtropical Storm {name}": "Tormenta subtropical {name}",
  "Subtropical Depression {name}": "Depresión subtropical {name}",
  "Post-Tropical Cyclone {name}": "Ciclón postropical {name}",
  "Potential Tropical Cyclone {name}": "Ciclón tropical potencial {name}",
  "Tropical Cyclone {name}": "Ciclón tropical {name}",
  Atlantic: "Atlántico",
  "Eastern Pacific": "Pacífico oriental",
  "Central Pacific": "Pacífico central",

  // ─── feeds/storm-parse.ts (reportTitle and sourceLabel output) ─────────────
  "Funnel cloud": "Nube embudo",
  Waterspout: "Tromba marina",
  "Thunderstorm wind gust": "Ráfaga de viento de tormenta eléctrica",
  "Thunderstorm wind damage": "Daños por viento de tormenta eléctrica",
  "Marine thunderstorm wind": "Viento marino de tormenta eléctrica",
  "Non-thunderstorm wind gust": "Ráfaga de viento sin tormenta eléctrica",
  "Non-thunderstorm wind damage": "Daños por viento sin tormenta eléctrica",
  "Flash flood": "Inundación repentina",
  Flood: "Inundación",
  "Coastal flood": "Inundación costera",
  Blizzard: "Ventisca",
  Sleet: "Aguanieve",
  "Ice storm": "Tormenta de hielo",
  "Snow squall": "Turbonada de nieve",
  "Dense fog": "Niebla densa",
  "High sustained winds": "Vientos sostenidos fuertes",
  "High astronomical tides": "Mareas astronómicas altas",
  "Storm surge": "Marejada ciclónica",
  "Rip currents": "Corrientes de resaca",
  "Dust storm": "Tormenta de polvo",
  "Dust devil": "Remolino de polvo",
  "Extreme cold": "Frío extremo",
  "Extreme heat": "Calor extremo",
  "Excessive heat": "Calor excesivo",
  Wildfire: "Incendio forestal",
  "Debris flow": "Flujo de escombros",
  Landslide: "Deslizamiento de tierra",
  Avalanche: "Avalancha",
  "Trained spotter": "Observador capacitado",
  "Storm chaser": "Cazador de tormentas",
  Public: "Público",
  "Law enforcement": "Policía",
  "Emergency manager": "Gestor de emergencias",
  "Broadcast media": "Medios de comunicación",
  "Social media": "Redes sociales",
  "NWS storm survey": "Evaluación de tormenta del NWS",
  "NWS employee": "Empleado del NWS",
  "Amateur radio": "Radioaficionado",
  "Fire department/rescue": "Bomberos/rescate",
  "Official NWS obs": "Observación oficial del NWS",
  "Co-op observer": "Observador cooperativo",
  Newspaper: "Periódico",
  "County official": "Funcionario del condado",
  "Local official": "Funcionario local",
  "State official": "Funcionario estatal",
  "Department of highways": "Departamento de carreteras",
  "Utility company": "Compañía de servicios públicos",
  "Insurance company": "Compañía de seguros",
  "Park/forest service": "Servicio de parques/bosques",
  "Other federal agency": "Otra agencia federal",

  // ─── feeds/wildfires.ts ────────────────────────────────────────────────────
  Complex: "Complejo",
  "Unnamed fire": "Incendio sin nombre",

  // ─── scorecard.ts (HIT_RULE) ───────────────────────────────────────────────
  "Rain, drizzle, showers or thunderstorms": "Lluvia, llovizna, chubascos o tormentas eléctricas",
  "Snow or freezing precipitation": "Nieve o precipitación helada",
  "Strong gusts or sustained wind": "Ráfagas fuertes o viento sostenido",

  // ─── radar/products.ts, radar/satellite.ts, radar/export-loop.ts ───────────
  "Base Reflectivity": "Reflectividad base",
  "Base Velocity": "Velocidad base",
  "Storm-Relative Velocity": "Velocidad relativa a la tormenta",
  "Correlation Coefficient": "Coeficiente de correlación",
  "Differential Reflectivity": "Reflectividad diferencial",
  "Hydrometeor Classification": "Clasificación de hidrometeoros",
  "{sat} infrared, {time}": "{sat}, infrarrojo, {time}",
  "{sat} visible, {time}": "{sat}, visible, {time}",
  "Radar loop": "Animación del radar",
  "Save or share radar loop": "Guarda o comparte la animación del radar",

  // ─── place-name.ts, device-position.ts, feed errors ────────────────────────
  "My location": "Mi ubicación",
  "Couldn't get a current location fix. Try again with a clear view of the sky.":
    "No se pudo obtener tu ubicación actual. Intenta de nuevo con vista despejada al cielo.",
  "Location permission denied": "Permiso de ubicación denegado",
  "No long-record weather station near this location (US only)":
    "No hay una estación meteorológica con registro largo cerca de este lugar (solo EE. UU.)",
  "Forecaster notes are only available in the US": "Las notas del pronosticador solo están disponibles en EE. UU.",
  "No NWS office for this location": "No hay una oficina del NWS para este lugar",

  // ─── afd.ts: section headings ──────────────────────────────────────────────
  "What's changed": "Qué cambió",
  "Key messages": "Mensajes clave",
  "Tides and coastal flooding": "Mareas e inundación costera",
  Today: "Hoy",
  Tonight: "Esta noche",
  Synopsis: "Sinopsis",
  Discussion: "Discusión",
  "Near term": "Muy corto plazo",
  "Short term": "Corto plazo",
  "Long term": "Largo plazo",
  Aviation: "Aviación",
  Marine: "Marino",
  Hydrology: "Hidrología",
  Climate: "Clima",
  Update: "Actualización",

  // ─── afd.ts: GLOSSARY meanings (terms stay as the forecasters wrote them) ──
  "A small ripple in the upper-level winds that can trigger clouds, rain or storms as it passes.":
    "Una pequeña ondulación en los vientos de altura que puede generar nubes, lluvia o tormentas a su paso.",
  "A dip in the upper-level winds: usually cooler, unsettled weather.":
    "Una depresión en los vientos de altura: suele traer tiempo más fresco e inestable.",
  "A bulge in the upper-level winds: usually warm, dry and calm weather.":
    "Un abultamiento en los vientos de altura: suele traer tiempo cálido, seco y tranquilo.",
  "A storm spinning high in the atmosphere; brings clouds, showers and cooler air, and can be slow to move.":
    "Una tormenta que gira en lo alto de la atmósfera; trae nubes, chubascos y aire más fresco, y puede moverse lentamente.",
  "The atmosphere warming and expanding (rises, usually fair weather) or cooling and shrinking (falls, usually unsettled).":
    "La atmósfera que se calienta y se expande (aumentos, por lo general buen tiempo) o se enfría y se contrae (descensos, por lo general tiempo inestable).",
  "Decameters (10 m). Used for the height of pressure levels; higher means warmer air.":
    "Decámetros (10 m). Se usan para la altura de los niveles de presión; más alto significa aire más cálido.",
  "Pressure levels used as heights: 850 mb is about 1.5 km up, 500 mb about 5.5 km, 250 mb near jet-stream level.":
    "Niveles de presión usados como alturas: 850 mb está a unos 1.5 km de altura, 500 mb a unos 5.5 km y 250 mb cerca del nivel de la corriente en chorro.",
  "Air being carried in by the wind: warm advection warms things up, cold advection cools them down.":
    "Aire transportado por el viento: la advección cálida calienta el ambiente y la advección fría lo enfría.",
  "Sinking air. It dries and warms as it sinks, which clears skies and stops rain.":
    "Aire que desciende. Se seca y se calienta al bajar, lo que despeja el cielo y detiene la lluvia.",
  "A layer where temperature rises with height. It traps fog, haze and smoke near the ground and can cap storms.":
    "Una capa donde la temperatura aumenta con la altura. Atrapa niebla, bruma y humo cerca del suelo y puede frenar las tormentas.",
  "Fuel for thunderstorms (how much energy rising air can gain). Over 1000 J/kg is plenty for strong storms.":
    "Combustible para las tormentas eléctricas (cuánta energía puede ganar el aire al subir). Más de 1000 J/kg es suficiente para tormentas fuertes.",
  "Winds changing speed or direction with height. With instability it lets storms organise and rotate.":
    "Vientos que cambian de velocidad o dirección con la altura. Con inestabilidad, permite que las tormentas se organicen y roten.",
  "How easily air keeps rising once it starts, the key ingredient for thunderstorms.":
    "Qué tan fácilmente sigue subiendo el aire una vez que empieza: el ingrediente clave de las tormentas eléctricas.",
  "Rising air that builds showers and thunderstorms.": "Aire ascendente que forma chubascos y tormentas eléctricas.",
  "A large, organised cluster or line of thunderstorms that can last for hours and cover hundreds of miles.":
    "Un grupo o línea grande y organizada de tormentas eléctricas que puede durar horas y cubrir cientos de millas.",
  "A measure of moisture in the air. Above about 65 °F (18 °C) feels muggy and feeds storms.":
    "Una medida de la humedad del aire. Por encima de unos 65 °F (18 °C) se siente bochornoso y alimenta las tormentas.",
  "Precipitable water: how much moisture is in the air above you. High values mean heavy downpours are possible.":
    "Agua precipitable: cuánta humedad hay en el aire sobre ti. Los valores altos indican que pueden darse aguaceros intensos.",
  "How fast temperature drops with height. Steep lapse rates mean more unstable air.":
    "Qué tan rápido baja la temperatura con la altura. Un gradiente pronunciado indica aire más inestable.",
  "Large scale: the weather systems you'd see on a national map.": "Gran escala: los sistemas meteorológicos que verías en un mapa nacional.",
  "Small scale, a few to a few hundred miles: individual storms, sea breezes, lake-effect bands.":
    "Pequeña escala, de unas pocas a unos cientos de millas: tormentas individuales, brisas marinas, bandas de efecto lago.",
  "Many runs of a forecast model with slightly different starts. Agreement between them means more confidence.":
    "Muchas ejecuciones de un modelo de pronóstico con condiciones iniciales ligeramente distintas. Si coinciden, hay más confianza.",
  "A single model run (as opposed to an ensemble of many).": "Una sola ejecución del modelo (a diferencia de un conjunto de muchas).",
  "Grouping ensemble members into a few likely scenarios.": "Agrupar los miembros del conjunto en unos pocos escenarios probables.",
  "National Blend of Models: the NWS's statistical blend of many models, the starting point for most forecasts.":
    "National Blend of Models: la combinación estadística de muchos modelos del NWS, el punto de partida de la mayoría de los pronósticos.",
  "The main US global weather model.": "El principal modelo meteorológico global de EE. UU.",
  "The European global weather model.": "El modelo meteorológico global europeo.",
  "A US regional model covering North America.": "Un modelo regional de EE. UU. que cubre América del Norte.",
  "High-Resolution Rapid Refresh: an hourly-updating US model good at individual storms over the next 18–48 hours.":
    "High-Resolution Rapid Refresh: un modelo de EE. UU. que se actualiza cada hora, bueno para tormentas individuales en las próximas 18–48 horas.",
  "High-resolution models that try to show individual thunderstorms; HREF is a blend of several.":
    "Modelos de alta resolución que intentan mostrar tormentas eléctricas individuales; HREF es una combinación de varios.",
  "A front forming or strengthening, which often focuses a band of rain or snow.":
    "Un frente que se forma o se intensifica, lo que a menudo concentra una banda de lluvia o nieve.",
  "Air gliding up and over colder air ahead of a warm front, giving widespread light rain or snow.":
    "Aire que se desliza hacia arriba sobre aire más frío delante de un frente cálido, con lluvia o nieve ligera extensa.",
  "A combined measure of heat and moisture; high values mark the air that fuels storms.":
    "Una medida combinada de calor y humedad; los valores altos marcan el aire que alimenta las tormentas.",
  "Following the daily cycle: e.g. showers that pop up with afternoon heating and fade at night.":
    "Que sigue el ciclo diario: p. ej., chubascos que surgen con el calor de la tarde y se disipan de noche.",
  "Wind blowing from land out to sea; on the West Coast it brings hot, dry, gusty weather.":
    "Viento que sopla de la tierra hacia el mar; en la costa oeste trae tiempo caluroso, seco y con ráfagas.",
  "Hot, very dry, gusty winds blowing from the deserts toward the Southern California coast. A major fire danger.":
    "Vientos calientes, muy secos y con ráfagas que soplan desde los desiertos hacia la costa del sur de California. Un gran peligro de incendios.",
  "Cold air crossing warmer lake water picks up moisture and drops narrow, intense bands of snow or rain downwind.":
    "El aire frío que cruza agua de lago más cálida absorbe humedad y deja bandas estrechas e intensas de nieve o lluvia a sotavento.",
  "Aviation flying categories from good (VFR) to poor (IFR), based on cloud height and visibility.":
    "Categorías de vuelo en aviación, de buenas (VFR) a malas (IFR), según la altura de las nubes y la visibilidad.",
  "Terminal Aerodrome Forecast: the official airport weather forecast.": "Terminal Aerodrome Forecast: el pronóstico oficial del tiempo para un aeropuerto.",
  "Winds or waves hazardous to small boats.": "Vientos u olas peligrosos para embarcaciones pequeñas.",
  "Probability of precipitation: the chance of measurable rain or snow at a point.":
    "Probabilidad de precipitación: la probabilidad de lluvia o nieve medible en un punto.",
  "Quantitative precipitation forecast: the expected rain or melted snow total.":
    "Pronóstico cuantitativo de precipitación: el total esperado de lluvia o nieve derretida.",
  "A stuck upper-level pattern that keeps the same weather around for days.":
    "Un patrón estancado en los vientos de altura que mantiene el mismo tiempo por días.",
  "The fast river of air 30,000–40,000 ft up that steers storms.": "El río de aire veloz a 30,000–40,000 ft de altura que guía las tormentas.",
  "A front that stops moving; rain can repeat over the same area along it.":
    "Un frente que deja de moverse; la lluvia puede repetirse sobre la misma zona a lo largo de él.",
  "Daytime heating stirring the lowest few thousand feet, which brings stronger winds aloft down to the ground and dries the air.":
    "El calentamiento diurno agita los primeros miles de pies de la atmósfera, lo que baja hasta el suelo los vientos más fuertes de altura y seca el aire.",
  "Model Output Statistics: model forecasts corrected for each location's known biases.":
    "Model Output Statistics: pronósticos de modelos corregidos según los sesgos conocidos de cada lugar.",
};
