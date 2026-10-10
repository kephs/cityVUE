import {
  isApprovedTelemetryExportRecord,
  type ApprovedTelemetryExportRecord,
  type TelemetryExportSink,
} from '../../src/observability/telemetry-export.js';

/** TEST ONLY. Fixed capacity, drop newest, no callbacks, timers or I/O. */
export const createTestTelemetryExportSink = (limit = 8) => {
  if (!Number.isInteger(limit) || limit < 1 || limit > 64)
    throw new RangeError('Invalid test capacity');
  const records: ApprovedTelemetryExportRecord[] = [];
  const sink: TelemetryExportSink = Object.freeze({
    accept: (record: ApprovedTelemetryExportRecord) => {
      if (!isApprovedTelemetryExportRecord(record))
        return { status: 'rejected', reason: 'privacy_policy' } as const;
      if (records.length === limit)
        return { status: 'dropped', reason: 'capacity' } as const;
      records.push(record);
      return { status: 'accepted', disposition: 'consumed' } as const;
    },
  });
  return Object.freeze({ sink, snapshot: () => Object.freeze([...records]) });
};
