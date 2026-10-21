import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { StaffAccess } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';
import type { DatabaseSchema } from '../database/database.types.js';
import { assertConfigurationRead } from './admin-configuration.domain.js';
import {
  departmentId,
  departmentQuery,
  type DepartmentPage,
  type DepartmentSummary,
  type DivisionSummary,
  type CategorySummary,
} from './admin-department.domain.js';
import {
  departmentCollectionSql,
  departmentDetailSql,
  type DepartmentCollection,
} from './admin-department.queries.js';

@Injectable()
export class AdminDepartmentService {
  constructor(private readonly database: DatabaseService) {}
  private async snapshot<T>(
    access: StaffAccess | undefined,
    read: (trx: Transaction<DatabaseSchema>, org: string) => Promise<T>,
  ): Promise<T> {
    assertConfigurationRead(access);
    return this.database.client
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (trx) => {
        await sql`set transaction read only`.execute(trx);
        const organization = await trx
          .selectFrom('organization')
          .select('id')
          .where('id', '=', access.organizationId)
          .where('status', '=', 'active')
          .executeTakeFirst();
        if (!organization) throw new ForbiddenException('Access denied');
        return read(trx, access.organizationId);
      });
  }
  private async requireDepartment(
    trx: Transaction<DatabaseSchema>,
    org: string,
    id: string,
  ) {
    const record = (await departmentDetailSql(org, id).execute(trx)).rows[0];
    if (!record) throw new NotFoundException('Department not found');
    return record;
  }
  async detail(
    access: StaffAccess | undefined,
    id: string,
  ): Promise<DepartmentSummary> {
    assertConfigurationRead(access);
    departmentId(id);
    return this.snapshot(access, (trx, org) =>
      this.requireDepartment(trx, org, id),
    );
  }
  async list(
    access: StaffAccess | undefined,
    input: Record<string, unknown>,
    collection: DepartmentCollection = 'departments',
    id?: string,
  ): Promise<
    DepartmentPage<DepartmentSummary | DivisionSummary | CategorySummary>
  > {
    assertConfigurationRead(access);
    const query = departmentQuery(input);
    if (collection !== 'departments') departmentId(id ?? '');
    return this.snapshot(access, async (trx, org) => {
      if (collection !== 'departments')
        await this.requireDepartment(trx, org, id ?? '');
      const statements = departmentCollectionSql(org, collection, query, id);
      const total = (await statements.count.execute(trx)).rows[0]?.total ?? 0;
      const items = (await statements.items.execute(trx)).rows;
      return { items, total, page: query.page, pageSize: query.pageSize };
    });
  }
}
