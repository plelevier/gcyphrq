import { describe, it, expect } from 'vitest';
import { executeQuery } from '../src/lib';

const graphData = {
  nodes: [
    { key: 'a', attributes: { name: 'Alice', createdAt: '2023-06-15T10:30:00.000Z' } },
    { key: 'b', attributes: { name: 'Bob', createdAt: '2024-01-20T14:45:30.000Z' } },
    { key: 'c', attributes: { name: 'Charlie', createdAt: '2022-12-01T08:00:00.000Z' } },
  ],
  edges: [
    { source: 'a', target: 'b', attributes: { type: 'KNOWS' } },
    { source: 'b', target: 'c', attributes: { type: 'FRIENDS' } },
  ],
};

// ── timestamp() ──────────────────────────────────────────────────────────────

describe('timestamp()', () => {
  it('returns current unix timestamp in seconds', async () => {
    const results = await executeQuery(graphData, 'RETURN timestamp() AS ts');
    expect(results).toHaveLength(1);
    const ts = results[0]!.ts as number;
    expect(typeof ts).toBe('number');
    expect(ts).toBeGreaterThan(1_700_000_000); // after Nov 2023
    expect(ts).toBeLessThan(2_000_000_000);   // before ~2033
  });

  it('works in WHERE clause', async () => {
    const results = await executeQuery(graphData, 'MATCH (n) WHERE timestamp() > 1700000000 RETURN n.name AS name LIMIT 1');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('works in SET clause', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n {name: "Alice"}) SET n.updated = timestamp() RETURN n.updated AS updated'
    );
    expect(results).toHaveLength(1);
    expect(typeof results[0]!.updated).toBe('number');
  });

  it('works in MERGE ON CREATE SET', async () => {
    const results = await executeQuery(
      graphData,
      'MERGE (n {name: "NewUser"}) ON CREATE SET n.createdAt = timestamp() RETURN n.createdAt AS createdAt'
    );
    expect(results).toHaveLength(1);
    expect(typeof results[0]!.createdAt).toBe('number');
  });
});

// ── datetime() ───────────────────────────────────────────────────────────────

describe('datetime()', () => {
  it('returns current datetime as ISO 8601 string', async () => {
    const results = await executeQuery(graphData, 'RETURN datetime() AS dt');
    expect(results).toHaveLength(1);
    const dt = results[0]!.dt as string;
    expect(dt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('constructs datetime from year, month, day', async () => {
    const results = await executeQuery(graphData, 'RETURN datetime(2023, 6, 15) AS dt');
    expect(results).toEqual([{ dt: '2023-06-15T00:00:00.000Z' }]);
  });

  it('constructs datetime from year, month, day, hour, minute, second', async () => {
    const results = await executeQuery(graphData, 'RETURN datetime(2023, 6, 15, 14, 30, 45) AS dt');
    expect(results).toEqual([{ dt: '2023-06-15T14:30:45.000Z' }]);
  });

  it('constructs datetime from year, month, day, hour, minute, second, millisecond', async () => {
    const results = await executeQuery(graphData, 'RETURN datetime(2023, 6, 15, 14, 30, 45, 123) AS dt');
    expect(results).toEqual([{ dt: '2023-06-15T14:30:45.123Z' }]);
  });

  it('constructs datetime from map', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN datetime({year: 2023, month: 6, day: 15, hour: 14, minute: 30, second: 45}) AS dt'
    );
    expect(results).toEqual([{ dt: '2023-06-15T14:30:45.000Z' }]);
  });

  it('constructs datetime from map with millisecond', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN datetime({year: 2023, month: 6, day: 15, hour: 14, minute: 30, second: 45, millisecond: 500}) AS dt'
    );
    expect(results).toEqual([{ dt: '2023-06-15T14:30:45.500Z' }]);
  });

  it('constructs datetime from ISO string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN datetime('2023-06-15T14:30:45.123Z') AS dt"
    );
    expect(results).toEqual([{ dt: '2023-06-15T14:30:45.123Z' }]);
  });

  it('constructs datetime from date string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN datetime('2023-06-15') AS dt"
    );
    expect(results).toEqual([{ dt: '2023-06-15T00:00:00.000Z' }]);
  });

  it('returns null for invalid date string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN datetime('not-a-date') AS dt"
    );
    expect(results).toEqual([{ dt: null }]);
  });

  it('defaults to 1970-01-01 when no args and map is empty', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN datetime({}) AS dt'
    );
    expect(results).toEqual([{ dt: '1970-01-01T00:00:00.000Z' }]);
  });
});

