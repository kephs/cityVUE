import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { StaffRequestListQueryDto } from '../../src/service-request/staff-request.controller.js';
import {
  validateStaffListControls,
  staffSortKeys,
} from '../../src/service-request/staff-list-controls.js';

test('staff list controls default to created descending and all assignments', () => {
  assert.deepEqual(validateStaffListControls({}), {
    sort: 'created',
    direction: 'desc',
    assignment: 'all',
  });
});
test('staff list controls accept only fixed sorting and assignment enums', () => {
  for (const sort of staffSortKeys)
    for (const direction of ['asc', 'desc'])
      for (const assignment of ['all', 'assigned', 'unassigned']) {
        const input = { sort, direction, assignment };
        assert.equal(
          validateSync(plainToInstance(StaffRequestListQueryDto, input)).length,
          0,
        );
        assert.deepEqual(validateStaffListControls(input), input);
      }
  for (const input of [
    { sort: 'request.secret' },
    { sort: 'created; drop table service_request' },
    { direction: 'ascending' },
    { direction: 'desc nulls first' },
    { assignment: 'watching' },
    { assignment: '' },
  ]) {
    assert.ok(
      validateSync(plainToInstance(StaffRequestListQueryDto, input)).length,
    );
    assert.throws(() => validateStaffListControls(input));
  }
});
