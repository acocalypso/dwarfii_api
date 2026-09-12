// Offline fixtures follow dwarfAlp tests/test_session_camera.py:200/257.
// Numeric parameter ID tokens intentionally remain RAW JSON, not JS numbers.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeCurrentParamId,
  encodeCurrentParamId,
  findCurrentCameraParameter,
  normalizeCurrentCameraCatalog,
  normalizeCurrentDeviceInfo,
  normalizeCurrentParamId,
  parseCurrentExposureSeconds,
  parseCurrentJsonLossless,
  sameCurrentParameterAcrossModes,
  selectCurrentExposure,
  selectCurrentParameterValue,
  withCurrentParamMode,
} from "../../dist/src/current_catalog.js";
import { CurrentProtocolError } from "../../dist/src/current_protocol.js";

const kind = (expected) => (error) =>
  error instanceof CurrentProtocolError && error.kind === expected;

test("live Mini/D3 wide and shared parameter IDs use bits 44..47", () => {
  for (const [id, camera] of [
    ["144414255238610945", 1],
    ["144695730215321616", 1],
    ["144942020819943439", 15],
  ]) {
    const parts = decodeCurrentParamId(id);
    assert.equal(parts.cameraId, camera);
    assert.equal(parts.reserved, "0");
    assert.equal(encodeCurrentParamId(parts), id);
  }
  assert.throws(
    () =>
      encodeCurrentParamId({
        shootingMode: 2,
        category: 1,
        cameraId: 16,
        paramIndex: 1,
      }),
    kind("invalid-parameter"),
  );
});
const rawCatalog = `{
  "code":0,"data":{"cameraParams":[
    {"cameraId":0,"specialParams":{
      "exp":{"paramId":144396663052566529,"currentMode":1,"currentValue":120,
        "values":[{"name":"1/1000","value":30},{"name":"1","value":120},{"name":"5","value":141}]},
      "gain":{"paramId":144396663052566530,"currentMode":1,"currentValue":60,"values":[40,60,100]}
    },"generalParams":[{"name":"frameCount","paramId":144678138029277200,"currentValue":1,"values":[1,2,10]}]},
    {"cameraId":1,"specialParams":{
      "exp":{"paramId":144414255238610945,"currentMode":0,"currentValue":120,
        "values":[{"name":"1","value":120},{"name":"30","value":159}]}
    },"generalParams":[]}
  ]}}
`;

test("raw JSON retains unsafe integer tokens before JSON.parse can round them", () => {
  assert.deepEqual(
    parseCurrentJsonLossless(
      '{"id":144396663052566529,"max":18446744073709551615,"small":42,"fraction":0.001}',
    ),
    {
      id: "144396663052566529",
      max: "18446744073709551615",
      small: 42,
      fraction: 0.001,
    },
  );
  const stringValue = 'literal 144396663052566529 and \\"quoted\\"';
  assert.equal(
    parseCurrentJsonLossless(JSON.stringify({ text: stringValue })).text,
    stringValue,
  );
  assert.equal(
    parseCurrentJsonLossless('{"id":-9007199254740992}').id,
    "-9007199254740992",
  );
  assert.equal(
    parseCurrentJsonLossless('{"id":1.44396663052566529e17}').id,
    "1.44396663052566529e17",
  );
  for (const invalid of ['{"id":01}', '{"id":1,}', '{"id":NaN}', '"unclosed']) {
    assert.throws(() => parseCurrentJsonLossless(invalid), kind("decode"));
  }
});

test("already-rounded JS numbers and malformed uint64 IDs are rejected", () => {
  assert.equal(
    normalizeCurrentParamId("144396663052566529"),
    "144396663052566529",
  );
  assert.equal(normalizeCurrentParamId(42), "42");
  assert.equal(
    normalizeCurrentParamId(18446744073709551615n),
    "18446744073709551615",
  );
  for (const value of [
    Number("144396663052566529"),
    -1,
    "-1",
    "1.5",
    "1e18",
    "18446744073709551616",
    Infinity,
    null,
  ]) {
    assert.throws(
      () => normalizeCurrentParamId(value),
      kind("invalid-parameter"),
    );
  }
});

