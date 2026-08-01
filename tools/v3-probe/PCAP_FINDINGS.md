# DWARF mini PCAP Findings

## Purpose

This document captures protocol findings from recent DWARF mini captures and translates them into practical driver implications.

Analyzed captures:

- Capture 1: `c:\Users\Aco\Downloads\PCAPdroid_17_Marz_19_07_09.pcap`
- Capture 2: `c:\Users\Aco\Downloads\pcap2.pcap`

Decoder used:

- `tools/v3-probe/pcap-decode.js`

---

## Executive Summary

### APK 3.4.1 and live-device correction

Static analysis of DWARFLAB 3.4.1 and safe probes against a DWARF MINI
(firmware 1.1.3 build 2) supersede two earlier PCAP-only interpretations:

- `11005` field 1 is `ir_index`, not frame count. The app sends Astro=`1` or
  Duo-Band=`2` in the start-stacking request. A captured signed `-1` is therefore
  an unset/default sentinel from that flow, not an infinite frame count.
- `16703 value=2` merely correlated with a capture where Duo-Band was selected;
  it was not proof of a filter command. Direct Mini writes through `16700` and
  `16703` failed. Filter choice is carried authoritatively by `11005.ir_index`.
- `15264` is a general camera-parameter notification, not filter readback.
- Dark=`3` is not selectable as a normal Deep Sky filter. The APK uses the
  calibration-frame workflow: `11045` start and `11046` stop.

The APK-confirmed `11045` request fields are:

1. `exp_index`
2. `gain`
3. `resolution` (`0`=4K, `1`=1080P, `2`=720P)
4. `cap_size`
5. `camera_type` (`0`=tele)
6. `cali_frame_type` (`0`=dark)
7. optional `filter_type` (`3`=Dark)
8. `scene_type` (`0`=setting, `1`=shooting)

The request schema is confirmed; result delivery and completion notifications
remain hardware-unverified.

### Confirmed protocol behavior

1. LED and ring-light flow is clean and classified.
2. Focus stepping and focus notifications are consistent.
3. Infinity/autofocus actions produce a repeatable state transition notify sequence.
4. Astro session flow without target is stable and traceable in command groups.
5. `15288` is strongly linked to exposure duration telemetry:
   - `60.0` during 60s sessions (capture 1)
   - `30.0` during 30s sessions (capture 2)

### Remaining open items

- `15256`: resolved by the APK 3.4.1 descriptor as `CalibrationResult` (`azi`, `alt`).
- `15262`: varint flag (`1` observed), likely state latch.
- `15280`: autofocus-state style notify (`1 -> 3`), observed in capture 2 and currently treated as alternate autofocus-state signal.

---

## Capture 2 Detailed Findings

Source:

- `c:\Users\Aco\Downloads\pcap2.pcap`

Scenario:

- connected
- disabled ring light and power indicator, enabled, disabled again
- focus three times, infinity-focus, focus three times, infinity-focus
- astro session (2 images, no target, 30s, gain 60, Astro filter)
- astro session (2 images, no target, Duo-Band filter)

### LED and ring-light flow (classified)

Ring light:

- `13500` open
- `13501` close
- notify `15221` confirms RGB state

Power indicator:

- `13503` on
- `13504` off
- notify `15222` confirms indicator state

Interpretation:

- This path is clean and deterministic.
- `13503` and `13504` are known enum commands (not true unknowns).

### Focus behavior

Manual stepping is consistent:

- `15001` requests
- `15257` focus position notifies

Infinity-focus/autofocus behavior:

- `15004` autofocus start
- paired notify sequence on `15280` with values `1` then `3`

Interpretation:

- `15280` behaves like autofocus lifecycle state for this firmware path.
- The `1 -> 3` pattern is repeatable around each infinity-focus action.

### Astro session behavior (no target, 2 images)

Status polling and setup:

- `11039`, `11041`, `15264`

Start stacking:

- `11005`

Progress:

- `15255` and `15209`

Key confirmation:

- `15288` payload decodes to `30.0` in this capture (6 samples), matching the 30s exposure flow.

---

## Mount Control Capture (manual joystick)

Source:

- `c:\Users\Aco\Downloads\mount.pcap`

Main result:

- Manual mount control is dominated by step-motor joystick streaming commands in module 6.

### Primary commands observed

