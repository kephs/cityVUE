import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import type { DatabaseSchema } from '../database/database.types.js';

export const questionTypes = [
  'short_text',
  'long_text',
  'number',
  'yes_no',
  'single_select',
  'multi_select',
  'date',
  'information',
] as const;
export interface QuestionConfiguration {
  key: string;
  prompt: string;
  help: string;
  type: string;
  required: boolean;
  order: number;
  options: { key: string; label: string; order: number }[];
  condition: unknown;
  validation: unknown;
}
const invalid = () =>
  new BadRequestException({
    code: 'QUESTION_CONFIGURATION_INVALID',
    error: 'Bad Request',
  });
function text(value: unknown, limit: number, required = true): string {
  if (typeof value !== 'string') throw invalid();
  const clean = value.trim();
  if (
    (required && !clean) ||
    Array.from(clean).length > limit ||
    Array.from(clean).some(
      (c) => /\p{Cc}/u.test(c) && !['\n', '\r', '\t'].includes(c),
    )
  )
    throw invalid();
  return clean;
}
function order(value: unknown): number {
  if (
    !Number.isInteger(value) ||
    (value as number) < 0 ||
    (value as number) > 2147483647
  )
    throw invalid();
  return value as number;
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    throw invalid();
  return value as Record<string, unknown>;
}
export function validateQuestions(
  input: unknown,
  original: QuestionConfiguration[],
): QuestionConfiguration[] {
  if (
    !Array.isArray(input) ||
    input.length > 25 ||
    Buffer.byteLength(JSON.stringify(input), 'utf8') > 65536
  )
    throw invalid();
  const seen = new Set<string>(),
    orders = new Set<number>();
  let optionCount = 0;
  const result = input
    .map((raw) => {
      const q = record(raw, [
        'key',
        'prompt',
        'help',
        'type',
        'required',
        'order',
        'options',
      ]);
      const prior = original.find((x) => x.key === q.key);
      if (q.key !== null && !prior) throw invalid();
      const key = prior?.key ?? randomUUID();
      if (seen.has(key)) throw invalid();
      seen.add(key);
      if (
        !questionTypes.includes(q.type as (typeof questionTypes)[number]) ||
        (prior && q.type !== prior.type) ||
        typeof q.required !== 'boolean'
      )
        throw invalid();
      const position = order(q.order);
      if (orders.has(position)) throw invalid();
      orders.add(position);
      if (!Array.isArray(q.options)) throw invalid();
      if (
        q.type === 'single_select' || q.type === 'multi_select'
          ? q.options.length < 2 || q.options.length > 25
          : q.options.length !== 0
      )
        throw invalid();
      if (q.type === 'information' && (q.required || q.help !== ''))
        throw invalid();
      const labels = new Set<string>(),
        optionKeys = new Set<string>(),
        optionOrders = new Set<number>();
      const options = q.options
        .map((rawOption) => {
          const o = record(rawOption, ['key', 'label', 'order']);
          const old = prior?.options.find((x) => x.key === o.key);
          if (o.key !== null && !old) throw invalid();
          const optionKey = old?.key ?? randomUUID(),
            label = text(o.label, 100),
            position = order(o.order);
          if (
            optionKeys.has(optionKey) ||
            labels.has(label.toLowerCase()) ||
            optionOrders.has(position)
          )
            throw invalid();
          optionKeys.add(optionKey);
          labels.add(label.toLowerCase());
          optionOrders.add(position);
          optionCount++;
          return { key: optionKey, label, order: position };
        })
        .sort((a, b) => a.order - b.order);
      return {
        key,
        prompt: text(q.prompt, 200),
        help: text(q.help, 500, false),
        type: q.type as string,
        required: q.required,
        order: position,
        options,
        condition: prior?.condition ?? null,
        validation: prior?.validation ?? null,
      };
    })
    .sort((a, b) => a.order - b.order);
  if (
    optionCount > 200 ||
    Buffer.byteLength(JSON.stringify(result), 'utf8') > 65536
  )
    throw invalid();
  // Preserve all inherited rules. Removing a dependent is permitted; breaking its controller is not.
  for (const q of result) {
    if (!q.condition) continue;
    const c = q.condition as {
      questionKey: string;
      operator: string;
      value: unknown;
    };
    const controller = result.find((x) => x.key === c.questionKey);
    if (
      !controller ||
      ['multi_select', 'information'].includes(controller.type) ||
      c.operator !== 'equals' ||
      (controller.type === 'single_select' &&
        !controller.options.some((x) => x.key === c.value))
    )
      throw new BadRequestException({
        code: 'QUESTION_DEPENDENCY',
        error: 'Bad Request',
      });
  }
  return result;
}
export async function loadQuestions(
  trx: Transaction<DatabaseSchema>,
  org: string,
  version: string,
): Promise<QuestionConfiguration[]> {
  const questions = await trx
    .selectFrom('question')
    .selectAll()
    .where('organization_id', '=', org)
    .where('service_definition_version_id', '=', version)
    .where('status', '=', 'active')
    .orderBy('display_order')
    .execute();
  const options = questions.length
    ? await trx
        .selectFrom('question_option')
        .selectAll()
        .where('organization_id', '=', org)
        .where(
          'question_id',
          'in',
          questions.map((q) => q.id),
        )
        .where('status', '=', 'active')
        .orderBy('display_order')
        .execute()
    : [];
  return questions.map((q) => ({
    key: q.question_key,
    prompt: q.label,
    help: q.help_text ?? '',
    type: q.question_type,
    required: q.is_required,
    order: q.display_order,
    condition: q.visibility_condition,
    validation: q.validation_metadata,
    options: options
      .filter((o) => o.question_id === q.id)
      .map((o) => ({
        key: o.option_key,
        label: o.label,
        order: o.display_order,
      })),
  }));
}
export async function insertQuestions(
  trx: Transaction<DatabaseSchema>,
  org: string,
  version: string,
  questions: QuestionConfiguration[],
) {
  const rows = questions.map((q) => ({ id: randomUUID(), q }));
  if (!rows.length) return;
  await sql`insert into question(id,organization_id,service_definition_version_id,question_key,label,help_text,question_type,is_required,display_order,visibility_condition,validation_metadata,status)
    values ${sql.join(rows.map(({ id, q }) => sql`(${id},${org},${version},${q.key},${q.prompt},${q.help || null},${q.type},${q.required},${q.order},${q.condition === null ? null : JSON.stringify(q.condition)}::jsonb,${q.validation === null ? null : JSON.stringify(q.validation)}::jsonb,'active')`))}`.execute(
    trx,
  );
  const options = rows.flatMap(({ id, q }) =>
    q.options.map(
      (o) =>
        sql`(${randomUUID()},${org},${id},${o.key},${o.label},${o.order},'active')`,
    ),
  );
  if (options.length)
    await sql`insert into question_option(id,organization_id,question_id,option_key,label,display_order,status) values ${sql.join(options)}`.execute(
      trx,
    );
}
