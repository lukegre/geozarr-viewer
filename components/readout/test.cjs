// Pure functions of the readout component: lat/lon and value formatting (D-39/D-41).
const test = require('node:test');
const assert = require('node:assert/strict');
const {load} = require('../../tests/_load.cjs');

const get = load(['core/util.js', 'components/readout/component.js'], {registerComponent: () => {}});
const formatLatLon = get('formatLatLon'), formatValue = get('formatValue');

test('formatLatLon: hemisphere letters, three decimals, never 0.000°S', () => {
  assert.equal(formatLatLon(6.63, 46.52), 'Lat: 46.520°N  Lon: 6.630°E');
  assert.equal(formatLatLon(-70.1234, -33.9999), 'Lat: 34.000°S  Lon: 70.123°W');
  assert.equal(formatLatLon(0, -0.0001), 'Lat: 0.000°N  Lon: 0.000°E');
});

test('formatValue: 4 significant digits, units, categorical without units', () => {
  assert.equal(formatValue(12.3456789, {units: 'K'}, 'sst'), 'sst: 12.35 K');
  assert.equal(formatValue(12.3456789, {units: ''}, 'sst'), 'sst: 12.35');
  assert.equal(formatValue(3, {categorical: true, units: 'x'}, 'class'), 'class: 3');
});