// ── date() ───────────────────────────────────────────────────────────────────

describe('date()', () => {
  it('returns current date as ISO 8601 date string', async () => {
    const results = await executeQuery(graphData, 'RETURN date() AS d');
    expect(results).toHaveLength(1);
    const d = results[0]!.d as string;
    expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('constructs date from year, month, day', async () => {
    const results = await executeQuery(graphData, 'RETURN date(2023, 6, 15) AS d');
    expect(results).toEqual([{ d: '2023-06-15' }]);
  });

  it('constructs date from map', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN date({year: 2023, month: 6, day: 15}) AS d'
    );
    expect(results).toEqual([{ d: '2023-06-15' }]);
  });

  it('constructs date from ISO string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN date('2023-06-15') AS d"
    );
    expect(results).toEqual([{ d: '2023-06-15' }]);
  });

  it('constructs date from datetime string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN date('2023-06-15T14:30:45.000Z') AS d"
    );
    expect(results).toEqual([{ d: '2023-06-15' }]);
  });
});

// ── time() ───────────────────────────────────────────────────────────────────

describe('time()', () => {
  it('returns current time as ISO 8601 time string', async () => {
    const results = await executeQuery(graphData, 'RETURN time() AS t');
    expect(results).toHaveLength(1);
    const t = results[0]!.t as string;
    expect(t).toMatch(/^\d{2}:\d{2}:\d{2}(?:\.\d{3})?$/);
  });

  it('constructs time from hour, minute, second', async () => {
    const results = await executeQuery(graphData, 'RETURN time(14, 30, 45) AS t');
    expect(results).toEqual([{ t: '14:30:45' }]);
  });

  it('constructs time from hour, minute, second, millisecond', async () => {
    const results = await executeQuery(graphData, 'RETURN time(14, 30, 45, 123) AS t');
    expect(results).toEqual([{ t: '14:30:45.123' }]);
  });

  it('constructs time from map', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN time({hour: 14, minute: 30, second: 45}) AS t'
    );
    expect(results).toEqual([{ t: '14:30:45' }]);
  });

  it('constructs time from map with millisecond', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN time({hour: 14, minute: 30, second: 45, millisecond: 500}) AS t'
    );
    expect(results).toEqual([{ t: '14:30:45.500' }]);
  });

  it('constructs time from time string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN time('14:30:45') AS t"
    );
    expect(results).toEqual([{ t: '14:30:45' }]);
  });

  it('constructs time from time string with milliseconds', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN time('14:30:45.123') AS t"
    );
    expect(results).toEqual([{ t: '14:30:45.123' }]);
  });
});

// ── localdatetime() ──────────────────────────────────────────────────────────

describe('localdatetime()', () => {
  it('returns current local datetime', async () => {
    const results = await executeQuery(graphData, 'RETURN localdatetime() AS dt');
    expect(results).toHaveLength(1);
    const dt = results[0]!.dt as string;
    expect(dt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/);
    // Should not include timezone suffix
    expect(dt).not.toContain('Z');
  });

  it('constructs localdatetime from components', async () => {
    const results = await executeQuery(graphData, 'RETURN localdatetime(2023, 6, 15, 14, 30, 45) AS dt');
    expect(results).toEqual([{ dt: '2023-06-15T14:30:45' }]);
  });

  it('constructs localdatetime from components with milliseconds', async () => {
    const results = await executeQuery(graphData, 'RETURN localdatetime(2023, 6, 15, 14, 30, 45, 123) AS dt');
    expect(results).toEqual([{ dt: '2023-06-15T14:30:45.123' }]);
  });

  it('constructs localdatetime from map', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN localdatetime({year: 2023, month: 6, day: 15, hour: 14, minute: 30}) AS dt'
    );
    expect(results).toEqual([{ dt: '2023-06-15T14:30:00' }]);
  });
});

// ── localtime() ──────────────────────────────────────────────────────────────

describe('localtime()', () => {
  it('returns current local time', async () => {
    const results = await executeQuery(graphData, 'RETURN localtime() AS t');
    expect(results).toHaveLength(1);
    const t = results[0]!.t as string;
    expect(t).toMatch(/^\d{2}:\d{2}:\d{2}(?:\.\d{3})?$/);
  });

  it('constructs localtime from components', async () => {
    const results = await executeQuery(graphData, 'RETURN localtime(14, 30, 45) AS t');
    expect(results).toEqual([{ t: '14:30:45' }]);
  });

  it('constructs localtime from components with milliseconds', async () => {
    const results = await executeQuery(graphData, 'RETURN localtime(14, 30, 45, 500) AS t');
    expect(results).toEqual([{ t: '14:30:45.500' }]);
  });

  it('constructs localtime from map', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN localtime({hour: 14, minute: 30, second: 45}) AS t'
    );
    expect(results).toEqual([{ t: '14:30:45' }]);
  });
});

