import { BadRequestException } from '@nestjs/common';
import { requestUuid } from '../service-request/staff-request-scope.js';

export type DepartmentStatus = 'active' | 'inactive' | 'archived';
export interface DepartmentRecord {
  id: string;
  name: string;
  description: string | null;
  status: DepartmentStatus;
  displayOrder: number;
}
export interface DepartmentSummary extends DepartmentRecord {
  divisionCount: number;
  categoryCount: number;
}
export interface DivisionSummary extends DepartmentRecord {
  departmentId: string;
}
export interface CategorySummary extends DepartmentRecord {
  departmentId: string;
  divisionId: string | null;
  iconKey: string;
  serviceDefinitionCount: number;
}
export interface DepartmentPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export function departmentQuery(input: Record<string, unknown>) {
  const invalid = () => new BadRequestException('Invalid Department query');
  const keys = ['page', 'pageSize', 'search', 'status', 'sort', 'direction'];
  for (const [key, value] of Object.entries(input)) {
    if (!keys.includes(key) || typeof value !== 'string') throw invalid();
  }
  const choice = <T extends string>(
    key: string,
    fallback: T,
    values: readonly T[],
  ): T => {
    const value = input[key];
    if (value === undefined) return fallback;
    const found = values.find((v) => v === value);
    if (found === undefined) throw invalid();
    return found;
  };
  const integer = (key: string, fallback: number, max: number) => {
    const value = input[key];
    if (value === undefined) return fallback;
    if (
      typeof value !== 'string' ||
      !/^[1-9][0-9]{0,4}$/.test(value) ||
      Number(value) > max
    )
      throw invalid();
    return Number(value);
  };
  const raw = input.search ?? '';
  if (
    typeof raw !== 'string' ||
    raw.length > 100 ||
    Array.from(raw).some((c) => {
      const code = c.charCodeAt(0);
      return (
        code < 32 ||
        (code >= 127 && code <= 159) ||
        (code >= 0xd800 && code <= 0xdfff && c.length === 1)
      );
    })
  )
    throw invalid();
  const pageSize = integer('pageSize', 25, 100);
  if (![10, 25, 50, 100].includes(pageSize)) throw invalid();
  return {
    page: integer('page', 1, 10000),
    pageSize,
    search: raw.trim(),
    status: choice('status', 'all', [
      'all',
      'active',
      'inactive',
      'archived',
    ] as const),
    sort: choice('sort', 'displayOrder', [
      'name',
      'displayOrder',
      'status',
    ] as const),
    direction: choice('direction', 'asc', ['asc', 'desc'] as const),
  };
}
export function departmentId(value: string): string {
  if (!requestUuid.test(value))
    throw new BadRequestException('Invalid Department identifier');
  return value;
}
export function emptyDepartmentQuery(query: Record<string, unknown>): void {
  if (Object.keys(query).length)
    throw new BadRequestException('Invalid Department query');
}