test("deviceInfo code and explicit numeric hardware ID determine model", () => {
  for (const [deviceId, model] of [
    [1, "dwarf2"],
    [2, "dwarf3"],
    [4, "dwarfmini"],
  ]) {
    const device = normalizeCurrentDeviceInfo(
      JSON.stringify({
        code: 0,
        data: { deviceId, deviceName: "DWARF_mini_test" },
      }),
    );
    assert.equal(device.hardwareId, deviceId);
    assert.equal(device.profile.model, model);
    assert.equal(device.deviceName, "DWARF_mini_test");
  }
  assert.equal(
    normalizeCurrentDeviceInfo({ code: 0, data: { deviceID: 4 } }).hardwareId,
    4,
  );
  assert.throws(
    () => normalizeCurrentDeviceInfo({ code: -1, data: { deviceId: 4 } }),
    kind("device"),
  );
  assert.throws(
    () => normalizeCurrentDeviceInfo({ code: 0, data: { deviceId: 5 } }),
    kind("unsupported"),
  );
  for (const data of [
    { deviceName: "DWARF_mini_test" },
    { deviceId: "4" },
    { deviceId: 2, deviceID: 4 },
  ]) {
    assert.throws(
      () => normalizeCurrentDeviceInfo({ code: 0, data }),
      kind("decode"),
    );
  }
  assert.throws(
    () => normalizeCurrentDeviceInfo({ data: { deviceId: 4 } }),
    kind("decode"),
  );
});

test("camera catalogs retain exact IDs, independent cameras and current legal values", () => {
  const catalog = normalizeCurrentCameraCatalog(rawCatalog, 2);
  assert.equal(catalog.modeId, 2);
  assert.deepEqual(
    catalog.cameras.map((camera) => camera.cameraId),
    [0, 1],
  );
  const tele = findCurrentCameraParameter(catalog, 0, "exp");
  assert.equal(tele.paramId, "144396663052566529");
  assert.equal(tele.currentMode, 1);
  assert.equal(tele.currentValue, 120);
  assert.equal(tele.currentLabel, "1");
  assert.equal(tele.label, "Exposure");
  assert.deepEqual(
    tele.options.map((option) => option.seconds),
    [0.001, 1, 5],
  );
  const wide = findCurrentCameraParameter(catalog, 1, "exp");
  assert.equal(wide.paramId, "144414255238610945");
  assert.equal(wide.namespace.cameraId, 1);
  assert.equal(wide.currentMode, 0);
  assert.equal(
    findCurrentCameraParameter(catalog, 0, "frameCount").source,
    "general",
  );
});

test("exposure duration uses exact discovered label/code, never index arithmetic or nearest value", () => {
  const catalog = normalizeCurrentCameraCatalog(rawCatalog, 2);
  assert.deepEqual(selectCurrentExposure(catalog, 0, 0.001), {
    paramId: "144396663052566529",
    value: 30,
  });
  assert.deepEqual(selectCurrentExposure(catalog, 0, 1), {
    paramId: "144396663052566529",
    value: 120,
  });
  assert.deepEqual(selectCurrentExposure(catalog, 1, 30), {
    paramId: "144414255238610945",
    value: 159,
  });
  assert.throws(
    () => selectCurrentExposure(catalog, 0, 30),
    kind("unsupported"),
  );
  assert.throws(
    () => selectCurrentExposure(catalog, 1, 0.001),
    kind("unsupported"),
  );
  assert.throws(
    () => selectCurrentExposure(catalog, 0, 1.1),
    kind("unsupported"),
  );
  assert.throws(
    () => selectCurrentExposure(catalog, 0, 0),
    kind("invalid-parameter"),
  );
  assert.equal(parseCurrentExposureSeconds("1/10000"), 0.0001);
  assert.equal(parseCurrentExposureSeconds("1.3 s"), 1.3);
  for (const label of ["Auto", "1/0", "-1", "1 ms", "invalid"])
    assert.equal(parseCurrentExposureSeconds(label), undefined);
});