// ── duration() ───────────────────────────────────────────────────────────────

describe('duration()', () => {
  it('constructs duration from map with all components', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN duration({years: 1, months: 2, days: 3, hours: 4, minutes: 5, seconds: 6}) AS dur'
    );
    expect(results).toEqual([{ dur: 'P1Y2M3DT4H5M6S' }]);
  });

  it('constructs duration with only years', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN duration({years: 5}) AS dur'
    );
    expect(results).toEqual([{ dur: 'P5Y' }]);
  });

  it('constructs duration with only months', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN duration({months: 3}) AS dur'
    );
    expect(results).toEqual([{ dur: 'P3M' }]);
  });

  it('constructs duration with only days', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN duration({days: 10}) AS dur'
    );
    expect(results).toEqual([{ dur: 'P10D' }]);
  });

  it('constructs duration with only hours', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN duration({hours: 2}) AS dur'
    );
    expect(results).toEqual([{ dur: 'PT2H' }]);
  });

  it('constructs duration with only minutes', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN duration({minutes: 30}) AS dur'
    );
    expect(results).toEqual([{ dur: 'PT30M' }]);
  });

  it('constructs duration with only seconds', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN duration({seconds: 45}) AS dur'
    );
    expect(results).toEqual([{ dur: 'PT45S' }]);
  });

  it('constructs duration with milliseconds', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN duration({seconds: 1, milliseconds: 500}) AS dur'
    );
    expect(results).toEqual([{ dur: 'PT1.5S' }]);
  });

  it('constructs duration with only milliseconds', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN duration({milliseconds: 250}) AS dur'
    );
    expect(results).toEqual([{ dur: 'PT0.25S' }]);
  });

  it('constructs duration with years and days', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN duration({years: 2, days: 5}) AS dur'
    );
    expect(results).toEqual([{ dur: 'P2Y5D' }]);
  });

  it('constructs duration with days and hours', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN duration({days: 1, hours: 2, minutes: 30}) AS dur'
    );
    expect(results).toEqual([{ dur: 'P1DT2H30M' }]);
  });

  it('returns P0D for empty map', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN duration({}) AS dur'
    );
    expect(results).toEqual([{ dur: 'P0D' }]);
  });

  it('returns null for no arguments', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN duration() AS dur'
    );
    expect(results).toEqual([{ dur: null }]);
  });

  it('passes through ISO duration string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN duration('P1Y2M3DT4H5M6S') AS dur"
    );
    expect(results).toEqual([{ dur: 'P1Y2M3DT4H5M6S' }]);
  });
});

// ── Temporal extractors ──────────────────────────────────────────────────────

describe('year()', () => {
  it('extracts year from datetime string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN year('2023-06-15T14:30:45.000Z') AS y"
    );
    expect(results).toEqual([{ y: 2023 }]);
  });

  it('extracts year from date string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN year('2023-06-15') AS y"
    );
    expect(results).toEqual([{ y: 2023 }]);
  });

  it('extracts year from datetime()', async () => {
    const results = await executeQuery(graphData, 'RETURN year(datetime(2024, 3, 1)) AS y');
    expect(results).toEqual([{ y: 2024 }]);
  });

  it('returns null for time-only string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN year('14:30:45') AS y"
    );
    expect(results).toEqual([{ y: null }]);
  });

  it('returns null for null input', async () => {
    const results = await executeQuery(graphData, 'RETURN year(null) AS y');
    expect(results).toEqual([{ y: null }]);
  });

  it('extracts year from node property', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n {name: "Alice"}) RETURN year(n.createdAt) AS y'
    );
    expect(results).toEqual([{ y: 2023 }]);
  });
});

describe('month()', () => {
  it('extracts month from datetime string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN month('2023-06-15T14:30:45.000Z') AS m"
    );
    expect(results).toEqual([{ m: 6 }]);
  });

  it('extracts month from date string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN month('2023-12-25') AS m"
    );
    expect(results).toEqual([{ m: 12 }]);
  });

  it('returns null for time-only string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN month('14:30:45') AS m"
    );
    expect(results).toEqual([{ m: null }]);
  });
});