- `14006` `CMD_STEP_MOTOR_SERVICE_JOYSTICK`
   - count: very high (hundreds of repeated requests while dragging joystick)
   - paired with normal `NRESP` acknowledgements.
- `14008` `CMD_STEP_MOTOR_SERVICE_JOYSTICK_STOP`
   - count: 6 in this capture
   - emitted when joystick interaction stops/releases.

### Argument structure for `14006`

Observed raw layout is stable:

- `09 <8 bytes> 11 <8 bytes>`

Interpretation:

- protobuf field 1 = fixed64/double
- protobuf field 2 = fixed64/double

Decoded sample pairs:

- `A=43.376511, B=0.010059`
- `A=58.315948, B=0.010404`
- `A=71.180380, B=0.019846`
- `A=76.993163, B=0.102873`
- `A=79.750064, B=0.257493`

Observed ranges in this capture:

- `A_range = 0.482469 .. 359.775517`
- `B_range = 0.010000 .. 1.000000`

Working interpretation:

- `A` behaves like an angle/heading in degrees (near 0..360 wrap).
- `B` behaves like normalized joystick magnitude/speed (0..1).

### Mount-related undocumented status

- No new true undocumented mount command IDs surfaced.
- `14006` and `14008` are known enum commands and currently appear in summary only because decoder inner-type mapping is still missing.

### Driver implications (manual mount)

1. For real hardware mode, joystick-like manual axis control should map to a continuous stream model, not single-shot axis jumps.
2. `14008` should be treated as authoritative stop signal for manual slew termination.
3. If implementing direct joystick bridge, use:
    - angle input domain: approximately `0..360`
    - magnitude domain: `0..1`
4. Keep ACK-tolerant behavior; responses are frequent but not one-to-one deterministic at UI cadence.

---

## Media Gallery Capture

Source:

- `c:\Users\Aco\Downloads\media.pcap`

Capture intent:

- media/gallery actions (save stacked result, browse/list saved items)

### Media/gallery command flow observed

1. Stack progress context present before gallery action:

- `15209` `N:RawLiveStackProg`
   - sample notify payload includes:
      - `totalCount`: `280`
      - `currentCount`: `70`
      - `stackedCount`: `67`
      - `expIndex`: `162`
      - `gainIndex`: `18`
      - `targetName`: `SH 2-274`

2. Save stacked image action:

- Request: `11033` `V3:SaveStacked` (`V3ReqSaveStackedImage`)
   - `path`: `/DWARF_mini/Astronomy/DWARF_RAW_TELE_SH 2-274_EXP_120_GAIN_60_2026-03-17-20-19-01-615/`
- Response: `11033` `V3ResSaveStackedImage`
   - `code`: `-16600`

Interpretation:

- Save request is issued with a full capture-directory path.
- In this sample the device returns failure code `-16600` (error meaning still to be mapped in decoder docs).

3. Gallery listing action:

- Request: `11034` `V3:ListSaved`
- No decoded inner response payload observed in this short capture window.

### Additional telemetry in this media capture

- `15288` appears once with raw `09 00 00 00 00 00 00 4e 40`.
   - decoded double value: `60.0`
   - consistent with previously observed exposure-duration telemetry behavior.

### Argument-level notes

- `11033` argument is explicit and high-value for driver integration:
   - gallery save is path-driven (not just ID-driven) on this protocol path.
- `15209` arguments provide enough context to label gallery entries with stack metadata:
   - target name, exposure index, gain index, stacked progress.

### Driver implications (media)

1. Handle `11033` save failures explicitly and surface returned numeric code to clients/logs.
2. Preserve/save path argument in logs for troubleshooting and retry logic.
3. Keep `15209` fields available in runtime diagnostics for linking gallery actions to capture context.
4. Treat `15288` as auxiliary exposure-duration telemetry (here: `60.0`).

### Error codes seen in captures

`11033` SaveStacked:

- `code = -16600`
- observed during media gallery save with explicit astronomy path.
- confidence: medium (not present in current published error enum).
- likely class: V3 save/export failure in media pipeline (path/state/timing related).

Operational recommendation:

- always log and surface both values together:
   - save `path` argument
   - returned numeric `code`


### Observed request arguments (from decode)

The decoder output includes parsed request payload fields for many calls. Below are the key argument-level observations from this capture.

System and location:

- `13010` V3:SetGPS (`V3ReqSetGPSLocation`)
   - `lat`: `11.4572236`
   - `lon`: `44.9981768`
   - `alt`: `349.4000244140625`
   - `locationName`: `Country`

Mode and camera setup:

- `16404` V3:ModeSwitch (`V3ReqModeSwitch`)
   - `inner.value`: `1`
- `16403` V3:ShootModeSwitch (`V3ReqShootingModeSwitch`)
   - `modeId`: `2`
- `10050` V3:OpenTele (`V3ReqOpenTeleCamera`)
   - `action`: `1`
- `12036` V3:OpenWide
   - request seen both with and without explicit `action` field in different captures/steps.

Focus and autofocus:

- `15001` ManualSingleStepFocus
   - raw argument often `08 01` (single varint field set to `1`)
- `15004` AstroAutoFocusStart
   - raw argument observed as `08 01`

Astro parameter and status flow:

- `11039` V3:StatusPoll (`V3ReqStatusPolling`)
   - `field1`: `-1`
   - `field2`: `100`
   - `field3`: `100`
   - `field4`: `-1`
- `11041` V3:SetAstroParams (`V3ReqSetAstroParams`)
   - first run: `params = "0|0|10|60|1|null"`
   - second run: `params = "0|0|30|60|1|null"`
   - interpretation: encoded tuple includes exposure and gain values used by the app profile.
- `11005` StartStacking
   - raw payload seen as large signed varint (`08 ff ff ff ff ff ff ff ff ff 01`)
   - field 1 is `ir_index`; this value is an app-side unset/default sentinel in
     this captured flow, not an infinite frame count.

Filter change:

- `16703` V3:AdjustParam (`V3ReqAdjustParam`)
   - `paramId`: `144396663052566541`
   - `value`: `2`
   - correlated with a capture path where Duo-Band was selected, but later APK
     analysis and live probes show this is not authoritative filter control.
   - DWARFLAB 3.4.1 carries Astro=`1` / Duo-Band=`2` in `11005.ir_index`.

LED / power indicator controls:

- `13500` OpenRGB: no additional fields in decoded output.
- `13501` CloseRGB: no additional fields in decoded output.
- `13503` Power indicator ON: command-only toggle path.
- `13504` Power indicator OFF: command-only toggle path.

Notes on argument format:

- Values shown above are as decoded from protobuf payloads printed by the tool.
- For commands shown as raw hex only, the argument schema is still provisional.
- Pipe strings in `11041` should be treated as protocol-defined packed parameter tuples.

---

## Cross-Capture Comparison

### `15288` exposure-duration correlation

Capture 1:

- `15288` payload: `60.0`
- Context: 60s astro session cadence

Capture 2:

- `15288` payload: `30.0`
- Context: 30s astro session cadence

Conclusion:

- High confidence that `15288` carries exposure/session duration telemetry in seconds.

### `15256` calibration result

Observed payload shape:

- field 1: double
- field 2: double

Sample values:

- `359.5664`, `49.7777`
- `359.5906`, `49.6943`
- `359.5646`, `49.7261`

Conclusion:

- The APK 3.4.1 embedded `notify.proto` descriptor identifies this message as
  `CalibrationResult` with `double azi = 1` and `double alt = 2`.
- The observed coordinate pairs are the solved mount azimuth and altitude.

---

## Undocumented / Provisional Signals

### `15256` (notify, mod=9)

Status:

- Confirmed successful calibration result by the APK descriptor.

Schema:

- field 1: `azi` (double)
- field 2: `alt` (double)

### `15262` (notify, mod=9)

Status:

- Provisional.

Observed:

- `08 01` only.

Working interpretation:

- boolean/state latch near solver/observation transitions.

### `15280` (notify, mod=9)

Status:

- Provisional but behaviorally strong.

Observed:

- `08 01` then `08 03` around autofocus start (`15004`).

Working interpretation:

- alternate autofocus state notification for this firmware path.

### `15288` (notify, mod=9)

Status:

- Strongly inferred.

Observed:

- fixed64/double payload tracks configured exposure seconds (`60.0`, `30.0`).

Working interpretation:

- exposure/session duration telemetry.

---

## Driver Impact Checklist

### Already actionable

