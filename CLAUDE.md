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

Every box in the panel repeats the same three-part rhythm — **icon, big value, caption** — from the `t_icon` / `t_value` / `t_caption` styles, so the eye finds the number in the same place everywhere; only the accent colour (icon, caption, card border) changes per box. Cards themselves are `styles: [card, card_<accent>]`. The Haus node is the deliberate exception: it spans the whole middle row and runs that rhythm *horizontally* (icon + value sharing a baseline at the left, caption right-aligned), which frees the height for the two share rows below it.

- A widget whose state depends on **two** sensors (the battery icon needs charge *and* SOC; both bars need the house total *and* a second reading) has to be driven from a `script:` that every contributing sensor executes, otherwise each sensor half-updates it.
- Icons that can be "off" (PV, Einspeisung, Netzbezug, WP, Buzz) are recoloured to `0x475569` in the same lambda that normalises the reading — the dim icon and the `0.0 kW` next to it then always agree.
- The two `bar:` widgets inside the Haus node are shares of the same house load, and their *track* colour carries the other half of the split: `bar_autark` is green on red (own supply vs grid), `bar_haushalt` is slate on orange (household vs heat pump). Each sits in a `label label bar` row — *what it is, how much, how much of the total* — so no bar has to be decoded from its colour alone, and the household reading is stated as a share of the house instead of as a card of its own labelled by what it excludes.

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
- **That open wedge is not empty: `arc_rounded: true` parks a half-disc in it at each end.** The cap is centred on the arc's centreline (`r = width/2 − arc_width/2`) at the start/end angle with radius `arc_width/2`, so it reaches *past* the wedge boundary. For a bottom caption that cap, not the ring, is what the text runs into — check the distance from the text's bottom **corner** to the cap centre, not the half-width on its centre line. On the 80 px arcs here a 14 px `1.7 kW` overlaps it by 0.5 px (bitten-off looking), 12 px clears by ~4 px; that is what `t_caption_sm` exists for.
- **`bg_grad_color` + `bg_grad_dir: VER`** gives cards depth for free, but keep the panel background that the animated arrows travel over flat: that area is re-invalidated 20×/s.

## Checking fonts without compiling

The cached fonts under `esphome-builder/.esphome/font/` can be read with the `freetype` module in ESPHome's own venv (`$(brew --prefix)/Cellar/esphome/<version>/libexec/bin/python`; the system python has neither `freetype` nor `yaml`):

- **Resolve MDI codepoints by glyph name** from the cached webfont instead of guessing them — iterate the charmap and `face.get_glyph_name()`.
- **Measure text width** at a given px size to check a label fits its box before flashing (`Wärmepumpe` is 103 px at 14 px, so it needs a ≥ 110 px wide label). Mirror ESPHome: `face.set_pixel_sizes(size, 0)` and sum `(glyph.metrics.horiAdvance + 63) // 64` per character.
- **Measure line height the same way** to stack rows without overlap — `(face.size.height + 63) // 64`. For the fonts in use: `montserrat_12_de` 15 px (ascender 12), `montserrat_14_de` 17 px (ascender 14), `montserrat_20_de` 24 px (ascender 20), MDI *n* px at size *n*. A card 80 px tall therefore holds icon + value + caption with ~6 px of margin, and needs 84 px for a fourth row.

## Home Assistant integration

Both devices connect to HA via the native API (`api:` key). Sensor entity IDs are referenced directly in each YAML. The files under `home-assistant/` are included from HA's `configuration.yaml`; each one's header says how, and they are not all included the same way:

- `template_sensors_crowpanel.yaml` — a **package**, so it carries its own `template:` key. Provides `sensor.taglicher_hausverbrauch`. A package entry must be a mapping of top-level keys: included as the bare list it used to be, HA says *"expected a dictionary. Package will not be initialized"* and the sensor is simply missing.
- `sql_sensors_crowpanel.yaml` — value of `sql:`. Twelve months of energy history as one CSV state string.
- `battery_energy_crowpanel.yaml` — a **package** (`homeassistant: packages:`), because it needs two top-level keys: `sensor:` for two Riemann-sum integrations of the SolarNet battery power sensors, and `utility_meter:` for the daily cycle on each.

**Daily house consumption is an identity, and the battery is half of it.** `sensor.taglicher_hausverbrauch` = PV − Einspeisung − Batterie geladen + Batterie entladen + Netzbezug. Leaving the battery terms out — as it did until Aug 2026 — reads high on a sunny morning and low across a day the battery net-drained, and nothing about the number gives that away. SolarNet publishes the battery as **power only**, so the two daily kWh meters have to be built (`battery_energy_crowpanel.yaml`); a `utility_meter` over an integration sensor needs `periodically_resetting: false`, or one HA restart adds the lifetime total to today.

## Key conventions

- **Fonts**: German glyphs require custom glyph sets. Any new label with German characters (äöüÄÖÜß) must use `montserrat_14_de` or `montserrat_20_de`, not the default `montserrat_*` fonts. Never use the default font. Always use the font which allows German characters.
- **Icons**: Weather and UI icons come from MaterialDesign Icons webfont. Icon codepoints are embedded as UTF-8 escape sequences (e.g. `\xF3\xB0\x96\x99`) or Unicode escapes (`\U000F0599`). Never guess a codepoint — look it up in the cached font (see above). Then **add it to that font's `glyphs:` list**: ESPHome embeds only the listed glyphs, so a correct codepoint that is not listed renders as an empty box with no build error — `\U000F1A43` (heat-pump) did exactly that on the Wärme tile. The fonts are declared per size (`mdi_20`, `mdi_14`, `mdi_weather_36`), so a glyph one font already carries is *not* available to a label using another. Icons set at runtime from a lambda need the same entry and are the easy ones to miss, being invisible to a grep for `\U000F`.
- **Unit scaling**: PV/grid sensors from Fronius/SolarNet are in **watts** (divide by 1000 for kW display). Battery and heat pump sensors are already in kW. Monthly/total energy sensors may be in Wh (divide by 1000) or kWh depending on source.
- **Secrets**: Never commit `secrets.yaml`. The `.gitignore` already excludes it and the `.esphome/` build cache.
