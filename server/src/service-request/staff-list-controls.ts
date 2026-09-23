import { BadRequestException } from '@nestjs/common';
export const staffSortKeys = [
  'issue',
  'status',
  'department',
  'assignment',
  'created',
] as const;
export const staffSortDirections = ['asc', 'desc'] as const;
export const staffAssignmentFilters = [
  'all',
  'assigned',
  'unassigned',
] as const;
export interface StaffListControls {
  sort?: string;
  direction?: string;
  assignment?: string;
}
export function validateStaffListControls(filters: StaffListControls) {
  const sort = filters.sort ?? 'created';
  const direction = filters.direction ?? 'desc';
  const assignment = filters.assignment ?? 'all';
  if (
    !staffSortKeys.includes(sort as (typeof staffSortKeys)[number]) ||
    !staffSortDirections.includes(
      direction as (typeof staffSortDirections)[number],
    ) ||
    !staffAssignmentFilters.includes(
      assignment as (typeof staffAssignmentFilters)[number],
    )
  )
    throw new BadRequestException('Unsupported list controls');
  return { sort, direction: direction as 'asc' | 'desc', assignment };
}
