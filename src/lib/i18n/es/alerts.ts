/** Alerts settings (components/alerts/**): notifications, more notifications, saved places, custom alerts. */
export const ALERTS: Record<string, string> = {
  // ─── Notifications panel ───────────────────────────────────────────────────
  Notifications: "Notificaciones",
  "NWS warnings for your places, and your custom alerts": "Avisos del NWS para tus lugares y tus alertas personalizadas",
  "Notify me": "Notificarme",
  "Watch my selected location": "Vigilar mi ubicación seleccionada",
  "Which alerts: warnings only, or warnings plus watches and advisories": "Qué alertas: solo avisos, o avisos más vigilancias y advertencias",
  "Which alerts": "Qué alertas",
  Warnings: "Avisos",
  "+ Watches": "+ Vigilancias",
  "Notify me about": "Notificarme sobre",
  "My custom alerts": "Mis alertas personalizadas",
  Sent: "Enviada",
  "Send a test notification": "Enviar una notificación de prueba",
  "Notifications are working. Warnings for your places will look like this.": "Las notificaciones funcionan. Los avisos para tus lugares se verán así.",
  "Couldn't show a notification. Check that Storm Central's notifications are allowed in your phone's settings.":
    "No se pudo mostrar una notificación. Revisa que las notificaciones de Storm Central estén permitidas en la configuración de tu teléfono.",
  "Notifications are blocked. Allow them for Storm Central in your browser or system settings.":
    "Las notificaciones están bloqueadas. Permítelas para Storm Central en la configuración de tu navegador o sistema.",
  "This browser can't show notifications.": "Este navegador no puede mostrar notificaciones.",
  "Allow notifications when your device asks, or tap Send a test notification.":
    "Permite las notificaciones cuando tu dispositivo lo pida, o toca Enviar una notificación de prueba.",
  "Checked about every 15 minutes, even when the app is closed.": "Se comprueba cada 15 minutos aproximadamente, incluso con la app cerrada.",
  "Checked every 2 minutes while Storm Central is open (the Windows app keeps checking from the tray).":
    "Se comprueba cada 2 minutos mientras Storm Central está abierto (la app de Windows sigue comprobando desde la bandeja del sistema).",

  // ─── Android native checker status ─────────────────────────────────────────
  "Background checks:": "Comprobaciones en segundo plano:",
  "last ran {time} ({result}).": "última ejecución {time} ({result}).",
  "last ran {time}.": "última ejecución {time}.",
  "waiting for the first run (needs a network connection).": "esperando la primera ejecución (necesita conexión a internet).",
  "Android is blocking Storm Central's notifications. Turn them on in notification settings.":
    "Android está bloqueando las notificaciones de Storm Central. Actívalas en la configuración de notificaciones.",
  "Battery optimization can delay checks by an hour or more on some phones. Allow Storm Central to run in the background so warnings arrive on time.":
    "La optimización de batería puede retrasar las comprobaciones una hora o más en algunos teléfonos. Permite que Storm Central se ejecute en segundo plano para que los avisos lleguen a tiempo.",
  "Allow background activity": "Permitir actividad en segundo plano",
  "Notification settings": "Configuración de notificaciones",

  // ─── More notifications ────────────────────────────────────────────────────
  "More notifications": "Más notificaciones",
  "Turn on Notify me above to use these": "Activa Notificarme arriba para usarlas",
  "For your watched places": "Para tus lugares vigilados",
  "Rain starting soon": "Lluvia a punto de comenzar",
  "When rain or snow is about to start where you are, once per spell (15-minute forecast)":
    "Cuando la lluvia o la nieve está por comenzar donde estás, una vez por episodio (pronóstico cada 15 minutos)",
  "How far ahead": "Con cuánta anticipación",
  "Up to 1 hour ahead": "Hasta 1 hora antes",
  "Up to {n} min ahead": "Hasta {n} min antes",
  "A strong storm on radar (hail, rotation or heavy core) due to reach a watched place within the hour, with its arrival time":
    "Una tormenta fuerte en el radar (granizo, rotación o núcleo intenso) que llegará a un lugar vigilado en menos de una hora, con su hora de llegada",
  "Morning briefing": "Resumen matutino",
  "Today's high and low, rain chance and anything notable, once a day":
    "La máxima y la mínima de hoy, la probabilidad de lluvia y cualquier cosa destacable, una vez al día",
  "Briefing time": "Hora del resumen",
  "Lightning nearby": "Rayos cerca",
  "Strikes in the last 15 minutes (NOAA), at most every 45 minutes per place": "Rayos en los últimos 15 minutos (NOAA), como máximo cada 45 minutos por lugar",
  "Lightning distance": "Distancia de los rayos",
  "Nearby spotter reports": "Reportes de observadores cercanos",
  "Tornado, hail, wind damage, flooding or other serious reports from the last hour":
    "Reportes de tornado, granizo, daños por viento, inundación u otros graves de la última hora",
  "Spotter report distance": "Distancia de los reportes de observadores",
  "Activity on your reports": "Actividad en tus reportes",
  "When someone confirms or comments on a report you posted": "Cuando alguien confirma o comenta un reporte que publicaste",
  "Sign in to the spotter network to use this": "Inicia sesión en la red de observadores para usar esto",

  // ─── Saved places ──────────────────────────────────────────────────────────
  "Saved places": "Lugares guardados",
  "Warnings are checked for each place (up to {n})": "Se buscan avisos para cada lugar (hasta {n})",
  "Save current": "Guardar el actual",
  "No saved places": "No hay lugares guardados",
  "Save home, work or the cabin to get warnings for them wherever you are.": "Guarda tu casa, tu trabajo o la cabaña para recibir sus avisos estés donde estés.",
  "Show this place": "Mostrar este lugar",
  "Add a place": "Agregar un lugar",
  "Search a city or town": "Busca una ciudad o pueblo",
  "No places match “{term}”.": "Ningún lugar coincide con “{term}”.",

  // ─── Custom alerts ─────────────────────────────────────────────────────────
  "Custom alerts": "Alertas personalizadas",
  "Get notified when a forecast crosses your threshold, once a day per alert":
    "Recibe una notificación cuando el pronóstico cruce tu umbral, una vez al día por alerta",
  "For example: wind at flight altitude below 15 mph, or bite index above 70.":
    "Por ejemplo: viento a altitud de vuelo por debajo de 15 mph, o índice de picada por encima de 70.",
  "Selected location ({name})": "Ubicación seleccionada ({name})",
  "Removed place": "Lugar eliminado",
  "{place}, next {n} h": "{place}, próximas {n} h",
  "Delete alert": "Eliminar alerta",
  When: "Cuando",
  Is: "Está",
  Above: "Por encima de",
  Below: "Por debajo de",
  Value: "Valor",
  "Value ({unit})": "Valor ({unit})",
  At: "En",
  "Selected location": "Ubicación seleccionada",
  Within: "En las próximas",
  "{n} hours": "{n} horas",
  "Add alert": "Agregar alerta",
  "Places and alerts are stored on this device only. Notifications can be late or missed; always follow official warnings.":
    "Los lugares y las alertas se guardan solo en este dispositivo. Las notificaciones pueden llegar tarde o perderse; sigue siempre los avisos oficiales.",
};
