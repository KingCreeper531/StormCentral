package io.github.kingcreeper531.stormcentral.glyph;

/**
 * What the Storm Central Glyph Toy draws on the Glyph Matrix (Nothing Phone (3),
 * 25 x 25 LEDs): pure Java with no Android or SDK classes, so it can be checked
 * on its own. A frame is 625 brightness values (0 to 255), row by row.
 *
 * <p>View 0: the weather icon (a warning triangle while a warning is in effect)
 * over the temperature. View 1 (a long press on the Glyph Button): today's high
 * and low. The icons are the app's dot-grid icons (src/lib/weather/dot-icons.ts,
 * kept in step by a test), 15 x 11, so they sit inside the round display.
 */
public final class GlyphArt {

    public static final int SIZE = 25;
    private static final int ON = 255;
    private static final int DIM = 110;

    private GlyphArt() {}

    /** What to draw. Temperatures are whole degrees in the user's unit; null when unknown. */
    public static final class Info {
        public String icon = "cloudy";
        public Integer temp;
        public Integer high;
        public Integer low;
        public boolean warning;
    }

    public static int[] render(Info info, int view) {
        int[] f = new int[SIZE * SIZE];
        if (view == 1) {
            arrow(f, 4, 6, true);
            text(f, number(info.high), 8, 6, ON);
            arrow(f, 4, 14, false);
            text(f, number(info.low), 8, 14, DIM);
            return f;
        }
        String[] icon = info.warning ? WARNING : iconFor(info.icon);
        for (int y = 0; y < icon.length; y++) {
            for (int x = 0; x < icon[y].length(); x++) {
                char c = icon[y].charAt(x);
                if (c != '.') set(f, 5 + x, 3 + y, ON);
            }
        }
        String t = number(info.temp);
        text(f, t, (SIZE - width(t)) / 2, 16, ON);
        return f;
    }

    /**
     * WMO weather code to the app's icon name, "~" standing for day or night:
     * the table in src/lib/weather/wmo.ts (kept in step by a test).
     */
    static final String ICON_NAMES = "0:clear-~,1:cloudy-1-~,2:cloudy-2-~,3:cloudy,45:fog-~,48:frost-~,51:rainy-1-~,53:rainy-1,55:rainy-2,56:rain-and-sleet-mix,57:rain-and-sleet-mix,61:rainy-2-~,63:rainy-2,65:rainy-3,66:rain-and-sleet-mix,67:rain-and-sleet-mix,71:snowy-1-~,73:snowy-2,75:snowy-3,77:snow-and-sleet-mix,80:rainy-1-~,81:rainy-2-~,82:rainy-3,85:snowy-1-~,86:snowy-3,95:scattered-thunderstorms-~,96:severe-thunderstorm,99:hail";

    /** The icon name for a WMO weather code ("cloudy-2-day"), as iconName in wmo.ts; "cloudy" when unknown. */
    public static String iconName(int code, boolean day) {
        for (String pair : ICON_NAMES.split(",")) {
            int colon = pair.indexOf(':');
            if (Integer.parseInt(pair.substring(0, colon)) == code) return pair.substring(colon + 1).replace("~", day ? "day" : "night");
        }
        return "cloudy";
    }

    /** The dot icon for a weather icon name ("clear-day", "rainy-2-night"...), as dotIconFor in dot-icons.ts. */
    static String[] iconFor(String name) {
        if (name == null) return CLOUD;
        boolean night = name.endsWith("-night");
        if (name.startsWith("clear")) return night ? MOON : SUN;
        if (name.startsWith("cloudy-")) return night ? MOON_CLOUD : SUN_CLOUD;
        if (name.equals("cloudy")) return CLOUD;
        if (name.startsWith("fog") || name.startsWith("frost")) return FOG;
        if (name.startsWith("rainy-1")) return DRIZZLE;
        if (name.startsWith("rainy-3")) return HEAVY_RAIN;
        if (name.startsWith("rainy")) return RAIN;
        if (name.startsWith("snowy")) return SNOW;
        if (name.contains("sleet")) return SLEET;
        if (name.equals("hail")) return HAIL;
        if (name.contains("thunder")) return THUNDER;
        if (name.equals("wind")) return WIND;
        return CLOUD;
    }

    private static String number(Integer v) {
        return v == null ? "--°" : v + "°";
    }

    // ---- A 3 x 5 dot font: digits, minus, degree --------------------------

    private static final String[] DIGITS = {
        "####.##.##.####", "..#..#..#..#..#", "###..#####..###", "###..####..####", "#.##.####..#..#",
        "####..###..####", "####..####.####", "###..#..#..#..#", "####.#####.####", "####.####..####",
    };

    private static int glyphWidth(char c) {
        return c == '°' ? 2 : 3;
    }

    static int width(String s) {
        int w = 0;
        for (int i = 0; i < s.length(); i++) w += glyphWidth(s.charAt(i)) + (i > 0 ? 1 : 0);
        return w;
    }

