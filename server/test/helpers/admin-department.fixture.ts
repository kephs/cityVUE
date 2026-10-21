import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type Driver,
  type DatabaseConnection,
  type CompiledQuery,
  type QueryResult,
  type TransactionSettings,
} from 'kysely';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import type { StaffAccess } from '../../src/auth/auth.types.js';
import type { DatabaseService } from '../../src/database/database.service.js';
export const departmentAccess: StaffAccess = {
  organizationId: '00000000-0000-4000-8000-000000000069',
  staffIdentityId: '00000000-0000-4000-8000-000000000070',
  tenantId: 'fictional-tenant',
  objectId: 'fictional-object',
  displayName: 'Fictional',
  scopes: [],
  permissions: ['admin.configuration.read'],
  departmentIds: [],
  divisionIds: [],
  development: false,
};
export const departmentFixture = {
  id: '00000000-0000-4000-8000-000000000071',
  name: 'Fictional Department',
  description: null,
  status: 'archived',
  displayOrder: 0,
  divisionCount: 2,
  categoryCount: 3,
};
/** Offline recording double: verifies generated SQL and transaction intent, not database execution. */
export class DepartmentRecordingDriver implements Driver, DatabaseConnection {
  queries: CompiledQuery[] = [];
  transactions: string[] = [];
  active = true;
  found = true;
  fail = false;
  async init() {
    /* No connection. */
  }
  async acquireConnection() {
    return this;
  }
  async releaseConnection() {
    /* No pool. */
  }
  async destroy() {
    /* No external resource. */
  }
  async beginTransaction(
    _connection: DatabaseConnection,
    settings: TransactionSettings,
  ) {
    this.transactions.push(`begin:${settings.isolationLevel ?? ''}`);
  }
  async commitTransaction() {
    this.transactions.push('commit');
  }
  async rollbackTransaction() {
    this.transactions.push('rollback');
  }
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    yield { rows: [] };
  }
  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    this.queries.push(query);
    if (this.fail) throw new Error('private database diagnostic');
    let rows: unknown[] = [];
    if (query.sql.includes('from "organization"'))
      rows = this.active ? [{ id: departmentAccess.organizationId }] : [];
    else if (query.sql.startsWith('select count(*)')) rows = [{ total: 1 }];
    else if (query.sql.includes('from department r'))
      rows = this.found ? [departmentFixture] : [];
    else if (query.sql.includes('from division r'))
      rows = [
        {
          id: departmentFixture.id,
          name: 'Division',
          description: null,
          status: 'inactive',
          displayOrder: 0,
          departmentId: departmentFixture.id,
        },
      ];
    else if (query.sql.includes('from category r'))
      rows = [
        {
          id: departmentFixture.id,
          name: 'Category',
          description: '',
          status: 'active',
          displayOrder: 0,
          departmentId: departmentFixture.id,
          divisionId: null,
          iconKey: 'tree',
          serviceDefinitionCount: 2,
        },
      ];
    return { rows: rows as R[] };
  }
}
export function departmentTestDatabase(
  driver = new DepartmentRecordingDriver(),
) {
  const client = new Kysely<DatabaseSchema>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return { client, driver, database: { client } as DatabaseService };
}