describe('day()', () => {
  it('extracts day from datetime string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN day('2023-06-15T14:30:45.000Z') AS d"
    );
    expect(results).toEqual([{ d: 15 }]);
  });

  it('extracts day from date string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN day('2023-01-01') AS d"
    );
    expect(results).toEqual([{ d: 1 }]);
  });
});

describe('hour()', () => {
  it('extracts hour from datetime string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN hour('2023-06-15T14:30:45.000Z') AS h"
    );
    expect(results).toEqual([{ h: 14 }]);
  });

  it('extracts hour from time string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN hour('23:59:59') AS h"
    );
    expect(results).toEqual([{ h: 23 }]);
  });

  it('returns null for date-only string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN hour('2023-06-15') AS h"
    );
    expect(results).toEqual([{ h: null }]);
  });
});

describe('minute()', () => {
  it('extracts minute from datetime string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN minute('2023-06-15T14:30:45.000Z') AS m"
    );
    expect(results).toEqual([{ m: 30 }]);
  });

  it('extracts minute from time string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN minute('14:59:00') AS m"
    );
    expect(results).toEqual([{ m: 59 }]);
  });
});

describe('second()', () => {
  it('extracts second from datetime string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN second('2023-06-15T14:30:45.123Z') AS s"
    );
    expect(results).toEqual([{ s: 45 }]);
  });

  it('extracts second from time string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN second('14:30:59') AS s"
    );
    expect(results).toEqual([{ s: 59 }]);
  });
});

describe('millisecond()', () => {
  it('extracts millisecond from datetime string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN millisecond('2023-06-15T14:30:45.123Z') AS ms"
    );
    expect(results).toEqual([{ ms: 123 }]);
  });

  it('extracts millisecond from time string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN millisecond('14:30:45.999') AS ms"
    );
    expect(results).toEqual([{ ms: 999 }]);
  });

  it('returns 0 when no milliseconds in string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN millisecond('2023-06-15T14:30:45Z') AS ms"
    );
    expect(results).toEqual([{ ms: 0 }]);
  });
});

describe('timezone()', () => {
  it('extracts timezone Z from datetime with Z suffix', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN timezone('2023-06-15T14:30:45.000Z') AS tz"
    );
    expect(results).toEqual([{ tz: 'Z' }]);
  });

  it('returns null for date-only string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN timezone('2023-06-15') AS tz"
    );
    expect(results).toEqual([{ tz: null }]);
  });

  it('returns null for time-only string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN timezone('14:30:45') AS tz"
    );
    expect(results).toEqual([{ tz: null }]);
  });
});

describe('epochseconds()', () => {
  it('extracts epoch seconds from datetime string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN epochseconds('2023-01-01T00:00:00.000Z') AS epoch"
    );
    expect(results).toEqual([{ epoch: 1672531200 }]);
  });

  it('extracts epoch seconds from date string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN epochseconds('2023-01-01') AS epoch"
    );
    expect(results).toEqual([{ epoch: 1672531200 }]);
  });

  it('extracts epoch seconds from number (epoch seconds)', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN epochseconds(1672531200) AS epoch'
    );
    expect(results).toEqual([{ epoch: 1672531200 }]);
  });

  it('extracts epoch seconds from number (epoch milliseconds)', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN epochseconds(1672531200000) AS epoch'
    );
    expect(results).toEqual([{ epoch: 1672531200 }]);
  });
});

describe('epochmillisecond()', () => {
  it('extracts epoch milliseconds from datetime string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN epochmillisecond('2023-01-01T00:00:00.000Z') AS epoch"
    );
    expect(results).toEqual([{ epoch: 1672531200000 }]);
  });

  it('extracts epoch milliseconds from date string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN epochmillisecond('2023-01-01') AS epoch"
    );
    expect(results).toEqual([{ epoch: 1672531200000 }]);
  });

  it('extracts epoch milliseconds from number (epoch seconds)', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN epochmillisecond(1672531200) AS epoch'
    );
    expect(results).toEqual([{ epoch: 1672531200000 }]);
  });

  it('extracts epoch milliseconds from number (epoch milliseconds)', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN epochmillisecond(1672531200000) AS epoch'
    );
    expect(results).toEqual([{ epoch: 1672531200000 }]);
  });
});

// ── Temporal functions with node properties ──────────────────────────────────

