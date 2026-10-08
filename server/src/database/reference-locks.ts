import { sql, type Kysely, type Transaction } from 'kysely';
import type { DatabaseSchema } from './database.types.js';

/**
 * ADR-027 F060.3C-2d. Row locks on reference tables the runtime only reads.
 *
 * PostgreSQL requires UPDATE privilege on at least one column of a row-locked
 * table, so `SELECT ... FOR SHARE` on a Category, Department, Division, staff
 * identity, operational role or work group demanded write authority the
 * runtime application must not hold. None of those tables carries an
 * immutability trigger, so no column on them is independently inert and a
 * column-scoped grant would confer a real mutation. Migration 49 therefore
 * moves each lock into an owner-owned `SECURITY DEFINER` helper that returns
 * only a boolean.
 *
 * **Each helper preserves exactly the predicate its caller already relied on.**
 * The `lock*Active*` variants carry the status requirement their call sites
 * already enforced; `lockDepartment` and `lockDivision` carry existence only,
 * because their call sites apply no status predicate and adding one would be a
 * new business rule.
 *
 * Category has no existence-only helper. It is locked at sixteen runtime
 * sites, thirteen of them through Kysely's OF-alias form where the Category
 * row is locked atomically alongside the Service Request and the Organization.
 * Those are deliberately left native, so the runtime holds a column-scoped
 * `UPDATE (id)` on Category purely to satisfy row locking, made inert by the
 * Migration 49 `protect_category_identity` invariant. Only the atomic
 * Category + Department active lock is routed through a helper here.
 *
 * **Ordering contract.** Acquire the lock first, then read the business
 * values with an ordinary `SELECT`. Row locks are scoped to the transaction
 * rather than to the function call, so the subsequent read observes the row
 * the helper pinned — the same property F060.3C-2c-2 relied on for the
 * Organization lock.
 *
 * The calls are deliberately unqualified. The test and runtime architecture
 * supports isolated schemas, and `pg_temp` is never consulted for function or
 * operator names, so an unqualified call cannot be redirected there.
 * Qualification belongs inside the function bodies, where relation and
 * composite-type shadowing is possible.
 */
type Db = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;

async function verdict(
  db: Db,
  statement: ReturnType<typeof sql<{ locked: boolean }>>,
): Promise<boolean> {
  const result = await statement.execute(db);
  return result.rows[0]?.locked === true;
}

/** Locks a Category and its Department, requiring both to be active. One
 * statement, because the existing caller locked both together and required
 * both active; splitting it would add a read-then-lock window. */
export function lockActiveCategory(
  db: Db,
  organizationId: string,
  categoryId: string,
): Promise<boolean> {
  return verdict(
    db,
    sql<{
      locked: boolean;
    }>`select lock_active_category(${organizationId}::uuid, ${categoryId}::uuid) as locked`,
  );
}

/** Locks an active Department. */
export function lockActiveDepartment(
  db: Db,
  organizationId: string,
  departmentId: string,
): Promise<boolean> {
  return verdict(
    db,
    sql<{
      locked: boolean;
    }>`select lock_active_department(${organizationId}::uuid, ${departmentId}::uuid) as locked`,
  );
}

/** Locks a Department by Organization and identifier. No status predicate. */
export function lockDepartment(
  db: Db,
  organizationId: string,
  departmentId: string,
): Promise<boolean> {
  return verdict(
    db,
    sql<{
      locked: boolean;
    }>`select lock_department(${organizationId}::uuid, ${departmentId}::uuid) as locked`,
  );
}

/** Locks an active Division within its Department. */
export function lockActiveDivision(
  db: Db,
  organizationId: string,
  departmentId: string,
  divisionId: string,
): Promise<boolean> {
  return verdict(
    db,
    sql<{
      locked: boolean;
    }>`select lock_active_division(${organizationId}::uuid, ${departmentId}::uuid, ${divisionId}::uuid) as locked`,
  );
}

/** Locks a Division within its Department. No status predicate. */
export function lockDivision(
  db: Db,
  organizationId: string,
  departmentId: string,
  divisionId: string,
): Promise<boolean> {
  return verdict(
    db,
    sql<{
      locked: boolean;
    }>`select lock_division(${organizationId}::uuid, ${departmentId}::uuid, ${divisionId}::uuid) as locked`,
  );
}

/** Locks an active staff identity. All three call sites required `active`. */
export function lockStaff(
  db: Db,
  organizationId: string,
  staffIdentityId: string,
): Promise<boolean> {
  return verdict(
    db,
    sql<{
      locked: boolean;
    }>`select lock_staff(${organizationId}::uuid, ${staffIdentityId}::uuid) as locked`,
  );
}

/** Locks one assignment principal. The helper dispatches over the closed
 * `TargetType` union with a static branch per literal table; an unrecognised
 * type raises inside the database rather than returning false, so a typo can
 * never be read as "target unavailable". Existence only, because neither call
 * site applies a status predicate. */
export function lockAssignmentTarget(
  db: Db,
  organizationId: string,
  targetType: 'staff' | 'role' | 'group',
  targetId: string,
): Promise<boolean> {
  return verdict(
    db,
    sql<{
      locked: boolean;
    }>`select lock_assignment_target(${organizationId}::uuid, ${targetType}::varchar, ${targetId}::uuid) as locked`,
  );
}
