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
800×480 RGB panel, ESP32-S3 with octal PSRAM. Uses **LVGL** for the UI — all widgets are declared statically under the `lvgl:` key; sensors update them via `on_value` callbacks using `lvgl.label.update` / `lvgl.arc.update` / `lvgl.widget.show|hide`. Flow arrows (`line:` widgets) are shown/hidden based on power thresholds and their `line_width` is scaled to power magnitude.

- Do not use on_boot to draw a canvas. It does not work.
- For lvgl.label.update use the text, format and args way of updating values. Do calculations like division in args. When possible use this method instead of lambda.

### `geekmagic.yaml`
240×240 SPI panel, ESP8266 (memory-constrained). Uses polling canvas rendering inside a single `lambda:` block that redraws the entire screen every 10 s. No LVGL — everything is drawn with `it.printf()` / `it.strftime()`.

## Home Assistant integration

Both devices connect to HA via the native API (`api:` key). Sensor entity IDs are referenced directly in each YAML. The `home-assistant/template_sensors_crowpanel.yaml` snippet is pasted into HA's `configuration.yaml` (or included via `!include`) — it provides `sensor.zuzenhausen_abfahrten_esphome`, which serialises next train departures as JSON for the ESPHome device to parse inline with C++ lambda.

## Key conventions

- **Fonts**: German glyphs require custom glyph sets. Any new label with German characters (äöüÄÖÜß) must use `montserrat_14_de` or `montserrat_20_de`, not the default `montserrat_*` fonts. Never use the default font. Always use the font which allows German characters.
- **Icons**: Weather and UI icons come from MaterialDesign Icons webfont. Icon codepoints are embedded as UTF-8 escape sequences (e.g. `\xF3\xB0\x96\x99`) or Unicode escapes (`\U000F0599`).
- **Unit scaling**: PV/grid sensors from Fronius/SolarNet are in **watts** (divide by 1000 for kW display). Battery and heat pump sensors are already in kW. Monthly/total energy sensors may be in Wh (divide by 1000) or kWh depending on source.
- **Secrets**: Never commit `secrets.yaml`. The `.gitignore` already excludes it and the `.esphome/` build cache.