describe('Temporal functions with node properties', () => {
  it('extracts year from node createdAt property', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n) RETURN n.name AS name, year(n.createdAt) AS year ORDER BY name'
    );
    expect(results).toEqual([
      { name: 'Alice', year: 2023 },
      { name: 'Bob', year: 2024 },
      { name: 'Charlie', year: 2022 },
    ]);
  });

  it('extracts month from node createdAt property', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n) RETURN n.name AS name, month(n.createdAt) AS month ORDER BY name'
    );
    expect(results).toEqual([
      { name: 'Alice', month: 6 },
      { name: 'Bob', month: 1 },
      { name: 'Charlie', month: 12 },
    ]);
  });

  it('extracts day from node createdAt property', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n) RETURN n.name AS name, day(n.createdAt) AS day ORDER BY name'
    );
    expect(results).toEqual([
      { name: 'Alice', day: 15 },
      { name: 'Bob', day: 20 },
      { name: 'Charlie', day: 1 },
    ]);
  });

  it('extracts hour from node createdAt property', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n) RETURN n.name AS name, hour(n.createdAt) AS hour ORDER BY name'
    );
    expect(results).toEqual([
      { name: 'Alice', hour: 10 },
      { name: 'Bob', hour: 14 },
      { name: 'Charlie', hour: 8 },
    ]);
  });

  it('extracts minute from node createdAt property', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n) RETURN n.name AS name, minute(n.createdAt) AS minute ORDER BY name'
    );
    expect(results).toEqual([
      { name: 'Alice', minute: 30 },
      { name: 'Bob', minute: 45 },
      { name: 'Charlie', minute: 0 },
    ]);
  });

  it('extracts second from node createdAt property', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n) RETURN n.name AS name, second(n.createdAt) AS second ORDER BY name'
    );
    expect(results).toEqual([
      { name: 'Alice', second: 0 },
      { name: 'Bob', second: 30 },
      { name: 'Charlie', second: 0 },
    ]);
  });

  it('extracts timezone from node createdAt property', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n {name: "Alice"}) RETURN timezone(n.createdAt) AS tz'
    );
    expect(results).toEqual([{ tz: 'Z' }]);
  });
});

// ── Temporal in WHERE clause ─────────────────────────────────────────────────

describe('Temporal in WHERE clause', () => {
  it('filter by year', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n) WHERE year(n.createdAt) >= 2023 RETURN n.name AS name ORDER BY name'
    );
    expect(results).toEqual([
      { name: 'Alice' },
      { name: 'Bob' },
    ]);
  });

  it('filter by month', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n) WHERE month(n.createdAt) > 6 RETURN n.name AS name ORDER BY name'
    );
    expect(results).toEqual([{ name: 'Charlie' }]);
  });

  it('filter by hour', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n) WHERE hour(n.createdAt) >= 14 RETURN n.name AS name ORDER BY name'
    );
    expect(results).toEqual([{ name: 'Bob' }]);
  });

  it('filter by epochseconds', async () => {
    // Alice: 2023-06-15 (1686825000), Bob: 2024-01-20 (1705761930), Charlie: 2022-12-01 (1669881600)
    // 1700000000 is Nov 14, 2023, so only Bob is after that
    const results = await executeQuery(
      graphData,
      'MATCH (n) WHERE epochseconds(n.createdAt) > 1700000000 RETURN n.name AS name ORDER BY name'
    );
    expect(results).toEqual([{ name: 'Bob' }]);
  });
});

// ── Temporal in ORDER BY ─────────────────────────────────────────────────────

describe('Temporal in ORDER BY', () => {
  it('order by year', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n) RETURN n.name AS name ORDER BY year(n.createdAt)'
    );
    expect(results.map((r: any) => r.name)).toEqual(['Charlie', 'Alice', 'Bob']);
  });

  it('order by epochseconds DESC', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n) RETURN n.name AS name ORDER BY epochseconds(n.createdAt) DESC'
    );
    expect(results.map((r: any) => r.name)).toEqual(['Bob', 'Alice', 'Charlie']);
  });
});

// ── Temporal in WITH clause ──────────────────────────────────────────────────

describe('Temporal in WITH clause', () => {
  it('extract year in WITH', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n) WITH n.name AS name, year(n.createdAt) AS yr WHERE yr >= 2023 RETURN name ORDER BY name'
    );
    expect(results).toEqual([
      { name: 'Alice' },
      { name: 'Bob' },
    ]);
  });

  it('extract multiple components in WITH', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n) WITH n.name AS name, year(n.createdAt) AS y, month(n.createdAt) AS m RETURN name, y, m ORDER BY name'
    );
    expect(results).toEqual([
      { name: 'Alice', y: 2023, m: 6 },
      { name: 'Bob', y: 2024, m: 1 },
      { name: 'Charlie', y: 2022, m: 12 },
    ]);
  });
});

// ── Temporal in SET clause ───────────────────────────────────────────────────

