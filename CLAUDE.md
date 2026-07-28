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
Each flow is a dim `line:` wire plus glowing `obj:` dots that one 50 ms `interval:` lambda moves along it with `lv_obj_set_pos()`, fading `bg_opa`/`shadow_opa` in at the source and out at the destination. The lambda owns all of it: the sensors only normalise their reading to kW into a global, and visibility, wire width and dot speed are derived centrally from those — so a flow can never contradict the number printed next to it. Wire endpoints in the YAML and the `PATH[]` table in the lambda have to be kept in sync by hand.

- Flow directions are derived, not read: PV→Haus is `pv − export − battery charge`, not house consumption, otherwise a PV arrow shows at night.
- Do not animate by masking the wire with background-coloured "dash" segments — it can only step by whole widgets and looks choppy.

### `geekmagic.yaml`
240×240 SPI panel, ESP8266 (memory-constrained). Uses polling canvas rendering inside a single `lambda:` block that redraws the entire screen every 10 s. No LVGL — everything is drawn with `it.printf()` / `it.strftime()`.

## LVGL gotchas

Verified against LVGL 9.5 / ESPHome 2026.4.5 sources in `.esphome/build/<device>/managed_components/lvgl__lvgl/`.

- **Small `obj:` widgets sprout scrollbars.** The default theme pads every `obj` by ~16 px (`PAD_DEF`). On anything smaller the content area goes negative, `lv_obj_get_scroll_bottom()` returns positive, and LVGL paints its `LV_PART_SCROLLBAR` — two grey rounded bars at 40 % opacity, identical on every widget regardless of its own colour. Put `scrollable: false` and `pad_all: 0` on every small `obj`.
- **Array globals do not compile.** `type: float[7]` with `initial_value: '{}'` binds to `GlobalsComponent(T)`, whose array parameter decays to `float*` → *cannot convert 'float\*' to 'float'*. Keep per-frame animation state in a `static` local inside the lambda instead.
- **Glow** = `shadow_width` + `shadow_color` + `shadow_opa` on an `obj`; `LV_DRAW_SW_COMPLEX` is already enabled. `shadow_*` is the box shadow, `drop_shadow_*` is a different (costlier) feature.
- **Dashed lines only dash horizontally and vertically.** `line_dash_width`/`line_dash_gap` are implemented in the software renderer's H and V fast paths only — diagonal lines silently render solid, so a mixed diagram looks broken.
- **`style_definitions:` + `styles: [a, b]`** removes a lot of repetition across similar widgets, but `width`/`height` must stay on the widget itself: the obj class writes its default size as a *local* style, and local styles always beat added ones.
- Widgets are drawn in declaration order — anything that must sit on top has to come last in the `widgets:` list.

## Checking fonts without compiling

The cached fonts under `esphome-builder/.esphome/font/` can be read with the `freetype` module in ESPHome's own venv (`$(brew --prefix)/Cellar/esphome/<version>/libexec/bin/python`; the system python has neither `freetype` nor `yaml`):

- **Resolve MDI codepoints by glyph name** from the cached webfont instead of guessing them — iterate the charmap and `face.get_glyph_name()`.
- **Measure text width** at a given px size to check a label fits its box before flashing (`Wärmepumpe` is 103 px at 14 px, so it needs a ≥ 110 px wide label).

## Home Assistant integration

Both devices connect to HA via the native API (`api:` key). Sensor entity IDs are referenced directly in each YAML. The `home-assistant/template_sensors_crowpanel.yaml` snippet is pasted into HA's `configuration.yaml` (or included via `!include`) — it provides `sensor.zuzenhausen_abfahrten_esphome`, which serialises next train departures as JSON for the ESPHome device to parse inline with C++ lambda.

## Key conventions

- **Fonts**: German glyphs require custom glyph sets. Any new label with German characters (äöüÄÖÜß) must use `montserrat_14_de` or `montserrat_20_de`, not the default `montserrat_*` fonts. Never use the default font. Always use the font which allows German characters.
- **Icons**: Weather and UI icons come from MaterialDesign Icons webfont. Icon codepoints are embedded as UTF-8 escape sequences (e.g. `\xF3\xB0\x96\x99`) or Unicode escapes (`\U000F0599`). Never guess a codepoint — look it up in the cached font (see above).
- **Unit scaling**: PV/grid sensors from Fronius/SolarNet are in **watts** (divide by 1000 for kW display). Battery and heat pump sensors are already in kW. Monthly/total energy sensors may be in Wh (divide by 1000) or kWh depending on source.
- **Secrets**: Never commit `secrets.yaml`. The `.gitignore` already excludes it and the `.esphome/` build cache.
