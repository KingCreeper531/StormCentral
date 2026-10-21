/**
 * The Professional mode guide (lib/pro/guide.ts, components/pro/guide-*.tsx):
 * the tour, the product and tool reference, how-tos and the glossary. Same
 * terms as es/pro.ts (cizalladura, corte vertical, bucle, cuadro, sondeo);
 * meteorological abbreviations stay in English.
 */
export const GUIDE: Record<string, string> = {
  // ─── buttons, sections, settings ───────────────────────────────────────────
  Guide: "Guía",
  "Professional mode guide": "Guía del modo profesional",
  "Take the tour": "Hacer el recorrido",
  Start: "Inicio",
  Products: "Productos",
  Tools: "Herramientas",
  "How to": "Cómo hacerlo",
  Glossary: "Glosario",
  "Search the guide": "Buscar en la guía",
  "Nothing in the guide matches that.": "Nada en la guía coincide con eso.",
  "How to read it": "Cómo leerlo",
  "Look for": "Qué buscar",
  "How to use it": "Cómo usarlo",
  "Desktop only": "Solo en computadora",
  "Needs the Pro data server": "Requiere el servidor de datos Pro",
  "A tour of the workspace and what every product, tool and term means. It's all optional: open it whenever you like.":
    "Un recorrido por el espacio de trabajo y qué significa cada producto, herramienta y término. Todo es opcional: ábrelo cuando quieras.",
  "Hide the guide button": "Ocultar el botón de la guía",
  "Settings → Professional mode brings it back.": "Configuración → Modo profesional lo vuelve a mostrar.",
  "Guide button": "Botón de la guía",
  "Shows a Guide button in Pro's toolbar: an optional tour of the workspace and what every product, tool and term means. Nothing opens unless you press it.":
    "Muestra un botón de Guía en la barra de Pro: un recorrido opcional por el espacio de trabajo y qué significa cada producto, herramienta y término. No se abre nada a menos que lo presiones.",
  "Step {n} of {total}": "Paso {n} de {total}",
  "End tour": "Terminar el recorrido",

  // ─── basics ────────────────────────────────────────────────────────────────
  "Quick start": "Inicio rápido",
  "Pick a layout and a radar site in the toolbar. Set each panel's product from its header, and for radar the elevation tilt. Press Space to play the loop. Move the pointer over a panel to read every panel at that spot. Pick a tool to analyse.":
    "Elige una distribución y una estación de radar en la barra de herramientas. Elige el producto de cada panel desde su encabezado y, para el radar, el ángulo de elevación. Presiona Espacio para reproducir el bucle. Mueve el puntero sobre un panel para leer todos los paneles en ese punto. Elige una herramienta para analizar.",
  "Panels move together": "Los paneles se mueven juntos",
  "All panels share one map: pan or zoom one and the others follow. A crosshair shows where your pointer is on the other panels.":
    "Todos los paneles comparten un mapa: desplaza o acerca uno y los demás lo siguen. Una cruz muestra dónde está tu puntero en los otros paneles.",
  "Time basis (TB)": "Base de tiempo (TB)",
  "The loop steps through the scan times of one panel, marked TB: the first radar panel. Every other panel shows its newest frame at or before that time, so products that update at different rates (radar every 4–6 minutes, MRMS every 2, satellite every 10) line up. Each panel's header shows its own scan time.":
    "El bucle avanza por los tiempos de escaneo de un panel, marcado TB: el primer panel de radar. Cada otro panel muestra su cuadro más reciente en ese momento o antes, para que los productos que se actualizan a distinto ritmo (el radar cada 4–6 minutos, MRMS cada 2, el satélite cada 10) coincidan. El encabezado de cada panel muestra su propio tiempo de escaneo.",
  "Times are in UTC (Z)": "Las horas están en UTC (Z)",
  "Pro mode shows times in UTC with a Z, like the NWS and AWIPS. 18:00Z is 2 PM Eastern daylight time.":
    "El modo Pro muestra las horas en UTC con una Z, como el NWS y AWIPS. 18:00Z son las 2 p. m. en el horario de verano del Este.",
  "Elevation tilts": "Ángulos de elevación",
  "The radar scans a stack of cones at rising angles. 0.5° is the lowest and closest to the ground; higher tilts look higher into a storm, and the farther the storm, the higher the beam.":
    "El radar escanea una pila de conos a ángulos crecientes. 0.5° es el más bajo y cercano al suelo; los ángulos más altos miran más arriba dentro de la tormenta, y cuanto más lejos está la tormenta, más alto pasa el haz.",
  "Where the data comes from": "De dónde vienen los datos",
  "Single-site radar comes from NOAA and the Iowa Environmental Mesonet, plus Level III and Level II data decoded in the app. National products come from NOAA's MRMS, satellite from GOES-East and -West. Level II volumes need a desktop; a few products need the Pro data server, and they're only listed when one is connected.":
    "El radar de una estación viene de NOAA y del Iowa Environmental Mesonet, además de datos Level III y Level II decodificados en la app. Los productos nacionales vienen del MRMS de NOAA y el satélite de GOES-East y -West. Los volúmenes Level II requieren una computadora; algunos productos requieren el servidor de datos Pro y solo aparecen cuando hay uno conectado.",
  Keyboard: "Teclado",
  "Space: play or pause. ← and →: step one frame. Esc: close the warning inspector.": "Espacio: reproducir o pausar. ← y →: avanzar un cuadro. Esc: cerrar el inspector de avisos.",

  // ─── products ──────────────────────────────────────────────────────────────
  "In dBZ. Greens are light rain, yellow to red heavy rain, purple and white very heavy rain or hail. Above about 55–60 dBZ in a storm's core, hail is likely.":
    "En dBZ. Los verdes son lluvia ligera, del amarillo al rojo lluvia fuerte, el morado y el blanco lluvia muy fuerte o granizo. Por encima de unos 55–60 dBZ en el núcleo de una tormenta, es probable el granizo.",
  "In knots. Green is moving toward the radar, red away from it. It's only the part of the wind along the beam: wind blowing across the beam reads near zero. Purple (RF) is range folding, where the radar can't tell the distance, so there's no data.":
    "En nudos. El verde se acerca al radar y el rojo se aleja. Es solo la parte del viento a lo largo del haz: el viento que cruza el haz se lee cerca de cero. El morado (RF) es el plegado de rango, donde el radar no puede saber la distancia, así que no hay datos.",
  "From 0 to about 1. 0.97 and above: rain or snow alone. 0.80–0.97: a mix, like hail with rain or melting snow. Below about 0.80: things that aren't weather, such as birds, insects, smoke and tornado debris.":
    "De 0 a cerca de 1. 0.97 o más: solo lluvia o nieve. 0.80–0.97: una mezcla, como granizo con lluvia o nieve derritiéndose. Por debajo de unos 0.80: cosas que no son meteorológicas, como aves, insectos, humo y escombros de tornados.",
  "In dB. Near 0: round or tumbling targets (small drops, hail, dry snow). 1–4 dB: big, flattened raindrops. Very high values in weak echo: insects or birds.":
    "En dB. Cerca de 0: blancos redondos o que giran (gotas pequeñas, granizo, nieve seca). 1–4 dB: gotas de lluvia grandes y aplanadas. Valores muy altos en eco débil: insectos o aves.",
  "Another country's national radar composite, from its weather service: Canada (ECCC), Germany (DWD), Finland (FMI), the Netherlands (KNMI) and Japan (JMA), matched to the loop's times.":
    "El compuesto nacional de radar de otro país, de su servicio meteorológico: Canadá (ECCC), Alemania (DWD), Finlandia (FMI), Países Bajos (KNMI) y Japón (JMA), sincronizado con los tiempos del bucle.",
  "In that service's own colours and units: reflectivity for Germany and Finland, precipitation rate for the others. The panel's colour bar shows the scale.":
    "En los colores y unidades de ese servicio: reflectividad para Alemania y Finlandia, intensidad de precipitación para los demás. La barra de colores del panel muestra la escala.",
  "Step up through the tilts to see a storm's structure: rotation from the ground to mid levels, a core leaning over its updraft, hail high up.":
    "Sube por los ángulos para ver la estructura de una tormenta: rotación desde el suelo hasta niveles medios, un núcleo inclinado sobre su corriente ascendente, granizo en lo alto.",
  "The live volume arrives in pieces as the radar scans, so the newest tilts fill in first at the bottom.":
    "El volumen en vivo llega por partes mientras el radar escanea, así que los ángulos más nuevos se completan primero desde abajo.",
  "How strongly the radar beam bounces back from rain, hail, snow and other targets, at the elevation tilt you pick. The lowest tilt is NOAA's super-resolution scan; higher tilts are decoded from the radar's Level III data.":
    "Qué tan fuerte rebota el haz del radar en la lluvia, el granizo, la nieve y otros blancos, en el ángulo de elevación que elijas. El ángulo más bajo es el escaneo de superresolución de NOAA; los más altos se decodifican de los datos Level III del radar.",
  "Hook echo: a curl on the back side of a storm (often its southwest side), where a tornado can form.":
    "Eco en gancho: un rizo en la parte trasera de una tormenta (a menudo su lado suroeste), donde se puede formar un tornado.",
  "Inflow notch or weak-echo hole: a gap where strong rising air enters the storm.": "Muesca de entrada o hueco de eco débil: un hueco por donde entra a la tormenta aire que asciende con fuerza.",
  "Bow echo: a line bulging forward. Damaging straight-line wind is likely at the front of the bulge.":
    "Eco en arco: una línea que se abomba hacia adelante. Es probable el viento lineal dañino al frente del abombamiento.",
  "Hail spike: a faint streak of weak echo pointing away from the radar behind a very strong core. It means large hail.":
    "Espiga de granizo: una franja tenue de eco débil que apunta en dirección opuesta al radar detrás de un núcleo muy fuerte. Indica granizo grande.",
  "On higher tilts, a strong core above weaker echo near the ground means a strong updraft holding rain and hail up.":
    "En ángulos más altos, un núcleo fuerte sobre un eco más débil cerca del suelo indica una corriente ascendente fuerte que sostiene la lluvia y el granizo.",
  "Doppler velocity: how fast targets move toward or away from the radar.": "Velocidad Doppler: qué tan rápido se acercan o alejan los blancos del radar.",
  "Couplet: bright green right next to bright red. That's rotation. Tight and strong near the ground, it can be a tornado.":
    "Par de velocidades: verde intenso justo al lado de rojo intenso. Es rotación. Si es estrecho y fuerte cerca del suelo, puede ser un tornado.",
  "Green and red facing each other is wind coming together; back to back near the ground, it's a downburst spreading out.":
    "Verde y rojo de frente es viento que converge; espalda con espalda cerca del suelo, es una ráfaga descendente que se dispersa.",
  "A strong band of one colour behind a line of storms is a damaging-wind surge.": "Una banda fuerte de un solo color detrás de una línea de tormentas es un empuje de viento dañino.",
  "Storm-relative velocity: velocity with the radar's estimate of the storms' average motion taken out, so rotation inside a fast-moving storm stands out.":
    "Velocidad relativa a la tormenta: la velocidad sin el movimiento promedio de las tormentas que estima el radar, para que destaque la rotación dentro de una tormenta rápida.",
  "Couplets often look tighter and stronger than on base velocity, especially when storms move fast.":
    "Los pares de velocidades suelen verse más estrechos y fuertes que en la velocidad base, sobre todo cuando las tormentas se mueven rápido.",
  "The motion taken out is an average for all storms; a storm moving differently can look a little off.":
    "El movimiento que se resta es un promedio de todas las tormentas; una tormenta que se mueve distinto puede verse un poco desviada.",
  "Correlation coefficient (ρHV): how alike the targets are in each spot.": "Coeficiente de correlación (ρHV): qué tan parecidos son los blancos en cada punto.",
  "Tornado debris signature: a small spot of low CC right on a velocity couplet, with echo still showing on reflectivity. A tornado is on the ground and throwing debris.":
    "Firma de escombros de tornado: una pequeña zona de CC bajo justo sobre un par de velocidades, con eco todavía visible en la reflectividad. Hay un tornado en el suelo levantando escombros.",
  "Hail: CC dips into the 0.80s and low 0.90s in the core.": "Granizo: el CC baja a 0.80–0.93 en el núcleo.",
  "A ring of lower CC around the radar is the melting layer, where snow turns to rain.": "Un anillo de CC más bajo alrededor del radar es la capa de fusión, donde la nieve se vuelve lluvia.",
  "Differential reflectivity: whether targets are wider than they are tall. Big raindrops flatten as they fall; hail tumbles and looks round.":
    "Reflectividad diferencial: si los blancos son más anchos que altos. Las gotas grandes se aplanan al caer; el granizo gira y se ve redondo.",
  "ZDR column: positive ZDR reaching above the freezing level on higher tilts, where a strong updraft lifts raindrops. It often comes before hail and a stronger storm.":
    "Columna de ZDR: ZDR positivo que llega por encima del nivel de congelación en ángulos más altos, donde una corriente ascendente fuerte eleva gotas de lluvia. Suele anticipar granizo y una tormenta más fuerte.",
  "ZDR arc: a band of high ZDR along the inflow edge of a supercell, a sign of strong low-level spin.":
    "Arco de ZDR: una banda de ZDR alto en el borde de entrada de una supercelda, señal de fuerte giro en niveles bajos.",
  "Hail core: high reflectivity with ZDR near 0.": "Núcleo de granizo: reflectividad alta con ZDR cerca de 0.",
  "Hydrometeor classification: the radar's best guess of what fills each spot, worked out from all the dual-pol products together.":
    "Clasificación de hidrometeoros: la mejor estimación del radar de qué hay en cada punto, calculada con todos los productos de polarización dual juntos.",
  "One colour per class: biological, ground clutter, ice crystals, dry snow, wet snow, rain, heavy rain, big drops, graupel, hail with rain, large hail and giant hail.":
    "Un color por clase: biológico, ecos del terreno, cristales de hielo, nieve seca, nieve húmeda, lluvia, lluvia fuerte, gotas grandes, granizo blando, granizo con lluvia, granizo grande y granizo gigante.",
  "It's an algorithm, not a measurement: check reflectivity, ZDR and CC yourself before trusting it, especially far from the radar.":
    "Es un algoritmo, no una medición: revisa tú la reflectividad, el ZDR y el CC antes de confiar en él, sobre todo lejos del radar.",
  "Specific differential phase: how much the radar's horizontal and vertical pulses fall out of step per kilometre. It follows how much liquid water is there.":
    "Fase diferencial específica: cuánto se desfasan los pulsos horizontal y vertical del radar por kilómetro. Sigue la cantidad de agua líquida que hay.",
  "In °/km. Near 0 in light rain, snow and hail; 1–3 °/km in heavy rain; more in torrential rain.":
    "En °/km. Cerca de 0 en lluvia ligera, nieve y granizo; 1–3 °/km en lluvia fuerte; más en lluvia torrencial.",
  "Flash flooding: high KDP in a storm that barely moves.": "Inundaciones repentinas: KDP alto en una tormenta que casi no se mueve.",
  "Hail doesn't raise KDP, so high KDP inside a hail core shows heavy rain falling with it.":
    "El granizo no aumenta el KDP, así que un KDP alto dentro de un núcleo de granizo indica lluvia fuerte cayendo con él.",
  "Vertically integrated liquid: all the water in the column over each spot, added up from every tilt.":
    "Líquido integrado verticalmente: toda el agua de la columna sobre cada punto, sumada en todos los ángulos.",
  "In kg/m². Bigger numbers mean a taller, wetter storm.": "En kg/m². Los números más altos indican una tormenta más alta y con más agua.",
  "A quick rise means a strengthening storm.": "Un aumento rápido indica una tormenta que se fortalece.",
  "A quick drop after a peak means the core is coming down: watch for a downburst.": "Una caída rápida después de un pico indica que el núcleo está bajando: atento a una ráfaga descendente.",
  "Enhanced echo tops from the radar: the highest point where it still sees 18 dBZ, i.e. how tall the storm is.":
    "Topes de eco mejorados del radar: el punto más alto donde aún detecta 18 dBZ, es decir, qué tan alta es la tormenta.",
  "In thousands of feet (kft).": "En miles de pies (kft).",
  "Tops climbing fast mean a strengthening updraft.": "Topes que suben rápido indican una corriente ascendente que se fortalece.",
  "Very high tops (around 50 kft and up) mark the strongest storms.": "Topes muy altos (unos 50 kft o más) marcan las tormentas más fuertes.",
  "The full Level II volume, decoded on your device: reflectivity at every tilt the radar scanned, not just the four Level III carries. Desktop only.":
    "El volumen Level II completo, decodificado en tu dispositivo: la reflectividad en cada ángulo que escaneó el radar, no solo los cuatro de Level III. Solo en computadora.",
  "Level II velocity at every tilt the radar scanned, decoded on your device. Desktop only.": "Velocidad Level II en cada ángulo que escaneó el radar, decodificada en tu dispositivo. Solo en computadora.",
  "Follow a couplet up through the tilts: rotation that reaches from near the ground to mid levels is a deep, strong mesocyclone.":
    "Sigue un par de velocidades hacia arriba por los ángulos: la rotación que va desde cerca del suelo hasta niveles medios es un mesociclón profundo y fuerte.",
  "Level II differential reflectivity at every tilt, decoded on your device. Desktop only.": "Reflectividad diferencial Level II en cada ángulo, decodificada en tu dispositivo. Solo en computadora.",
  "Find ZDR columns: step up the tilts and see how high positive ZDR reaches above the freezing level.":
    "Busca columnas de ZDR: sube por los ángulos y mira qué tan alto llega el ZDR positivo por encima del nivel de congelación.",
  "Level II correlation coefficient at every tilt, decoded on your device. Desktop only.": "Coeficiente de correlación Level II en cada ángulo, decodificado en tu dispositivo. Solo en computadora.",
  "A debris signature that reaches up several tilts means a strong tornado lofting debris high.":
    "Una firma de escombros que sube varios ángulos indica un tornado fuerte que eleva escombros muy alto.",
  "Every radar in the country blended into one map near the ground (NOAA's MRMS).": "Todos los radares del país combinados en un mapa cerca del suelo (el MRMS de NOAA).",
  "The big picture: lines, clusters and what's coming. Then switch a panel to one radar site for detail.":
    "El panorama general: líneas, grupos y lo que viene. Luego cambia un panel a una estación de radar para ver el detalle.",
  "Composite reflectivity (MRMS): the strongest echo anywhere in the column over each spot.": "Reflectividad compuesta (MRMS): el eco más fuerte en cualquier parte de la columna sobre cada punto.",
  "It shows cores that are still high up, so storms can look bigger and stronger than what's reaching the ground.":
    "Muestra núcleos que todavía están en lo alto, así que las tormentas pueden verse más grandes y fuertes que lo que llega al suelo.",
  "Echo tops for the whole country (MRMS): the highest point with 18 dBZ of echo.": "Topes de eco de todo el país (MRMS): el punto más alto con 18 dBZ de eco.",
  "Compare storms at a glance: the tallest are usually the strongest.": "Compara tormentas de un vistazo: las más altas suelen ser las más fuertes.",
  "Maximum expected size of hail (MRMS): the biggest hail likely at the ground, estimated from how much strong echo sits above the freezing level. Needs the Pro data server.":
    "Tamaño máximo esperado de granizo (MRMS): el granizo más grande probable en el suelo, estimado por cuánto eco fuerte hay sobre el nivel de congelación. Requiere el servidor de datos Pro.",
  "Hail diameter. The colour bar shows the sizes.": "Diámetro del granizo. La barra de colores muestra los tamaños.",
  "It's an estimate: reports from the ground confirm it.": "Es una estimación: los reportes desde el suelo la confirman.",
  "The biggest MESH at each spot over the last hour: the path a storm's hail has taken. Needs the Pro data server.":
    "El MESH más grande en cada punto durante la última hora: el camino que siguió el granizo de una tormenta. Requiere el servidor de datos Pro.",
  "Hail diameter.": "Diámetro del granizo.",
  "Long, wide swaths mark long-lived hail storms.": "Franjas largas y anchas marcan tormentas de granizo de larga duración.",
  "Rotation track (MRMS): the strongest low-level rotation at each spot over the last hour, from every radar. Needs the Pro data server.":
    "Trayectoria de rotación (MRMS): la rotación más fuerte en niveles bajos en cada punto durante la última hora, de todos los radares. Requiere el servidor de datos Pro.",
  "Brighter colours mean stronger rotation.": "Los colores más brillantes indican rotación más fuerte.",
  "A long, narrow track is where a mesocyclone, and possibly a tornado, has travelled.": "Una trayectoria larga y estrecha es por donde pasó un mesociclón, y posiblemente un tornado.",
  "Vertically integrated liquid for the whole country (MRMS). Needs the Pro data server.": "Líquido integrado verticalmente de todo el país (MRMS). Requiere el servidor de datos Pro.",
  "In kg/m².": "En kg/m².",
  "Compare storms across states at once.": "Compara tormentas de varios estados a la vez.",
  "Visible satellite (GOES ABI band 2): sunlight reflected off clouds. The sharpest band, but only in daylight.":
    "Satélite visible (banda 2 de GOES ABI): la luz solar reflejada por las nubes. La banda más nítida, pero solo de día.",
  "Towers of cumulus going up along a boundary: storms about to start.": "Torres de cúmulos creciendo a lo largo de un límite: tormentas a punto de empezar.",
  "Overshooting tops: bumpy domes above a storm's anvil, often casting a shadow.": "Topes sobresalientes: domos irregulares sobre el yunque de una tormenta, que a menudo proyectan sombra.",
  "Arcs of low cloud racing out from storms: outflow boundaries.": "Arcos de nubes bajas que se alejan rápido de las tormentas: límites de flujo de salida.",
  "Clean infrared (GOES ABI band 13): how cold cloud tops are, day and night.": "Infrarrojo limpio (banda 13 de GOES ABI): qué tan frías están las cimas de las nubes, de día y de noche.",
  "Colder tops are higher. The coldest colours are the tallest storms.": "Las cimas más frías son más altas. Los colores más fríos son las tormentas más altas.",
  "Tops cooling fast: a storm growing.": "Cimas que se enfrían rápido: una tormenta que crece.",
  "A V of cold cloud spreading downwind of a storm's top (an enhanced V) marks a very strong updraft.":
    "Una V de nube fría que se extiende a sotavento de la cima de una tormenta (una V realzada) marca una corriente ascendente muy fuerte.",
  "Water vapour: moisture in the middle and upper atmosphere, not clouds near the ground. Latest image only.":
    "Vapor de agua: la humedad en la atmósfera media y alta, no las nubes cerca del suelo. Solo la imagen más reciente.",
  "Bright or coloured is moist, dark is dry.": "Lo claro o con color es húmedo, lo oscuro es seco.",
  "Dark dry slots wrapping into a storm system, and the swirls of upper-level lows and jet streams.":
    "Ranuras secas oscuras que se enrollan en un sistema de tormentas, y los remolinos de bajas en altura y corrientes en chorro.",
  "Air Mass RGB: colours the air by temperature and moisture.": "RGB de masa de aire: colorea el aire según su temperatura y humedad.",
  "Green: warm, moist air. Blue and purple: cold air. Red and orange: dry air from high up sinking down, often near a strengthening low or jet. White: thick, high clouds.":
    "Verde: aire cálido y húmedo. Azul y morado: aire frío. Rojo y naranja: aire seco de lo alto que desciende, a menudo cerca de una baja que se intensifica o de una corriente en chorro. Blanco: nubes altas y gruesas.",
  "GeoColor: true colour by day; at night, low clouds in a light blue over a picture of city lights.":
    "GeoColor: color real de día; de noche, nubes bajas en azul claro sobre una imagen de las luces de las ciudades.",
  "An easy all-day view of where the clouds and storms are.": "Una vista fácil, de día y de noche, de dónde están las nubes y las tormentas.",
  "Dust RGB: blowing dust, day and night.": "RGB de polvo: polvo en suspensión, de día y de noche.",
  "Dust shows pink to magenta.": "El polvo se ve de rosa a magenta.",
  "Fire Temperature RGB: hot spots from wildfires.": "RGB de temperatura de incendios: puntos calientes de incendios forestales.",
  "Red is a cooler fire; orange, yellow and white are hotter and more intense.": "El rojo es un fuego menos caliente; naranja, amarillo y blanco son más calientes e intensos.",
  "Day Cloud Phase Distinction: tells water clouds from ice clouds in daylight. Needs the Pro data server.":
    "Distinción de fase de nubes diurna: distingue nubes de agua de nubes de hielo durante el día. Requiere el servidor de datos Pro.",
  "Water clouds look cyan or lavender; ice clouds green, yellow or orange.": "Las nubes de agua se ven cian o lavanda; las de hielo verdes, amarillas o naranjas.",
  "A cumulus tower turning from cyan to green and yellow is freezing at the top: a new storm going up.":
    "Una torre de cúmulos que pasa de cian a verde y amarillo se está congelando en la cima: una tormenta nueva en desarrollo.",
  "Night Fog (nighttime microphysics): picks out fog and low cloud at night. Needs the Pro data server.":
    "Niebla nocturna (microfísica nocturna): distingue la niebla y las nubes bajas de noche. Requiere el servidor de datos Pro.",
  "Fog and low cloud look aqua; high, cold clouds red; thin high cloud dark.": "La niebla y las nubes bajas se ven aguamarina; las nubes altas y frías, rojas; las nubes altas delgadas, oscuras.",
  "IR Sandwich: the detail of visible with infrared colours on top. Daytime only. Needs the Pro data server.":
    "Sándwich IR: el detalle del visible con los colores del infrarrojo encima. Solo de día. Requiere el servidor de datos Pro.",
  "The texture of storm tops (overshooting tops, waves) together with how cold they are.": "La textura de las cimas de las tormentas (topes sobresalientes, ondas) junto con qué tan frías están.",

  // ─── tools ─────────────────────────────────────────────────────────────────
  "The everyday tool: read values and inspect warnings.": "La herramienta de todos los días: leer valores e inspeccionar avisos.",
  "Move the pointer over any panel (on a phone, tap). The bar at the bottom shows every panel's value at that spot, and a crosshair marks the same spot on the other panels.":
    "Mueve el puntero sobre cualquier panel (en un teléfono, toca). La barra de abajo muestra el valor de cada panel en ese punto, y una cruz marca el mismo punto en los otros paneles.",
  "The bar also shows the range and bearing from the radar, the ground height and the model's temperature, dew point, precipitable water and 0–3 km shear there.":
    "La barra también muestra la distancia y el rumbo desde el radar, la altura del terreno y la temperatura, el punto de rocío, el agua precipitable y la cizalladura de 0–3 km del modelo en ese lugar.",
  "Click a warning's outline to open the warning inspector.": "Haz clic en el contorno de un aviso para abrir el inspector de avisos.",
  "The warning inspector lists the hazard, its source and impact, and the warning's impact-based tags: maximum hail size, maximum wind, the damage threat (considerable, destructive or catastrophic) and whether the tornado is radar-indicated or observed.":
    "El inspector de avisos muestra el peligro, su fuente y su impacto, y las etiquetas de impacto del aviso: tamaño máximo de granizo, viento máximo, la amenaza de daños (considerable, destructiva o catastrófica) y si el tornado es indicado por radar u observado.",
  "A model sounding for any spot: the atmosphere's temperature, moisture and wind from the ground up.":
    "Un sondeo del modelo para cualquier punto: la temperatura, la humedad y el viento de la atmósfera desde el suelo hacia arriba.",
  "Pick Sounding, then click a spot on any panel. Click again anywhere to move it.": "Elige Sondeo y haz clic en un punto de cualquier panel. Vuelve a hacer clic en cualquier lugar para moverlo.",
  "Choose the parcel to lift: surface, mixed layer or most unstable.": "Elige la parcela que se eleva: superficie, capa de mezcla o más inestable.",
  "Skew-T: the red line is temperature, green is dew point and the dashed line is the rising parcel, with its cloud base (LCL) and level of free convection (LFC) marked on the right. The gap between the parcel and the red line is CAPE. Hodograph: the wind at each height, coloured 0–1 km pink, 1–3 km red, 3–6 km green, 6–9 km yellow and 9–12 km cyan. RM and LM are the expected right- and left-moving supercell motions, MW the mean wind and OBS the motion from your storm vector. A long, curved hodograph means strong, turning wind shear, which favours supercells. The numbers under it are explained in the glossary.":
    "Skew-T: la línea roja es la temperatura, la verde el punto de rocío y la discontinua la parcela que asciende, con su base de nube (LCL) y su nivel de convección libre (LFC) marcados a la derecha. El espacio entre la parcela y la línea roja es el CAPE. Hodógrafa: el viento a cada altura, en rosa de 0–1 km, rojo de 1–3 km, verde de 3–6 km, amarillo de 6–9 km y cian de 9–12 km. RM y LM son los movimientos esperados de una supercelda derecha e izquierda, MW el viento medio y OBS el movimiento de tu vector de tormenta. Una hodógrafa larga y curva indica cizalladura fuerte y con giro, que favorece las superceldas. Los números de abajo se explican en el glosario.",
  "It's a model forecast for this hour (Open-Meteo's HRRR/NAM/GFS blend), not a weather balloon.":
    "Es un pronóstico del modelo para esta hora (la combinación HRRR/NAM/GFS de Open-Meteo), no un globo sonda.",
  "A vertical slice of the model atmosphere along a line you draw.": "Un corte vertical de la atmósfera del modelo a lo largo de una línea que trazas.",
  "Pick Cross-section and click the start (A) on any panel.": "Elige Corte vertical y haz clic en el inicio (A) en cualquier panel.",
  "Click the end (A′). Clicking again starts a new line.": "Haz clic en el final (A′). Otro clic empieza una línea nueva.",
  "Colours are θe (equivalent potential temperature): warm colours are warm, moist air; cool colours dry or cold air. The dashed lines are 0 °C (white) and −20 °C (blue); hail grows between them. The ground is shaded at the bottom.":
    "Los colores son θe (temperatura potencial equivalente): los colores cálidos son aire cálido y húmedo; los fríos, aire seco o frío. Las líneas discontinuas son 0 °C (blanca) y −20 °C (azul); entre ellas crece el granizo. El terreno aparece sombreado abajo.",
  "A tongue of high θe below lower values: unstable air ready for storms.": "Una lengua de θe alto debajo de valores más bajos: aire inestable listo para tormentas.",
  "Draw it across a front or dry line to see its slope.": "Trázalo a través de un frente o una línea seca para ver su inclinación.",
  "A storm's motion, from two clicks on its core at two loop times.": "El movimiento de una tormenta, a partir de dos clics en su núcleo en dos momentos del bucle.",
  "Pick Storm vector and click the storm's core on any panel.": "Elige Vector de tormenta y haz clic en el núcleo de la tormenta en cualquier panel.",
  "Step the loop a few frames with ← or →, then click the same core again.": "Avanza el bucle unos cuadros con ← o → y vuelve a hacer clic en el mismo núcleo.",
  "The panel shows the direction it's coming from and its speed, and a ±20° fan shows where it's likely to go.":
    "El panel muestra de dónde viene y su velocidad, y un abanico de ±20° muestra hacia dónde es probable que vaya.",
  "Times of arrival appear for your location, saved places and any TOA points inside the fan.":
    "Aparecen horas de llegada para tu ubicación, tus lugares guardados y los puntos TOA dentro del abanico.",
  "Storms change course: redo the vector every few scans.": "Las tormentas cambian de rumbo: rehaz el vector cada pocos escaneos.",
  "Time of arrival: when the storm reaches places you choose.": "Hora de llegada: cuándo llega la tormenta a los lugares que elijas.",
  "Set a storm vector first.": "Primero define un vector de tormenta.",
  "Pick TOA and click places on any panel (a town, a road, a chase target).": "Elige TOA y haz clic en lugares de cualquier panel (un pueblo, una carretera, un objetivo de caza).",
  "Each gets an arrival time, or says it's off track or already passed.": "Cada uno recibe una hora de llegada, o indica que está fuera de la trayectoria o que ya pasó.",
  "Draw and issue a warning to the StormCentral spotter network. These are unofficial: they go to signed-in spotters, not the public or the NWS. Needs a spotter account.":
    "Dibuja y emite un aviso para la red de observadores de StormCentral. Son extraoficiales: llegan a los observadores con sesión iniciada, no al público ni al NWS. Requiere una cuenta de observador.",
  "Pick the product: tornado, severe thunderstorm, flash flood, snow squall or significant weather advisory.":
    "Elige el producto: tornado, tormenta eléctrica severa, inundación repentina, ráfaga de nieve o advertencia de tiempo significativo.",
  "Click the storm's core, step the loop a few frames and click it again to set its motion (or type the motion).":
    "Haz clic en el núcleo de la tormenta, avanza el bucle unos cuadros y vuelve a hacer clic para fijar su movimiento (o escríbelo).",
  "The polygon is drawn along the storm's track. Drag its corners to adjust it; drag a midpoint to add a corner.":
    "El polígono se dibuja a lo largo de la trayectoria de la tormenta. Arrastra sus esquinas para ajustarlo; arrastra un punto medio para agregar una esquina.",
  "Fill in the duration, hail, wind and damage threat, read the product text, tick the confirmation and issue it.":
    "Completa la duración, el granizo, el viento y la amenaza de daños, lee el texto del producto, marca la confirmación y emítelo.",

  // ─── how-tos ───────────────────────────────────────────────────────────────
  "Check a storm for rotation": "Revisar si una tormenta rota",
  "Use a 2×2 layout with reflectivity, velocity, storm-relative velocity and CC, and zoom to the storm.":
    "Usa una distribución de 2×2 con reflectividad, velocidad, velocidad relativa a la tormenta y CC, y acerca la tormenta.",
  "On reflectivity, look for a hook or an inflow notch on the storm's back side.": "En la reflectividad, busca un gancho o una muesca de entrada en la parte trasera de la tormenta.",
  "On velocity and storm-relative velocity, look there for a couplet: bright green right next to bright red.":
    "En la velocidad y la velocidad relativa a la tormenta, busca ahí un par de velocidades: verde intenso justo al lado de rojo intenso.",
  "Add the strongest inbound and outbound speeds and halve the total: that's the rotational velocity. Around 40 kt or more near the ground is strong.":
    "Suma las velocidades más fuertes de acercamiento y alejamiento y divide el total entre dos: esa es la velocidad de rotación. Unos 40 kt o más cerca del suelo es fuerte.",
  "Step through higher tilts to see how deep the rotation goes.": "Pasa por los ángulos más altos para ver qué tan profunda es la rotación.",
  "Spot a tornado on the ground": "Detectar un tornado en el suelo",
  "Put reflectivity, velocity and CC side by side at the lowest tilt.": "Pon la reflectividad, la velocidad y el CC lado a lado en el ángulo más bajo.",
  "Find a tight couplet on velocity.": "Busca un par de velocidades estrecho en la velocidad.",
  "Check CC right on the couplet: a small spot below about 0.80, with echo still showing on reflectivity, is a tornado debris signature.":
    "Revisa el CC justo sobre el par: una pequeña zona por debajo de unos 0.80, con eco todavía visible en la reflectividad, es una firma de escombros de tornado.",
  "Watch the next scans; a debris signature reaching up several tilts means a strong tornado.":
    "Observa los siguientes escaneos; una firma de escombros que sube varios ángulos indica un tornado fuerte.",
  "If it threatens people, follow the official NWS warnings and call in what you see.": "Si amenaza a personas, sigue los avisos oficiales del NWS y reporta lo que veas.",
  "Look for large hail": "Buscar granizo grande",
  "On reflectivity, find cores of 60 dBZ or more, especially high up on higher tilts.": "En la reflectividad, busca núcleos de 60 dBZ o más, sobre todo en lo alto en ángulos más altos.",
  "Check ZDR (near 0 in the core) and CC (dropping into the 0.80s or low 0.90s).": "Revisa el ZDR (cerca de 0 en el núcleo) y el CC (bajando a 0.80–0.93).",
  "Look for a hail spike behind the core.": "Busca una espiga de granizo detrás del núcleo.",
  "Check MESH or VIL for a quick rise.": "Revisa si el MESH o el VIL suben rápido.",
  "In the sounding, steep 700–500 hPa lapse rates and plenty of CAPE between 0 °C and −20 °C mean big hail is possible.":
    "En el sondeo, gradientes pronunciados de 700–500 hPa y mucho CAPE entre 0 °C y −20 °C indican que es posible granizo grande.",
  "Gauge flash-flood risk": "Evaluar el riesgo de inundaciones repentinas",
  "Look at the mosaic for storms that move over the same place one after another (training).":
    "Mira en el mosaico si hay tormentas que pasan una tras otra por el mismo lugar (tren de tormentas).",
  "Set a storm vector: slow storms drop more rain in one place.": "Define un vector de tormenta: las tormentas lentas dejan más lluvia en un solo lugar.",
  "Check KDP for heavy rain cores.": "Revisa el KDP para encontrar núcleos de lluvia fuerte.",
  "In the sounding, high precipitable water (PWAT) means storms can rain very hard.": "En el sondeo, un agua precipitable (PWAT) alta indica que las tormentas pueden llover muy fuerte.",
  "Find out when a storm reaches you": "Saber cuándo te alcanza una tormenta",
  "Pick Storm vector and click the storm's core.": "Elige Vector de tormenta y haz clic en el núcleo de la tormenta.",
  "Step the loop a few frames and click the same core again.": "Avanza el bucle unos cuadros y vuelve a hacer clic en el mismo núcleo.",
  "Read the arrival times in the panel; add places with TOA.": "Lee las horas de llegada en el panel; agrega lugares con TOA.",
  "Redo the vector every few scans as the storm changes course.": "Rehaz el vector cada pocos escaneos cuando la tormenta cambie de rumbo.",
  "Read the environment before storms form": "Leer el ambiente antes de que se formen tormentas",
  "Click a sounding ahead of where storms are expected.": "Haz clic para un sondeo adelante de donde se esperan tormentas.",
  "Check MLCAPE (fuel), MLCIN (the lid), 0–6 km shear (organisation) and 0–1 km SRH and the LCL (tornado potential).":
    "Revisa el MLCAPE (combustible), el MLCIN (la tapa), la cizalladura de 0–6 km (organización) y el SRH de 0–1 km y el LCL (potencial de tornados).",
  "Look at the hodograph's shape: long and curved favours supercells.": "Mira la forma de la hodógrafa: larga y curva favorece las superceldas.",
  "Draw a cross-section across a front or dry line.": "Traza un corte vertical a través de un frente o una línea seca.",
  "Watch visible satellite for towering cumulus along boundaries.": "Observa el satélite visible en busca de cúmulos en torre a lo largo de los límites.",
  "Issue a spotter-network warning": "Emitir un aviso para la red de observadores",
  "Sign in with your spotter account.": "Inicia sesión con tu cuenta de observador.",
  "Pick WarnGen and choose the product.": "Elige WarnGen y el producto.",
  "Click the storm, step the loop and click it again to set its motion.": "Haz clic en la tormenta, avanza el bucle y vuelve a hacer clic para fijar su movimiento.",
  "Adjust the polygon, fill in the hazards and read the text.": "Ajusta el polígono, completa los peligros y lee el texto.",
  "Tick the confirmation and issue it. You can update or cancel it later from the same panel.": "Marca la confirmación y emítelo. Puedes actualizarlo o cancelarlo después desde el mismo panel.",
  "Replay a past storm": "Volver a ver una tormenta pasada",
  "Press the archive button in the toolbar.": "Presiona el botón de archivo en la barra de herramientas.",
  "Pick a date and time, or one of the famous storms.": "Elige una fecha y hora, o una de las tormentas famosas.",
  "Panels load the radar from then; products with no archive say so.": "Los paneles cargan el radar de ese momento; los productos sin archivo lo indican.",
  "Press Back to live when you're done.": "Presiona Volver al directo cuando termines.",
  "Spread the workspace over several monitors": "Repartir el espacio de trabajo en varios monitores",
  "Press the window button on a panel's header, or on the side panel.": "Presiona el botón de ventana en el encabezado de un panel o en el panel lateral.",
  "It opens in a window of its own; the desktop app puts it on another monitor.": "Se abre en su propia ventana; la app de escritorio la pone en otro monitor.",
  "It stays in step with the workspace: same map, loop and tools.": "Se mantiene sincronizada con el espacio de trabajo: el mismo mapa, bucle y herramientas.",
  "Close the window, or press Bring it back, to return it.": "Cierra la ventana o presiona Traerlo de vuelta para regresarlo.",

  // ─── glossary ──────────────────────────────────────────────────────────────
  "Above ground level / above mean sea level: two ways to give a height.": "Sobre el nivel del suelo / sobre el nivel medio del mar: dos formas de dar una altura.",
  "Bow echo": "Eco en arco",
  "A line of storms bulging forward like a bow. The strongest straight-line winds are at the front of the bulge.":
    "Una línea de tormentas que se abomba hacia adelante como un arco. Los vientos lineales más fuertes están al frente del abombamiento.",
  "Bright band": "Banda brillante",
  "A ring of stronger echo and lower CC around the radar where falling snow melts into rain. It isn't a storm.":
    "Un anillo de eco más fuerte y CC más bajo alrededor del radar, donde la nieve que cae se derrite en lluvia. No es una tormenta.",
  "The expected motion of a right-moving (RM) or left-moving (LM) supercell, worked out from the wind profile.":
    "El movimiento esperado de una supercelda que se desvía a la derecha (RM) o a la izquierda (LM), calculado con el perfil de viento.",
  "Bounded weak echo region: a hole of weak echo under a strong core on higher tilts, made by an updraft too strong for rain to fall through.":
    "Región de eco débil acotada: un hueco de eco débil bajo un núcleo fuerte en ángulos más altos, causado por una corriente ascendente demasiado fuerte para que la lluvia caiga a través de ella.",
  "Convective available potential energy, in J/kg: the fuel for updrafts. Around 1,000–2,500 is moderate, above 2,500 high.":
    "Energía potencial convectiva disponible, en J/kg: el combustible de las corrientes ascendentes. Unos 1,000–2,500 es moderado, más de 2,500 alto.",
  "Convective inhibition, in J/kg: the lid that keeps storms from starting. Near 0 storms form easily; below about −100 J/kg it takes a strong push.":
    "Inhibición convectiva, en J/kg: la tapa que impide que empiecen las tormentas. Cerca de 0 se forman con facilidad; por debajo de unos −100 J/kg hace falta un empuje fuerte.",
  Couplet: "Par de velocidades",
  "Strong inbound (green) right next to strong outbound (red) on velocity: rotation.": "Acercamiento fuerte (verde) justo al lado de alejamiento fuerte (rojo) en la velocidad: rotación.",
  "The angle between the low-level inflow and the low-level wind shear. Close to 90° favours tornadoes.":
    "El ángulo entre el flujo de entrada en niveles bajos y la cizalladura en niveles bajos. Cerca de 90° favorece los tornados.",
  "Decibels of reflectivity: how strongly targets return the radar's signal. Higher is heavier rain or hail.":
    "Decibelios de reflectividad: qué tan fuerte devuelven los blancos la señal del radar. Más alto es lluvia más fuerte o granizo.",
  "Dual-pol": "Polarización dual",
  "Dual polarisation: the radar sends horizontal and vertical pulses, which gives CC, ZDR, KDP and the classification.":
    "Polarización dual: el radar envía pulsos horizontales y verticales, lo que da el CC, el ZDR, el KDP y la clasificación.",
  "Echo tops": "Topes de eco",
  "The highest point where the radar still sees a set amount of echo (18 dBZ): the storm's height.": "El punto más alto donde el radar aún detecta cierta cantidad de eco (18 dBZ): la altura de la tormenta.",
  "Hail growth zone": "Zona de crecimiento de granizo",
  "The layer between 0 °C and −20 °C where hail grows fastest.": "La capa entre 0 °C y −20 °C donde el granizo crece más rápido.",
  Hodograph: "Hodógrafa",
  "A plot of the wind at each height, joined from the ground up. Its length is the wind shear, its curve the turning.":
    "Un gráfico del viento a cada altura, unido desde el suelo hacia arriba. Su largo es la cizalladura, su curva el giro.",
  "Hook echo": "Eco en gancho",
  "A curl of echo on the back side of a supercell, wrapped around its rotation.": "Un rizo de eco en la parte trasera de una supercelda, envuelto alrededor de su rotación.",
  "Impact-based warnings: NWS warnings tagged with the hail size, wind speed and damage threat.": "Avisos basados en impacto: avisos del NWS etiquetados con el tamaño del granizo, la velocidad del viento y la amenaza de daños.",
  "Inflow notch": "Muesca de entrada",
  "A notch in the echo where warm, moist air flows into the updraft.": "Una muesca en el eco por donde el aire cálido y húmedo entra a la corriente ascendente.",
  "Thousands of feet / knots (1 kt ≈ 1.15 mph).": "Miles de pies / nudos (1 kt ≈ 1.15 mph).",
  "Lapse rate": "Gradiente térmico",
  "How fast temperature drops with height. Steep lapse rates (above about 7 °C/km between 700 and 500 hPa) help strong updrafts and hail.":
    "Qué tan rápido baja la temperatura con la altura. Gradientes pronunciados (más de unos 7 °C/km entre 700 y 500 hPa) ayudan a las corrientes ascendentes fuertes y al granizo.",
  "Lifted condensation level: the height of the cloud base. Low bases (below about 1,000 m) favour tornadoes.": "Nivel de condensación por ascenso: la altura de la base de la nube. Bases bajas (menos de unos 1,000 m) favorecen los tornados.",
  "Level of free convection: where a rising parcel starts rising on its own.": "Nivel de convección libre: donde una parcela que asciende empieza a subir por sí sola.",
  "Lifted index: how much warmer a lifted surface parcel is than the air at 500 hPa. Negative is unstable; −6 or lower is very unstable.":
    "Índice de elevación: cuánto más cálida es una parcela de superficie elevada que el aire a 500 hPa. Negativo es inestable; −6 o menos es muy inestable.",
  "The rotating updraft of a supercell, a few kilometres across.": "La corriente ascendente giratoria de una supercelda, de unos pocos kilómetros de ancho.",
  "Multi-Radar Multi-Sensor: NOAA's system that blends every radar into national products.": "Multi-Radar Multi-Sensor: el sistema de NOAA que combina todos los radares en productos nacionales.",
  "Outflow boundary": "Límite de flujo de salida",
  "The edge of rain-cooled air spreading out from storms. New storms often form along it.": "El borde del aire enfriado por la lluvia que se extiende desde las tormentas. A menudo se forman tormentas nuevas a lo largo de él.",
  "Overshooting top": "Tope sobresaliente",
  "A dome of cloud pushed above a storm's anvil by a very strong updraft.": "Un domo de nube empujado por encima del yunque de una tormenta por una corriente ascendente muy fuerte.",
  "Parcel (SB / ML / MU)": "Parcela (SB / ML / MU)",
  "The bit of air the sounding lifts: from the surface (SB), the average of the lowest 100 hPa (ML), or the most unstable one near the ground (MU, for storms above a cool layer).":
    "La porción de aire que eleva el sondeo: desde la superficie (SB), el promedio de los 100 hPa más bajos (ML) o la más inestable cerca del suelo (MU, para tormentas sobre una capa fría).",
  "Particularly dangerous situation: wording the NWS adds to its most serious watches and warnings.": "Situación particularmente peligrosa: la frase que el NWS agrega a sus vigilancias y avisos más graves.",
  "Precipitable water: all the water vapour in the column. High values mean very heavy rain is possible.": "Agua precipitable: todo el vapor de agua de la columna. Valores altos indican que es posible lluvia muy fuerte.",
  "Quasi-linear convective system: a line of storms. Brief tornadoes can form along it, often at kinks in the line.":
    "Sistema convectivo cuasi lineal: una línea de tormentas. Se pueden formar tornados breves a lo largo de ella, a menudo en los quiebres de la línea.",
  "Range folding (RF)": "Plegado de rango (RF)",
  "Where the radar can't tell how far away an echo is, so velocity has no data. Shown in purple.": "Donde el radar no puede saber qué tan lejos está un eco, así que la velocidad no tiene datos. Se muestra en morado.",
  "Rear-flank downdraft: air sinking on the back side of a supercell, wrapping around the tornado area.": "Corriente descendente del flanco trasero: aire que desciende en la parte trasera de una supercelda y envuelve la zona del tornado.",
  "Rotational velocity": "Velocidad de rotación",
  "Half the sum of the strongest inbound and outbound speeds across a couplet: how fast it spins.": "La mitad de la suma de las velocidades más fuertes de acercamiento y alejamiento en un par: qué tan rápido gira.",
  Shear: "Cizalladura",
  "How the wind changes with height. 0–6 km shear of 40 kt or more supports supercells; 0–1 km shear helps tornadoes.":
    "Cómo cambia el viento con la altura. Una cizalladura de 0–6 km de 40 kt o más favorece las superceldas; la de 0–1 km ayuda a los tornados.",
  "The sounding chart: temperature and dew point against height, with lines skewed so the layers are easy to compare.":
    "El diagrama del sondeo: temperatura y punto de rocío según la altura, con líneas inclinadas para comparar las capas con facilidad.",
  "Storm-relative helicity, in m²/s²: how much the low-level wind spins into a moving storm. Above about 100–150 in the lowest 1 km favours tornadoes.":
    "Helicidad relativa a la tormenta, en m²/s²: cuánto giro aporta el viento de niveles bajos a una tormenta en movimiento. Más de unos 100–150 en el primer kilómetro favorece los tornados.",
  Supercell: "Supercelda",
  "A storm with a long-lived rotating updraft. It makes most large hail and strong tornadoes.": "Una tormenta con una corriente ascendente giratoria de larga duración. Produce la mayor parte del granizo grande y de los tornados fuertes.",
  "Tornado debris signature: low CC on a velocity couplet with echo present. Debris in the air from a tornado on the ground.":
    "Firma de escombros de tornado: CC bajo sobre un par de velocidades con eco presente. Escombros en el aire de un tornado en el suelo.",
  "Equivalent potential temperature: a measure of air's heat and moisture together. High θe air is fuel for storms.":
    "Temperatura potencial equivalente: una medida del calor y la humedad del aire juntos. El aire con θe alto es combustible para las tormentas.",
  Tilt: "Ángulo",
  "One of the radar's scan angles. The lowest, 0.5°, is closest to the ground.": "Uno de los ángulos de escaneo del radar. El más bajo, 0.5°, es el más cercano al suelo.",
  "Time of arrival: when a storm on its current track reaches a place.": "Hora de llegada: cuándo una tormenta en su trayectoria actual llega a un lugar.",
  Training: "Tren de tormentas",
  "Storms moving over the same place one after another, which can cause flash floods.": "Tormentas que pasan una tras otra por el mismo lugar, lo que puede causar inundaciones repentinas.",
  "Vertically integrated liquid, in kg/m²: all the water in the column, from reflectivity at every tilt.": "Líquido integrado verticalmente, en kg/m²: toda el agua de la columna, a partir de la reflectividad en cada ángulo.",
  "The NEXRAD radars, each named by a four-letter code like KTLX.": "Los radares NEXRAD, cada uno con un código de cuatro letras como KTLX.",
  "Z (Zulu)": "Z (Zulu)",
  "UTC time, the standard in weather. 00Z is 8 PM Eastern daylight time the day before.": "La hora UTC, el estándar en meteorología. 00Z son las 8 p. m. del día anterior en el horario de verano del Este.",

  // ─── tour ──────────────────────────────────────────────────────────────────
  "Professional mode tour": "Recorrido del modo profesional",
  "A quick walk around the workspace: about two minutes. Use Next and Back, or the arrow keys; Esc ends it any time.":
    "Un paseo rápido por el espacio de trabajo: unos dos minutos. Usa Siguiente y Atrás, o las flechas; Esc lo termina en cualquier momento.",
  Layout: "Distribución",
  "Show 1, 2, 4 or 9 panels. Each panel is a map with its own product; they all pan, zoom and loop together.":
    "Muestra 1, 2, 4 o 9 paneles. Cada panel es un mapa con su propio producto; todos se desplazan, acercan y reproducen juntos.",
  "The radar the single-site panels use. Nearest follows your location; pick one to pin it.": "El radar que usan los paneles de una estación. La más cercana sigue tu ubicación; elige una para fijarla.",
  "What clicking a panel does: read values, a sounding, a cross-section, storm motion and arrival times. Their results show in the side panel.":
    "Lo que hace un clic en un panel: leer valores, un sondeo, un corte vertical, el movimiento de tormentas y las horas de llegada. Sus resultados aparecen en el panel lateral.",
  "Each panel's product: radar at one site, volume scans, national mosaics, other countries' radar and satellite.":
    "El producto de cada panel: radar de una estación, escaneos de volumen, mosaicos nacionales, radar de otros países y satélite.",
  "For radar, which scan angle to show. 0.5° is the lowest; higher tilts look higher into storms.": "Para el radar, qué ángulo de escaneo mostrar. 0.5° es el más bajo; los más altos miran más arriba dentro de las tormentas.",
  "Time basis": "Base de tiempo",
  "TB marks the panel whose scan times the loop steps through. Next to it is this panel's own scan time in UTC.":
    "TB marca el panel por cuyos tiempos de escaneo avanza el bucle. Al lado está el tiempo de escaneo de este panel en UTC.",
  "Panel settings": "Ajustes del panel",
  "Opacity, warnings, storm cells and the cloud-free satellite map, for this panel only.": "Opacidad, avisos, celdas de tormenta y el mapa satelital sin nubes, solo para este panel.",
  "Pop out": "Abrir aparte",
  "Open this panel in a window of its own, for another monitor. It stays in step with the workspace.":
    "Abre este panel en su propia ventana, para otro monitor. Se mantiene sincronizado con el espacio de trabajo.",
  "Colour scale": "Escala de colores",
  "What the colours mean, with the unit in the middle.": "Qué significan los colores, con la unidad en el medio.",
  Loop: "Bucle",
  "Step, play and pause; the clock shows the loop time in UTC and the frame number. Pick how many frames to loop and how fast.":
    "Avanza, reproduce y pausa; el reloj muestra la hora del bucle en UTC y el número de cuadro. Elige cuántos cuadros reproducir y a qué velocidad.",
  "Look back at any date since 1995, or replay a famous storm.": "Mira cualquier fecha desde 1995 o vuelve a ver una tormenta famosa.",
  Readout: "Lectura",
  "Move the pointer over a panel and this bar reads every panel at that spot, with the range from the radar and the model's conditions there.":
    "Mueve el puntero sobre un panel y esta barra lee todos los paneles en ese punto, con la distancia desde el radar y las condiciones del modelo ahí.",
  "Side panel": "Panel lateral",
  "Results of the tool you picked: soundings, cross-sections, storm motion, warnings. Hide it, or open it in its own window.":
    "Los resultados de la herramienta que elegiste: sondeos, cortes verticales, movimiento de tormentas, avisos. Ocúltalo o ábrelo en su propia ventana.",
  "That's the tour": "Eso es todo el recorrido",
  "The guide is here whenever you want it, with what every product and tool shows, step-by-step how-tos and a glossary. If you don't need it, you can hide this button.":
    "La guía está aquí cuando la quieras, con lo que muestra cada producto y herramienta, guías paso a paso y un glosario. Si no la necesitas, puedes ocultar este botón.",
  "Every model's forecast for one spot over the coming days, side by side, or one ensemble's spread as a plume.":
    "El pronóstico de cada modelo para un punto en los próximos días, uno al lado del otro, o la dispersión de un ensamble como una pluma.",
  "Pick Meteogram, then click a spot on any panel. Click again anywhere to move it (Sounding uses the same spot).":
    "Elige Meteograma y haz clic en un punto de cualquier panel. Haz clic de nuevo en otro lugar para moverlo (Sondeo usa el mismo punto).",
  "Choose what to plot: temperature, dew point, total rain and snow, gusts, CAPE or pressure, and how many days to show.":
    "Elige qué graficar: temperatura, punto de rocío, lluvia y nieve totales, ráfagas, CAPE o presión, y cuántos días mostrar.",
  "Models: tap a model's name to show or hide its line. Ensemble: pick an ensemble to see all of its runs.":
    "Modelos: toca el nombre de un modelo para mostrar u ocultar su línea. Ensamble: elige un ensamble para ver todas sus corridas.",
  "Models: one line per model. Where the lines agree the forecast is more certain; where they split, it isn't. AI marks the machine-learning models (ECMWF's AIFS and NOAA's AI GFS). Ensemble: each faint line is one run of the same model started from slightly different conditions, the band holds the middle 80% of runs and the bold line is their average. A narrow plume is a confident forecast; a wide one means anything inside it can happen.":
    "Modelos: una línea por modelo. Donde las líneas coinciden, el pronóstico es más seguro; donde se separan, no lo es. IA marca los modelos de aprendizaje automático (AIFS del ECMWF y el GFS con IA de la NOAA). Ensamble: cada línea tenue es una corrida del mismo modelo iniciada con condiciones ligeramente distintas, la banda contiene el 80 % central de las corridas y la línea gruesa es su promedio. Una pluma estrecha es un pronóstico seguro; una ancha significa que puede pasar cualquier cosa dentro de ella.",
  "Before a severe weather day, compare CAPE and dew points: models that bring the moisture back sooner mean an earlier, bigger threat.":
    "Antes de un día de tiempo severo, compara el CAPE y los puntos de rocío: los modelos que traen la humedad antes indican una amenaza más temprana y mayor.",
  "For rain totals, the top of the plume is a realistic worst case, not the forecast.":
    "En los totales de lluvia, la parte alta de la pluma es el peor caso realista, no el pronóstico.",
  "Short-range models (HRRR, NAM 3 km) only run two or three days ahead.": "Los modelos de corto plazo (HRRR, NAM 3 km) solo pronostican dos o tres días.",
  Ensemble: "Ensamble",
  "The same model run many times from slightly different starting conditions. How far the runs spread shows how certain the forecast is.":
    "El mismo modelo corrido muchas veces con condiciones iniciales ligeramente distintas. Cuánto se separan las corridas muestra qué tan seguro es el pronóstico.",
  Meteogram: "Meteograma",
  "A chart of one place's forecast over time, here for several models or an ensemble at once.":
    "Un gráfico del pronóstico de un lugar a lo largo del tiempo, aquí para varios modelos o un ensamble a la vez.",
  "Colour tables": "Tablas de colores",
  "Radar decoded in the app (Level II and Level III) can be drawn in other colours: open a panel's settings and pick a colour table, or import a GRLevelX palette (.pal). The pick applies to every panel showing that product, and the values you read don't change.":
    "El radar decodificado en la app (Nivel II y Nivel III) puede dibujarse con otros colores: abre los ajustes de un panel y elige una tabla de colores, o importa una paleta de GRLevelX (.pal). La elección se aplica a todos los paneles que muestran ese producto, y los valores que lees no cambian.",
  // TOOL_GUIDE.volume
  "A storm in 3D: every tilt of the radar's newest Level II scan around a spot, at the height the beam really reaches.":
    "Una tormenta en 3D: todas las elevaciones del barrido de Nivel II más reciente del radar alrededor de un punto, a la altura que alcanza de verdad el haz.",
  "Pick 3D volume and click a storm on any panel. Click again to move the view.": "Elige Volumen 3D y haz clic en una tormenta en cualquier panel. Haz clic de nuevo para mover la vista.",
  "Drag to turn it, scroll or pinch to zoom, right-drag or Shift-drag to move it, double-click to start over.":
    "Arrastra para girarla, usa la rueda o pellizca para acercar, arrastra con el botón derecho o con Mayús para moverla y haz doble clic para empezar de nuevo.",
  "Set the lowest reflectivity shown, how far around the spot, and how much taller than life heights are drawn.":
    "Ajusta la reflectividad mínima que se muestra, cuánto alrededor del punto y cuánto se exageran las alturas.",
  "The height scale is above sea level. The blue sheet is the model's freezing level (0 °C) and the violet one −20 °C, where hail grows fastest. The panel lists the highest echo shown and the top of the 50 dBZ core.":
    "La escala de altura es sobre el nivel del mar. La lámina azul es el nivel de congelación del modelo (0 °C) y la violeta, −20 °C, donde el granizo crece más rápido. El panel indica el eco más alto mostrado y la cima del núcleo de 50 dBZ.",
  "A 50 dBZ core reaching well above the −20 °C level: the storm can grow large hail.": "Un núcleo de 50 dBZ que llega bien por encima del nivel de −20 °C: la tormenta puede producir granizo grande.",
  "A tall core leaning over a hole of weak echo near the ground (a bounded weak echo region): a very strong updraft, typical of supercells.":
    "Un núcleo alto inclinado sobre un hueco de eco débil cerca del suelo (una región de eco débil acotada): una corriente ascendente muy fuerte, típica de las supercélulas.",
  "Raise the lowest reflectivity to 45–50 dBZ to see just the core.": "Sube la reflectividad mínima a 45–50 dBZ para ver solo el núcleo.",
};