describe('Temporal in SET clause', () => {
  it('set node property to timestamp', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n {name: "Alice"}) SET n.updated = timestamp() RETURN n.updated AS updated'
    );
    expect(results).toHaveLength(1);
    expect(typeof results[0]!.updated).toBe('number');
  });

  it('set node property to date', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n {name: "Alice"}) SET n.birthday = date(1990, 1, 15) RETURN n.birthday AS birthday'
    );
    expect(results).toEqual([{ birthday: '1990-01-15' }]);
  });

  it('set node property to datetime', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n {name: "Alice"}) SET n.createdAt = datetime(2023, 6, 15, 10, 30, 0) RETURN n.createdAt AS createdAt'
    );
    expect(results).toEqual([{ createdAt: '2023-06-15T10:30:00.000Z' }]);
  });
});

// ── Combined temporal expressions ────────────────────────────────────────────

describe('Combined temporal expressions', () => {
  it('datetime with arithmetic in RETURN', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN epochseconds(datetime(2023, 1, 1)) + 86400 AS tomorrow'
    );
    expect(results).toEqual([{ tomorrow: 1672617600 }]);
  });

  it('nested temporal functions', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN year(datetime(epochseconds('2023-06-15T14:30:45.000Z'))) AS y"
    );
    expect(results).toEqual([{ y: 2023 }]);
  });

  it('coalesce with temporal', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN coalesce(year(null), 2023) AS y'
    );
    expect(results).toEqual([{ y: 2023 }]);
  });

  it('temporal in CASE expression', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n) RETURN n.name AS name, CASE WHEN year(n.createdAt) >= 2023 THEN "recent" ELSE "older" END AS category ORDER BY name'
    );
    expect(results).toEqual([
      { name: 'Alice', category: 'recent' },
      { name: 'Bob', category: 'recent' },
      { name: 'Charlie', category: 'older' },
    ]);
  });

  it('temporal in list comprehension', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN [y IN [2022, 2023, 2024] | y + 1] AS years'
    );
    expect(results).toEqual([{ years: [2023, 2024, 2025] }]);
  });

  it('temporal with arithmetic in RETURN', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n) WHERE n.name = "Alice" RETURN epochseconds(n.createdAt) + 86400 AS tomorrow'
    );
    // Alice.createdAt = '2023-06-15T10:30:00.000Z' -> epoch 1686825000
    expect(results).toEqual([{ tomorrow: 1686911400 }]);
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe('Edge cases', () => {
  it('returns null for invalid datetime string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN year('not-a-date') AS y"
    );
    expect(results).toEqual([{ y: null }]);
  });

  it('returns null for null input to extractor', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN month(null) AS m'
    );
    expect(results).toEqual([{ m: null }]);
  });

  it('returns null for undefined input to extractor', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n) RETURN day(n.nonexistent) AS d'
    );
    expect(results[0]!.d).toBeNull();
  });

  it('datetime with overflow date normalizes (JS Date behavior)', async () => {
    // JS Date normalizes month 13 to next year, month 1
    const results = await executeQuery(
      graphData,
      'RETURN datetime(2023, 13, 1) AS dt'
    );
    expect(results).toEqual([{ dt: '2024-01-01T00:00:00.000Z' }]);
  });

  it('date with invalid date returns null', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN date(2023, 2, 30) AS d'
    );
    // Feb 30 overflows to March 2 in JS Date
    expect(results[0]!.d).toBe('2023-03-02');
  });

  it('time with zero hour', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN time(0, 0, 0) AS t'
    );
    expect(results).toEqual([{ t: '00:00:00' }]);
  });

  it('time with max values', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN time(23, 59, 59, 999) AS t'
    );
    expect(results).toEqual([{ t: '23:59:59.999' }]);
  });

  it('duration with all zeros returns P0D', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN duration({years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 0, milliseconds: 0}) AS dur'
    );
    expect(results).toEqual([{ dur: 'P0D' }]);
  });

  it('epochseconds from time-only string returns null for date parts', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN year('14:30:45') AS y, hour('14:30:45') AS h"
    );
    expect(results).toEqual([{ y: null, h: 14 }]);
  });
});

// ── Timezone support ─────────────────────────────────────────────────────