    private static void text(int[] f, String s, int x, int y, int level) {
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c >= '0' && c <= '9') {
                String g = DIGITS[c - '0'];
                for (int k = 0; k < 15; k++) if (g.charAt(k) == '#') set(f, x + k % 3, y + k / 3, level);
            } else if (c == '-') {
                for (int k = 0; k < 3; k++) set(f, x + k, y + 2, level);
            } else if (c == '°') {
                set(f, x, y, level);
                set(f, x + 1, y, level);
                set(f, x, y + 1, level);
                set(f, x + 1, y + 1, level);
            }
            x += glyphWidth(c) + 1;
        }
    }

    private static void arrow(int[] f, int x, int y, boolean up) {
        String[] a = up ? new String[] {".#.", "###", ".#.", ".#.", ".#."} : new String[] {".#.", ".#.", ".#.", "###", ".#."};
        for (int r = 0; r < 5; r++) for (int c = 0; c < 3; c++) if (a[r].charAt(c) == '#') set(f, x + c, y + r, DIM);
    }

    private static void set(int[] f, int x, int y, int level) {
        if (x >= 0 && x < SIZE && y >= 0 && y < SIZE) f[y * SIZE + x] = level;
    }

    // ---- Icons, 15 x 11 (copied from src/lib/weather/dot-icons.ts) ----------

    static final String[] WARNING = {
        ".......#.......",
        "......#.#......",
        "......#.#......",
        ".....#.#.#.....",
        ".....#.#.#.....",
        "....#..#..#....",
        "....#.....#....",
        "...#...#...#...",
        "...#.......#...",
        "..#.........#..",
        "..###########..",
    };

    static final String[] SUN = {
        ".......#.......",
        "..#....#....#..",
        "...#.......#...",
        "......###......",
        ".....#####.....",
        "##...#####...##",
        ".....#####.....",
        "......###......",
        "...#.......#...",
        "..#....#....#..",
        ".......#.......",
    };

    static final String[] MOON = {
        "...............",
        "......####.....",
        "....##.........",
        "...##......#...",
        "...#...........",
        "...#...........",
        "...#.......#...",
        "...##..........",
        "....##.........",
        "......####.....",
        "...............",
    };

    static final String[] CLOUD = {
        "...............",
        "...............",
        "......####.....",
        ".....#....#....",
        "..###......#...",
        ".#..........#..",
        ".#...........#.",
        "..###########..",
        "...............",
        "...............",
        "...............",
    };

    static final String[] SUN_CLOUD = {
        "...#...........",
        ".#...#.........",
        "..###..........",
        "#.###.#........",
        "..###..........",
        ".#.....####....",
        "......#....#...",
        "...###......#..",
        "..#..........#.",
        "..#...........#",
        "...###########.",
    };

    static final String[] MOON_CLOUD = {
        "...###.........",
        "..##...........",
        ".##............",
        ".##............",
        "..##...........",
        "...##..####....",
        "......#....#...",
        "...###......#..",
        "..#..........#.",
        "..#...........#",
        "...###########.",
    };

    static final String[] DRIZZLE = {
        "......####.....",
        ".....#....#....",
        "..###......#...",
        ".#..........#..",
        ".#...........#.",
        "..###########..",
        "...............",
        "...#.....#.....",
        "...............",
        "......#.....#..",
        "...............",
    };

    static final String[] RAIN = {
        "......####.....",
        ".....#....#....",
        "..###......#...",
        ".#..........#..",
        ".#...........#.",
        "..###########..",
        "...............",
        "...#...#...#...",
        "..#...#...#....",
        "...............",
        "...............",
    };

    static final String[] HEAVY_RAIN = {
        "......####.....",
        ".....#....#....",
        "..###......#...",
        ".#..........#..",
        ".#...........#.",
        "..###########..",
        "...............",
        "..#..#..#..#...",
        ".#..#..#..#....",
        "...#..#..#..#..",
        "..#..#..#..#...",
    };

    static final String[] SNOW = {
        "......####.....",
        ".....#....#....",
        "..###......#...",
        ".#..........#..",
        ".#...........#.",
        "..###########..",
        "...............",
        "..#...#...#....",
        "...............",
        "....#...#...#..",
        "...............",
    };

    static final String[] SLEET = {
        "......####.....",
        ".....#....#....",
        "..###......#...",
        ".#..........#..",
        ".#...........#.",
        "..###########..",
        "...............",
        "...#...#...#...",
        "..#.......#....",
        ".......#.......",
        "...............",
    };

    static final String[] THUNDER = {
        "......####.....",
        ".....#....#....",
        "..###......#...",
        ".#..........#..",
        ".#...........#.",
        "..###########..",
        ".......rr......",
        "......rr.......",
        ".....rrrr......",
        ".......rr......",
        "......rr.......",
    };

    static final String[] HAIL = {
        "......####.....",
        ".....#....#....",
        "..###......#...",
        ".#..........#..",
        ".#...........#.",
        "..###########..",
        "...............",
        "..##....##.....",
        "..##....##.....",
        ".....##....##..",
        ".....##....##..",
    };

    static final String[] FOG = {
        "...............",
        "..###########..",
        "...............",
        ".###########...",
        "...............",
        "...###########.",
        "...............",
        "..##########...",
        "...............",
        ".....#######...",
        "...............",
    };

    static final String[] WIND = {
        "...............",
        "..........###..",
        ".............#.",
        "............#..",
        "############...",
        "...............",
        "########.......",
        "........#......",
        ".........#.....",
        ".......##......",
        "...............",
    };
}
