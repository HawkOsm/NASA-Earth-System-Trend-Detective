'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { clean, allowed } = require('./server.js');

test('a good reading passes through', () => {
  assert.deepStrictEqual(clean({ place: ' Sahara ', lat: 23.4, lng: 12.1, start_year: 1995, end_year: 2008, variable: 'T2M' }), {
    place: 'Sahara', lat: 23.4, lng: 12.1, start: 1995, end: 2008, variable: 'T2M',
  });
});

test('wrong types, ranges and unknown variables become null', () => {
  assert.deepStrictEqual(clean({ place: 'X', lat: 123, lng: 5, start_year: '1995', end_year: 3000, variable: 'CO2' }), {
    place: 'X', lat: null, lng: null, start: null, end: null, variable: null,
  });
  assert.deepStrictEqual(clean(null), { place: null, lat: null, lng: null, start: null, end: null, variable: null });
  assert.strictEqual(clean({ place: 'a'.repeat(200) }).place.length, 80);
});

test('coordinates without a place are dropped', () => {
  const r = clean({ place: null, lat: 10, lng: 10 });
  assert.strictEqual(r.lat, null);
  assert.strictEqual(r.lng, null);
});

test('twelve questions a minute per address, then refused; another address is unaffected', () => {
  const t = Date.UTC(2026, 10, 15, 12, 0, 0);
  for (let k = 0; k < 12; k++) assert.strictEqual(allowed('1.2.3.4', t + k * 1000), null);
  assert.match(allowed('1.2.3.4', t + 13000), /Too many/);
  assert.strictEqual(allowed('5.6.7.8', t + 13000), null);
  assert.strictEqual(allowed('1.2.3.4', t + 62000), null); // a minute later
});