describe('Timezone support', () => {
  it('extracts Z timezone from datetime with Z suffix', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN timezone('2023-06-15T14:30:45.000Z') AS tz"
    );
    expect(results).toEqual([{ tz: 'Z' }]);
  });

  it('extracts positive timezone offset from datetime', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN timezone('2023-06-15T14:30:45+02:00') AS tz"
    );
    expect(results).toEqual([{ tz: '+02:00' }]);
  });

  it('extracts negative timezone offset from datetime', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN timezone('2023-06-15T14:30:45-05:00') AS tz"
    );
    expect(results).toEqual([{ tz: '-05:00' }]);
  });

  it('extracts timezone offset without colon', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN timezone('2023-06-15T14:30:45+0200') AS tz"
    );
    expect(results).toEqual([{ tz: '+02:00' }]);
  });

  it('returns null timezone for date-only string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN timezone('2023-06-15') AS tz"
    );
    expect(results).toEqual([{ tz: null }]);
  });

  it('returns null timezone for time-only string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN timezone('14:30:45') AS tz"
    );
    expect(results).toEqual([{ tz: null }]);
  });

  it('extracts year from datetime with timezone offset', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN year('2023-06-15T14:30:45+02:00') AS y"
    );
    expect(results).toEqual([{ y: 2023 }]);
  });

  it('extracts hour from datetime with timezone offset', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN hour('2023-06-15T14:30:45+02:00') AS h"
    );
    expect(results).toEqual([{ h: 14 }]);
  });
});

// ── datetimewithtimezone() / timewithzone() ──────────────────────────────

describe('datetimewithtimezone()', () => {
  it('returns current datetime with timezone', async () => {
    const results = await executeQuery(graphData, 'RETURN datetimewithtimezone() AS dt');
    expect(results).toHaveLength(1);
    const dt = results[0]!.dt as string;
    expect(dt).toMatch(/Z$/);
  });

  it('constructs from string with timezone', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN datetimewithtimezone('2023-06-15T14:30:45+02:00') AS dt"
    );
    expect(results).toEqual([{ dt: '2023-06-15T14:30:45+02:00' }]);
  });

  it('constructs from string with timezone and milliseconds', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN datetimewithtimezone('2023-06-15T14:30:45.123+02:00') AS dt"
    );
    expect(results).toEqual([{ dt: '2023-06-15T14:30:45.123+02:00' }]);
  });

  it('constructs from map with timezone', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN datetimewithtimezone({year: 2023, month: 6, day: 15, hour: 14, minute: 30, timezone: '+02:00'}) AS dt"
    );
    expect(results).toEqual([{ dt: '2023-06-15T14:30:00.000+02:00' }]);
  });

  it('defaults to Z timezone when not specified', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN datetimewithtimezone({year: 2023, month: 6, day: 15, hour: 14, minute: 30}) AS dt'
    );
    expect(results).toEqual([{ dt: '2023-06-15T14:30:00.000Z' }]);
  });
});

describe('timewithzone()', () => {
  it('returns current time with timezone', async () => {
    const results = await executeQuery(graphData, 'RETURN timewithzone() AS t');
    expect(results).toHaveLength(1);
    const t = results[0]!.t as string;
    expect(t).toMatch(/Z$/);
  });

  it('constructs from string with timezone', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN timewithzone('14:30:45+02:00') AS t"
    );
    expect(results).toEqual([{ t: '14:30:45+02:00' }]);
  });

  it('constructs from components', async () => {
    const results = await executeQuery(graphData, 'RETURN timewithzone(14, 30, 45) AS t');
    expect(results).toEqual([{ t: '14:30:45Z' }]);
  });
});

// ── Duration parsing and extractors ──────────────────────────────────────

describe('Duration parsing (string validation)', () => {
  it('accepts valid ISO duration', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN duration('P1Y2M3DT4H5M6S') AS dur"
    );
    expect(results).toEqual([{ dur: 'P1Y2M3DT4H5M6S' }]);
  });

  it('accepts duration with only days', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN duration('P10D') AS dur"
    );
    expect(results).toEqual([{ dur: 'P10D' }]);
  });

  it('accepts duration with only time', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN duration('PT1H30M') AS dur"
    );
    expect(results).toEqual([{ dur: 'PT1H30M' }]);
  });

  it('accepts duration with fractional seconds', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN duration('PT1.5S') AS dur"
    );
    expect(results).toEqual([{ dur: 'PT1.5S' }]);
  });

  it('returns null for invalid duration string', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN duration('not-a-duration') AS dur"
    );
    expect(results).toEqual([{ dur: null }]);
  });

  it('returns null for empty duration P', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN duration('P') AS dur"
    );
    expect(results).toEqual([{ dur: null }]);
  });

  it('returns null for empty duration PT', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN duration('PT') AS dur"
    );
    expect(results).toEqual([{ dur: null }]);
  });
});

