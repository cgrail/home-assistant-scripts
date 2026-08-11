# CLAUDE.md

Personal Home Assistant scripts and ESPHome firmware configurations for smart home energy monitoring displays and sensors.

## Structure

- `esphome-builder/` — ESPHome YAML device configs + build cache (`.esphome/`, gitignored)
- `home-assistant/` — Home Assistant YAML snippets (template sensors, automations)

## ESPHome development commands

Do not run esphome commands. The user does it on it's own.

`secrets.yaml` is gitignored. The file must exist at `esphome-builder/secrets.yaml` with keys: `wifi_ssid`, `wifi_password`, `api_encryption_key`, `ota_password`.

## Devices

### `crowpanel-advance-7-hmi-esp32-s3.yaml`
800×480 RGB panel, ESP32-S3 with octal PSRAM. Split into `packages/` (`header`, `trains`, `history`, `live_panel`, `room_temp`, `overlays`); every package contributes to the same merged `lvgl:` widget tree, so widget ids must be unique across all of them. Uses **LVGL** for the UI — all widgets are declared statically under the `lvgl:` key; sensors update them via `on_value` callbacks using `lvgl.label.update` / `lvgl.arc.update` / `lvgl.widget.show|hide`.

- Do not use on_boot to draw a canvas. It does not work.
- For lvgl.label.update use the text, format and args way of updating values. Do calculations like division in args. When possible use this method instead of lambda.
- `args:` entries are raw C++ expressions, so `args: ['id(pv_kw)']` prints a global. Sanitising NaN once into a global beats an `isnan` guard around every label.

#### Energy flow diagram (`packages/live_panel.yaml`)
Each flow is a dim `line:` wire plus bright three-point `line:` chevrons ("arrows") that one 50 ms `interval:` lambda moves along it with `lv_obj_set_pos()`, fading `line_opa` in at the source and out at the destination. The lambda owns all of it: the sensors only normalise their reading to kW into a global, and visibility, wire width, arrow direction and arrow speed are derived centrally from those — so a flow can never contradict the number printed next to it. Wire endpoints in the YAML and the `PATH[]` table in the lambda have to be kept in sync by hand.

- Flow directions are derived, not read: PV→Haus is `pv − export − battery charge`, not house consumption, otherwise a PV arrow shows at night.
- The arrow chevrons are rotated at runtime from the direction of `PATH[]`, so their `points:` in the YAML are placeholders. Deriving them beats hardcoding: an arrow can then never point the wrong way down a wire.
- Do not animate by masking the wire with background-coloured "dash" segments — it can only step by whole widgets and looks choppy.

Every box in the panel repeats the same three-part rhythm — **icon, big value, caption** — from the `t_icon` / `t_value` / `t_caption` styles, so the eye finds the number in the same place everywhere; only the accent colour (icon, caption, card border) changes per box. Cards themselves are `styles: [card, card_<accent>]`.

- A widget whose state depends on **two** sensors (the battery icon needs charge *and* SOC; both bars need the house total *and* a second reading) has to be driven from a `script:` that every contributing sensor executes, otherwise each sensor half-updates it.
- Icons that can be "off" (PV, Einspeisung, Netzbezug, WP, Buzz) are recoloured to `0x475569` in the same lambda that normalises the reading — the dim icon and the `0.0 kW` next to it then always agree.
- The two `bar:` widgets under the middle column are shares of the house load, and their *track* colour carries the other half of the split: `bar_autark` is green on red (own supply vs grid), `bar_haushalt` is slate on orange (household vs heat pump).

### `geekmagic.yaml`
240×240 SPI panel, ESP8266 (memory-constrained). Uses polling canvas rendering inside a single `lambda:` block that redraws the entire screen every 10 s. No LVGL — everything is drawn with `it.printf()` / `it.strftime()`.

## LVGL gotchas

Verified against LVGL 9.5 / ESPHome 2026.4.5 sources in `.esphome/build/<device>/managed_components/lvgl__lvgl/`.

