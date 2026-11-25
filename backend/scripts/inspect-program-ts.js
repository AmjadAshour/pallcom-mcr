/** Scan a capture composed of aligned 188-byte MPEG-TS packets. */
import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const size = 188;
export async function inspectTransport(file) {
  const pids = new Map();
  let tail = Buffer.alloc(0);
  let packets = 0, invalidHeaders = 0, transportErrors = 0, continuityErrors = 0;
  for await (const data of createReadStream(file)) {
    const bytes = Buffer.concat([tail, data]);
    const end = bytes.length - bytes.length % size;
    for (let offset = 0; offset < end; offset += size) {
      const packet = bytes.subarray(offset, offset + size);
      packets++;
      const flags = (packet[3] >> 4) & 3;
      const adaptation = (flags & 2) !== 0;
      const payload = (flags & 1) !== 0;
      const adaptationLength = adaptation ? packet[4] : 0;
      if (packet[0] !== 0x47 || !flags || (adaptation && (payload ? adaptationLength > 182 : adaptationLength !== 183))) {
        invalidHeaders++;
        continue;
      }
      const pid = ((packet[1] & 31) << 8) | packet[2];
      const counter = packet[3] & 15;
      const previous = pids.get(pid) ?? { packets:0, errors:0, counter:null, duplicate:false, payload:false };
      pids.set(pid, previous);
      previous.packets++;
      if (packet[1] & 0x80) {
        transportErrors++;
        previous.counter = null;
        continue;
      }
      if (pid === 0x1fff) continue;
      const discontinuity = adaptationLength > 0 && (packet[5] & 0x80);
      let duplicate = false;
      if (previous.counter !== null && !discontinuity) {
        const expected = (previous.counter + Number(payload)) & 15;
        if (counter !== expected) {
          duplicate = Boolean(payload && previous.payload && !previous.duplicate && counter === previous.counter &&
            previous.packet.equals(packet));
          if (!duplicate) { previous.errors++; continuityErrors++; }
        }
      }
      previous.counter = counter;
      previous.payload = payload;
      previous.duplicate = duplicate;
      previous.packet = payload ? Buffer.from(packet) : undefined;
    }
    tail = bytes.subarray(end);
  }
  const hasPat = (pids.get(0)?.packets ?? 0) > 0;
  return { packets, invalidHeaders, transportErrors, continuityErrors, trailingBytes:tail.length, hasPat,
    pids:[...pids].sort(([a], [b]) => a - b).map(([pid, row]) => ({ pid, packets:row.packets, continuityErrors:row.errors })) };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3) {
    console.error('Usage: node backend/scripts/inspect-program-ts.js <captured.ts>');
    process.exitCode = 2;
  } else {
    try {
      const report = await inspectTransport(process.argv[2]);
      console.log(JSON.stringify(report));
      if (!report.packets || !report.hasPat || report.invalidHeaders || report.transportErrors ||
        report.continuityErrors || report.trailingBytes) process.exitCode = 1;
    } catch (error) {
      console.error(error.message);
      process.exitCode = 2;
    }
  }
}