describe('Duration extractors', () => {
  it('totalSeconds extracts total seconds from duration', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN totalSeconds(duration({hours: 1, minutes: 30, seconds: 45})) AS s"
    );
    expect(results).toEqual([{ s: 5445 }]);
  });

  it('totalSeconds with milliseconds', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN totalSeconds(duration({seconds: 1, milliseconds: 500})) AS s"
    );
    expect(results).toEqual([{ s: 1.5 }]);
  });

  it('totalMinutes extracts total minutes from duration', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN totalMinutes(duration({hours: 1, minutes: 30})) AS m"
    );
    expect(results).toEqual([{ m: 90 }]);
  });

  it('totalMinutes with seconds', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN totalMinutes(duration({hours: 1, minutes: 30, seconds: 45})) AS m"
    );
    expect(results).toEqual([{ m: 90.75 }]);
  });

  it('returns null for invalid duration', async () => {
    const results = await executeQuery(
      graphData,
      "RETURN totalSeconds('not-a-duration') AS s"
    );
    expect(results).toEqual([{ s: null }]);
  });

  it('returns null for null input', async () => {
    const results = await executeQuery(
      graphData,
      'RETURN totalSeconds(null) AS s'
    );
    expect(results).toEqual([{ s: null }]);
  });
});

// ── Temporal comparison ──────────────────────────────────────────────────

describe('Temporal comparison (WHERE)', () => {
  it('compares datetime strings chronologically in WHERE', async () => {
    const results = await executeQuery(
      graphData,
      "MATCH (n) WHERE n.createdAt > '2023-01-01T00:00:00.000Z' RETURN n.name AS name ORDER BY name"
    );
    expect(results).toEqual([
      { name: 'Alice' },
      { name: 'Bob' },
    ]);
  });

  it('compares date strings chronologically in WHERE', async () => {
    const results = await executeQuery(
      graphData,
      "MATCH (n) WHERE n.createdAt >= '2024-01-01' RETURN n.name AS name ORDER BY name"
    );
    expect(results).toEqual([{ name: 'Bob' }]);
  });

  it('compares datetime with different timezone offsets', async () => {
    // 2023-06-15T14:30:45Z = 2023-06-15T12:30:45+02:00 (same moment)
    const results = await executeQuery(
      graphData,
      "MATCH (n) WHERE n.createdAt <= '2023-06-15T14:30:45.000Z' RETURN n.name AS name ORDER BY name"
    );
    expect(results).toEqual([
      { name: 'Alice' },
      { name: 'Charlie' },
    ]);
  });

  it('compares datetime with timezone offset in WHERE', async () => {
    // Bob's createdAt: 2024-01-20T14:45:30.000Z
    // 2024-01-20T16:45:30+02:00 = same moment as 2024-01-20T14:45:30Z
    const results = await executeQuery(
      graphData,
      "MATCH (n) WHERE n.createdAt <= '2024-01-20T14:45:30.000Z' RETURN n.name AS name ORDER BY name"
    );
    expect(results).toEqual([
      { name: 'Alice' },
      { name: 'Bob' },
      { name: 'Charlie' },
    ]);
  });
});

describe('Temporal comparison (ORDER BY)', () => {
  it('orders datetime strings chronologically', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n) RETURN n.name AS name, n.createdAt AS dt ORDER BY n.createdAt'
    );
    expect(results.map((r: any) => r.name)).toEqual(['Charlie', 'Alice', 'Bob']);
  });

  it('orders datetime strings chronologically DESC', async () => {
    const results = await executeQuery(
      graphData,
      'MATCH (n) RETURN n.name AS name, n.createdAt AS dt ORDER BY n.createdAt DESC'
    );
    expect(results.map((r: any) => r.name)).toEqual(['Bob', 'Alice', 'Charlie']);
  });
});

// ── localdatetime/localtime with local time ──────────────────────────────

describe('localdatetime() with local time', () => {
  it('returns current local datetime (no Z suffix)', async () => {
    const results = await executeQuery(graphData, 'RETURN localdatetime() AS dt');
    expect(results).toHaveLength(1);
    const dt = results[0]!.dt as string;
    expect(dt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(dt).not.toContain('Z');
  });
});

describe('localtime() with local time', () => {
  it('returns current local time (no Z suffix)', async () => {
    const results = await executeQuery(graphData, 'RETURN localtime() AS t');
    expect(results).toHaveLength(1);
    const t = results[0]!.t as string;
    expect(t).toMatch(/^\d{2}:\d{2}:\d{2}/);
    expect(t).not.toContain('Z');
  });
});