1. Keep using focus notifications (`15257`) as primary position truth.
2. Treat `15280` as autofocus-state signal where present.
3. Use `15288` as additional telemetry to validate runtime exposure duration.
4. Keep RGB/power-indicator command map complete (`13500`, `13501`, `13503`, `13504`).

### Recommended next implementation

1. Add explicit notify decode path for `15280` in runtime/session diagnostics.
2. Add optional runtime field for latest `15288` value for easier troubleshooting.
3. Treat `15256` as successful calibration completion and retain its solved azimuth/altitude.

---

## How To Reproduce Analysis

From `tools/v3-probe`:

```powershell
node .\pcap-decode.js "c:\path\to\capture.pcap" *> .\decode-output.txt
```

Check unmapped summary:

```powershell
Select-String -Path .\decode-output.txt -Pattern "UNMAPPED CMD SUMMARY|cmd="
```

Extract key signal lines quickly:

```powershell
Select-String -Path .\decode-output.txt -Pattern "cmd=15256|cmd=15262|cmd=15280|cmd=15288|cmd=15004|cmd=15001|cmd=15257|cmd=11005|cmd=15255|cmd=15209"
```

---

## File References

- Decoder: `tools/v3-probe/pcap-decode.js`
- Capture 1 output: `tools/v3-probe/pcap-17mar-output-v3.txt`
- Capture 2 output: `tools/v3-probe/pcap2-output-v3.txt`
- This report: `tools/v3-probe/PCAP_FINDINGS.md`

---

## Consolidated Execution Pass (2026-03-17)

Scope:

- Offline investigation run executed against all captures in `tools/v3-probe/pcaps`.

Captures processed:

- `media.pcap`
- `mount.pcap`
- `pcap2.pcap`
- `PCAPdroid_17_März_19_07_09.pcap`

Generated artifacts:

- `tools/v3-probe/pcaps/media-output-v3.txt`
- `tools/v3-probe/pcaps/mount-output-v3.txt`
- `tools/v3-probe/pcaps/pcap2-output-v3.txt`
- `tools/v3-probe/pcaps/PCAPdroid_17_März_19_07_09-output-v3.txt`
- `tools/v3-probe/pcaps/decode-matrix.json`

Per-capture decode matrix summary:

| Output file | Raw lines (`raw=`) | Unmapped summary |
| --- | ---: | --- |
| `media-output-v3.txt` | 4 | `15288 x1` (candidate-undocumented) |
| `mount-output-v3.txt` | 564 | `14006 x780`, `14008 x6` (known enum, missing inner mapping) |
| `pcap2-output-v3.txt` | 55 | `15288 x6` (candidate-undocumented) |
| `PCAPdroid_17_März_19_07_09-output-v3.txt` | 64 | `15256 x3`, `15262 x3`, `15288 x3` (candidate-undocumented) |

Cross-capture candidate unknown totals:

- `15256`: `3`
- `15262`: `3`
- `15288`: `10`

Additional raw hotspots from this execution pass:

- `mount-output-v3.txt`: `14006 x555`, `11040 x6`
- `pcap2-output-v3.txt`: `11039 x22`, `11040 x9`, `15288 x6`, `11005 x4`, `15280 x4`
- `PCAPdroid_17_März_19_07_09-output-v3.txt`: `11039 x23`, `15001 x9`, `11040 x6`, `15256 x3`, `15262 x3`, `15288 x3`

Tooling status from execution run:

- Timestamp `NaN` issue in `ws-gap-check.mjs`, `ws-timeline.mjs`, and `check-skipped.mjs` was reproduced and fixed by normalizing NUL-padded TSV text and using tolerant numeric parsing.
- DWARF IP used for this run and current scripts is `10.0.10.125`.

Full reproducibility command set:

```powershell
$pcaps = Get-ChildItem .\pcaps -Filter *.pcap | Sort-Object Name
foreach ($p in $pcaps) {
   $base = [System.IO.Path]::GetFileNameWithoutExtension($p.Name)
   node .\pcap-decode.js $p.FullName *> ".\pcaps\$base-output-v3.txt"
}
```

```powershell
node .\proto-decode.js --hex "09 87 ac cd fa 0f 79 76 40 11 f8 86 92 2e 8c e3 48 40" --verbose
node .\proto-decode.js --hex "08 01" --verbose
node .\proto-decode.js --hex "09 00 00 00 00 00 00 4e 40" --verbose
```