- **Small `obj:` widgets sprout scrollbars.** The default theme pads every `obj` by ~16 px (`PAD_DEF`). On anything smaller the content area goes negative, `lv_obj_get_scroll_bottom()` returns positive, and LVGL paints its `LV_PART_SCROLLBAR` — two grey rounded bars at 40 % opacity, identical on every widget regardless of its own colour. Put `scrollable: false` and `pad_all: 0` on every small `obj`.
- **Array globals do not compile.** `type: float[7]` with `initial_value: '{}'` binds to `GlobalsComponent(T)`, whose array parameter decays to `float*` → *cannot convert 'float\*' to 'float'*. Keep per-frame animation state in a `static` local inside the lambda instead.
- **Glow** = `shadow_width` + `shadow_color` + `shadow_opa` on an `obj`; `LV_DRAW_SW_COMPLEX` is already enabled. `shadow_*` is the box shadow, `drop_shadow_*` is a different (costlier) feature.
- **`lv_line_set_points()` keeps the pointer, it does not copy.** The array has to outlive the call — a `static` local in the lambda. A line's points are widget-local and must not be negative: the class is `LV_SIZE_CONTENT` and sizes itself to `max(x) × max(y)`, so a moving line is a small local shape plus `lv_obj_set_pos()`. Points in parent coordinates would make the widget span the whole diagram and invalidate that whole rectangle every frame. The stroke may stick out of the box; `ext_draw_size` is `line_width`.
- **Dashed lines only dash horizontally and vertically.** `line_dash_width`/`line_dash_gap` are implemented in the software renderer's H and V fast paths only — diagonal lines silently render solid, so a mixed diagram looks broken.
- **`style_definitions:` + `styles: [a, b]`** removes a lot of repetition across similar widgets, but `width`/`height` must stay on the widget itself: the obj class writes its default size as a *local* style, and local styles always beat added ones. Later entries in `styles:` win, so `[card, card_grid]` is a base plus an override. `text_font:` works in a style — ESPHome ships an `lv_style_set_text_font()` overload taking a `font::Font *`.
- Widgets are drawn in declaration order — anything that must sit on top has to come last in the `widgets:` list.
- **Text stacked inside an `arc:` has to clear the ring, not just the widget.** Usable half-width at a distance `dy` above/below the centre is `sqrt(r_inner² − dy²)`, with `r_inner = width/2 − arc_width`; below the centre the default 135°→45° arc leaves a wedge open where `|dx| < |dy|`. An 80 px arc at `arc_width: 12` only fits ~48 px of text on its centre line — dropping to `arc_width: 8` is what makes a three-line icon/value/caption stack fit.
- **`bg_grad_color` + `bg_grad_dir: VER`** gives cards depth for free, but keep the panel background that the animated arrows travel over flat: that area is re-invalidated 20×/s.

## Checking fonts without compiling

The cached fonts under `esphome-builder/.esphome/font/` can be read with the `freetype` module in ESPHome's own venv (`$(brew --prefix)/Cellar/esphome/<version>/libexec/bin/python`; the system python has neither `freetype` nor `yaml`):

- **Resolve MDI codepoints by glyph name** from the cached webfont instead of guessing them — iterate the charmap and `face.get_glyph_name()`.
- **Measure text width** at a given px size to check a label fits its box before flashing (`Wärmepumpe` is 103 px at 14 px, so it needs a ≥ 110 px wide label). Mirror ESPHome: `face.set_pixel_sizes(size, 0)` and sum `(glyph.metrics.horiAdvance + 63) // 64` per character.
- **Measure line height the same way** to stack rows without overlap — `(face.size.height + 63) // 64`. For the fonts in use: `montserrat_14_de` 17 px (ascender 14), `montserrat_20_de` 24 px (ascender 20), MDI *n* px at size *n*. A card 80 px tall therefore holds icon + value + caption with ~6 px of margin, and needs 84 px for a fourth row.

## Home Assistant integration

Both devices connect to HA via the native API (`api:` key). Sensor entity IDs are referenced directly in each YAML. The `home-assistant/template_sensors_crowpanel.yaml` snippet is pasted into HA's `configuration.yaml` (or included via `!include`) — it provides `sensor.zuzenhausen_abfahrten_esphome`, which serialises next train departures as JSON for the ESPHome device to parse inline with C++ lambda.

## Key conventions

- **Fonts**: German glyphs require custom glyph sets. Any new label with German characters (äöüÄÖÜß) must use `montserrat_14_de` or `montserrat_20_de`, not the default `montserrat_*` fonts. Never use the default font. Always use the font which allows German characters.
- **Icons**: Weather and UI icons come from MaterialDesign Icons webfont. Icon codepoints are embedded as UTF-8 escape sequences (e.g. `\xF3\xB0\x96\x99`) or Unicode escapes (`\U000F0599`). Never guess a codepoint — look it up in the cached font (see above).
- **Unit scaling**: PV/grid sensors from Fronius/SolarNet are in **watts** (divide by 1000 for kW display). Battery and heat pump sensors are already in kW. Monthly/total energy sensors may be in Wh (divide by 1000) or kWh depending on source.
- **Secrets**: Never commit `secrets.yaml`. The `.gitignore` already excludes it and the `.esphome/` build cache.
