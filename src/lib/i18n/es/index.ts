/**
 * Spanish (Latin American, US conventions). One file per area of the app so
 * each can be edited on its own; keys are the exact English text, values the
 * Spanish. A key in several files must have the same Spanish everywhere.
 *
 * Style: address the person as "tú" (Abre, Toca, Tu reporte), sentence case,
 * short UI labels. Keep untranslated: Storm Central, NWS, NOAA, SPC, NEXRAD,
 * IEM, Open-Meteo, GitHub, unit symbols (°F, mph, km/h, in, mm, hPa, inHg).
 *
 * Glossary (use these, consistently):
 *   Warning = Aviso · Watch = Vigilancia · Advisory = Advertencia · Statement = Declaración
 *   Alert(s) = Alerta(s) · Notification(s) = Notificación(es) · Custom alert = Alerta personalizada
 *   Forecast = Pronóstico · Hourly forecast = Pronóstico por hora · 10-day forecast = Pronóstico de 10 días
 *   Current conditions = Condiciones actuales · Feels like = Sensación térmica
 *   High / Low = Máxima / Mínima (short: Máx / Mín) · Humidity = Humedad · Dew point = Punto de rocío
 *   Pressure = Presión · Visibility = Visibilidad · UV index = Índice UV · Cloud cover = Nubosidad
 *   Wind = Viento · Gusts = Ráfagas · Precipitation = Precipitación · Rain = Lluvia · Snow = Nieve
 *   Thunderstorm = Tormenta eléctrica · Severe = Severo/a · Hail = Granizo · Lightning = Rayos
 *   Tornado = Tornado · Funnel cloud = Nube embudo · Flood/Flooding = Inundación · Flash flood = Inundación repentina
 *   Storm cell = Celda de tormenta · Mesocyclone = Mesociclón · Tornado vortex signature = Firma de vórtice tornádico
 *   Radar = Radar · Satellite = Satélite · Outlook = Perspectiva · Risk = Riesgo
 *   Sunrise / Sunset = Amanecer / Atardecer · Moon phase = Fase lunar · Air quality = Calidad del aire
 *   Spotter = Observador · Spotter Network = Red de observadores · Report (noun) = Reporte
 *   Post a report = Publicar un reporte · Confirm = Confirmar · Comment = Comentario/Comentar
 *   Block = Bloquear · Moderation = Moderación · Profile = Perfil · Rank = Rango
 *   Settings = Configuración · Account = Cuenta · Sign in = Iniciar sesión · Sign out = Cerrar sesión
 *   Create account = Crear cuenta · Password = Contraseña · Username = Nombre de usuario · Email = Correo electrónico
 *   Save = Guardar · Cancel = Cancelar · Delete = Eliminar · Remove = Quitar · Close = Cerrar · Retry/Try again = Reintentar
 *   Loading = Cargando · Search = Buscar · Saved places = Lugares guardados · My location = Mi ubicación
 *   Mode names: Daily = Hoy · Radar = Radar · UAV pilot = Drones · Angler = Pesca · Air quality = Calidad del aire
 *   Theme = Tema · Light / Dark / System = Claro / Oscuro / Sistema · Units = Unidades · Widget = Widget
 *   Update = Actualizar (noun: Actualización) · Download = Descargar · Install = Instalar
 */
import { ALERTS } from "./alerts";
import { COMMON } from "./common";
import { COMMUNITY } from "./community";
import { DAILY } from "./daily";
import { GUIDE } from "./guide";
import { LIB } from "./lib";
import { MAP } from "./map";
import { MARINE } from "./marine";
import { MODES } from "./modes";
import { NOTIFY } from "./notify";
import { PRO } from "./pro";
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
  ...MARINE,
  ...COMMUNITY,
  ...SETTINGS,
  ...ALERTS,
  ...NOTIFY,
  ...PRO,
  ...GUIDE,
};