test("gain selection uses advertised values and absent options/IDs remain unavailable", () => {
  const catalog = normalizeCurrentCameraCatalog(rawCatalog, 2);
  const gain = findCurrentCameraParameter(catalog, 0, "gain");
  assert.deepEqual(selectCurrentParameterValue(gain, 60), {
    paramId: "144396663052566530",
    value: 60,
  });
  assert.throws(
    () => selectCurrentParameterValue(gain, 70),
    kind("unsupported"),
  );
  const missing = normalizeCurrentCameraCatalog(
    {
      code: 0,
      data: {
        cameraParams: [
          { cameraId: 0, specialParams: { exp: { name: "exp" } } },
        ],
      },
    },
    8,
  );
  const exp = findCurrentCameraParameter(missing, 0, "exp");
  assert.equal(exp.paramId, undefined);
  assert.equal(exp.currentValue, undefined);
  assert.equal(exp.currentMode, undefined);
  assert.equal(exp.options, undefined);
  assert.throws(
    () => selectCurrentParameterValue(exp, 120),
    kind("unsupported"),
  );
  assert.throws(
    () => findCurrentCameraParameter(missing, 1, "exp"),
    kind("unsupported"),
  );
});

test("catalogs reject failed discovery, unsafe pre-parsed IDs and mismatched modes", () => {
  assert.throws(
    () => normalizeCurrentCameraCatalog({ code: -1, data: {} }, 2),
    kind("device"),
  );
  assert.throws(
    () => normalizeCurrentCameraCatalog({ code: 0, data: {} }, 2),
    kind("decode"),
  );
  assert.throws(
    () => normalizeCurrentCameraCatalog(JSON.parse(rawCatalog), 2),
    kind("invalid-parameter"),
  );
  assert.throws(
    () =>
      normalizeCurrentCameraCatalog(
        { code: 0, data: { modeId: 8, cameraParams: [] } },
        2,
      ),
    kind("decode"),
  );
  assert.throws(
    () =>
      normalizeCurrentCameraCatalog(
        { code: 0, data: { cameraParams: [{ cameraId: 0 }, { cameraId: 0 }] } },
        2,
      ),
    kind("decode"),
  );
});

test("namespace helpers retain uint64 bits and cannot confuse tele, wide or category", () => {
  const exposure = "144396663052566529";
  assert.deepEqual(decodeCurrentParamId(exposure), {
    shootingMode: 2,
    category: 1,
    cameraId: 0,
    paramIndex: 1,
    reserved: "0",
  });
  assert.equal(encodeCurrentParamId(decodeCurrentParamId(exposure)), exposure);
  for (const mode of [11, 13]) {
    const runtime = withCurrentParamMode(exposure, mode);
    assert.equal(decodeCurrentParamId(runtime).shootingMode, mode);
    assert.equal(sameCurrentParameterAcrossModes(exposure, runtime), true);
  }
  assert.equal(
    sameCurrentParameterAcrossModes(exposure, "144414255238610945"),
    false,
  );
  assert.equal(
    sameCurrentParameterAcrossModes(exposure, "144678138029277200"),
    false,
  );
  const reserved = encodeCurrentParamId({
    shootingMode: 2,
    category: 1,
    cameraId: 1,
    paramIndex: 13,
    reserved: "4294967295",
  });
  const shifted = withCurrentParamMode(reserved, 13);
  assert.equal(decodeCurrentParamId(shifted).reserved, "4294967295");
  assert.equal(sameCurrentParameterAcrossModes(reserved, shifted), true);
  assert.throws(
    () => withCurrentParamMode(exposure, 256),
    kind("invalid-parameter"),
  );
  assert.throws(
    () =>
      encodeCurrentParamId({
        shootingMode: 2,
        category: 1,
        cameraId: -1,
        paramIndex: 1,
      }),
    kind("invalid-parameter"),
  );
});

test("runtime labels and false/zero values are retained without model-static text", () => {
  const catalog = normalizeCurrentCameraCatalog(
    {
      code: 0,
      data: {
        cameraParams: [
          {
            cameraId: 0,
            generalParams: [
              {
                name: "customFilter",
                paramId: "13",
                currentValue: 2,
                values: [{ name: "Reported filter", value: 2 }],
              },
              { name: "switch", currentValue: false, values: [false, true] },
              { name: "zero", currentValue: 0, values: [0, 1] },
            ],
          },
        ],
      },
    },
    8,
  );
  assert.equal(
    findCurrentCameraParameter(catalog, 0, "customFilter").currentLabel,
    "Reported filter",
  );
  assert.equal(
    findCurrentCameraParameter(catalog, 0, "switch").currentValue,
    false,
  );
  assert.equal(findCurrentCameraParameter(catalog, 0, "zero").currentValue, 0);
});
