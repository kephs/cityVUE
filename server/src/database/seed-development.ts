import 'reflect-metadata';
import process from 'node:process';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { validateEnvironment } from '../config/environment.js';
import type { DatabaseSchema } from './database.types.js';

const organizationId = '10000000-0000-4000-8000-000000000001';
const departments = [
  ['20000000-0000-4000-8000-000000000001', 'Public Works'],
  ['20000000-0000-4000-8000-000000000002', 'Environmental Services'],
  ['20000000-0000-4000-8000-000000000003', 'Community Services'],
] as const;
const categories = [
  [
    '30000000-0000-4000-8000-000000000001',
    departments[0][0],
    'Roads & Streets',
    'Road surfaces, signs, and street conditions.',
    'signpost-split',
    1,
  ],
  [
    '30000000-0000-4000-8000-000000000002',
    departments[0][0],
    'Streetlights',
    'Public streetlight outages and damage.',
    'lightbulb',
    2,
  ],
  [
    '30000000-0000-4000-8000-000000000003',
    departments[0][0],
    'Water & Drainage',
    'Leaks, drainage, and standing water concerns.',
    'droplet',
    3,
  ],
  [
    '30000000-0000-4000-8000-000000000004',
    departments[1][0],
    'Trash & Recycling',
    'Collection, containers, and public litter.',
    'recycle',
    4,
  ],
  [
    '30000000-0000-4000-8000-000000000005',
    departments[2][0],
    'Trees & Landscaping',
    'Public trees and maintained landscape areas.',
    'tree',
    5,
  ],
] as const;
const services = [
  {
    n: 1,
    key: 'pothole',
    category: categories[0][0],
    name: 'Pothole',
    description: 'Report a hole or broken pavement in a public roadway.',
    icon: 'cone-striped',
    priority: 'medium',
    anonymous: 'allowed',
    keywords: ['pavement damage', 'street damage', 'broken asphalt'],
    aliases: ['hole in road', 'road hole', 'crater'],
    questions: [
      {
        key: 'approximateSize',
        label: 'Approximate size in feet',
        help: 'An estimate is fine.',
        type: 'number',
        required: false,
      },
      {
        key: 'roadBlocked',
        label: 'Is the roadway blocked?',
        type: 'yes_no',
        required: true,
      },
      {
        key: 'blockageDetails',
        label: 'Describe how the roadway is blocked',
        type: 'long_text',
        required: true,
        visibility: {
          questionKey: 'roadBlocked',
          operator: 'equals',
          value: 'yes',
        },
      },
    ],
  },
  {
    n: 2,
    key: 'damaged-sign',
    category: categories[0][0],
    name: 'Damaged Street Sign',
    description: 'Report a damaged, missing, or unreadable public street sign.',
    icon: 'signpost-split',
    priority: 'medium',
    anonymous: 'allowed',
    keywords: ['traffic sign', 'missing sign'],
    aliases: ['bent sign', 'sign down'],
    questions: [
      {
        key: 'signCondition',
        label: 'What is wrong with the sign?',
        type: 'single_select',
        required: true,
        options: [
          ['damaged', 'Damaged'],
          ['missing', 'Missing'],
          ['unreadable', 'Unreadable'],
        ],
      },
    ],
  },
  {
    n: 3,
    key: 'streetlight-out',
    category: categories[1][0],
    name: 'Streetlight Out',
    description: 'Report a public streetlight that is dark or malfunctioning.',
    icon: 'lightbulb',
    priority: 'medium',
    anonymous: 'allowed',
    keywords: ['lamp', 'lighting', 'dark street'],
    aliases: ['light out', 'broken lamp', 'flickering light'],
    questions: [
      {
        key: 'poleNumber',
        label: 'Pole or asset number',
        help: 'If visible on the pole.',
        type: 'short_text',
        required: false,
      },
      {
        key: 'lightBehavior',
        label: 'What is the light doing?',
        type: 'single_select',
        required: true,
        options: [
          ['out', 'Completely out'],
          ['flickering', 'Flickering'],
          ['daytime', 'On during daylight'],
        ],
      },
    ],
  },
  {
    n: 4,
    key: 'drainage',
    category: categories[2][0],
    name: 'Drainage Concern',
    description: 'Report standing water or a blocked public drain.',
    icon: 'water',
    priority: 'high',
    anonymous: 'allowed',
    keywords: ['flooding', 'storm drain', 'standing water'],
    aliases: ['clogged drain', 'water pooling'],
    questions: [
      {
        key: 'drainageDetails',
        label: 'Describe the water or drainage condition',
        type: 'long_text',
        required: true,
      },
    ],
  },
  {
    n: 5,
    key: 'missed-collection',
    category: categories[3][0],
    name: 'Missed Collection',
    description: 'Report eligible trash or recycling that was not collected.',
    icon: 'trash3',
    priority: 'low',
    anonymous: 'not_allowed',
    keywords: ['garbage', 'recycling', 'pickup'],
    aliases: ['trash not picked up', 'missed pickup'],
    questions: [
      {
        key: 'collectionType',
        label: 'Which collection was missed?',
        type: 'single_select',
        required: true,
        options: [
          ['trash', 'Trash'],
          ['recycling', 'Recycling'],
          ['yard', 'Yard materials'],
        ],
      },
      {
        key: 'containerCount',
        label: 'Number of containers',
        type: 'number',
        required: true,
      },
    ],
  },
  {
    n: 6,
    key: 'fallen-tree',
    category: categories[4][0],
    name: 'Fallen Tree or Branch',
    description: 'Report a fallen public tree or branch in a public area.',
    icon: 'tree',
    priority: 'high',
    anonymous: 'allowed',
    keywords: ['tree damage', 'branch', 'limb'],
    aliases: ['tree down', 'fallen limb'],
    questions: [
      {
        key: 'publicAccessBlocked',
        label: 'Is public access blocked?',
        type: 'yes_no',
        required: true,
      },
      {
        key: 'affectedArea',
        label: 'Which area is affected?',
        type: 'single_select',
        required: true,
        options: [
          ['sidewalk', 'Sidewalk'],
          ['road', 'Roadway'],
          ['park', 'Park or trail'],
          ['other', 'Other public area'],
        ],
      },
    ],
  },
] as const;

async function seed(db: Kysely<DatabaseSchema>): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('organization')
      .values({
        id: organizationId,
        name: 'CityVUE Development Municipality',
        short_name: 'Development',
        slug: 'cityvue-development',
        status: 'active',
        default_business_timezone: 'America/New_York',
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
    await trx
      .insertInto('department')
      .values(
        departments.map(([id, name], display_order) => ({
          id,
          organization_id: organizationId,
          name,
          description:
            'Sample development department; not official City configuration.',
          status: 'active',
          display_order,
        })),
      )
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
    await trx
      .insertInto('category')
      .values(
        categories.map(
          ([
            id,
            department_id,
            name,
            description,
            icon_key,
            display_order,
          ]) => ({
            id,
            organization_id: organizationId,
            department_id,
            division_id: null,
            name,
            description,
            icon_key,
            aliases: [],
            keywords: [],
            status: 'active',
            display_order,
          }),
        ),
      )
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
    for (const service of services) {
      const suffix = String(service.n).padStart(12, '0');
      const serviceId = `40000000-0000-4000-8000-${suffix}`;
      const versionId = `50000000-0000-4000-8000-${suffix}`;
      await trx
        .insertInto('service_definition')
        .values({
          id: serviceId,
          organization_id: organizationId,
          category_id: service.category,
          service_key: service.key,
          status: 'active',
          current_published_version_id: null,
        })
        .onConflict((oc) => oc.column('id').doNothing())
        .execute();
      await trx
        .insertInto('service_definition_version')
        .values({
          id: versionId,
          organization_id: organizationId,
          service_definition_id: serviceId,
          version_number: 1,
          name: service.name,
          resident_description: service.description,
          icon_key: service.icon,
          aliases: [...service.aliases],
          keywords: [...service.keywords],
          default_priority: service.priority,
          location_policy: 'required',
          geographic_eligibility_mode: 'no_geographic_restriction',
          anonymous_reporting_policy: service.anonymous,
          status: 'published',
          published_at: new Date('2026-09-02T00:00:00Z'),
          routing_metadata: null,
        })
        .onConflict((oc) => oc.column('id').doNothing())
        .execute();
      await trx
        .updateTable('service_definition')
        .set({ current_published_version_id: versionId })
        .where('id', '=', serviceId)
        .where('current_published_version_id', 'is', null)
        .execute();
      for (const [index, question] of service.questions.entries()) {
        const qid = `60000000-0000-4${String(service.n).padStart(3, '0')}-8000-${String(index + 1).padStart(12, '0')}`;
        await trx
          .insertInto('question')
          .values({
            id: qid,
            organization_id: organizationId,
            service_definition_version_id: versionId,
            question_key: question.key,
            label: question.label,
            help_text: 'help' in question ? question.help : null,
            question_type: question.type,
            is_required: question.required,
            display_order: index + 1,
            validation_metadata: null,
            visibility_condition:
              'visibility' in question ? question.visibility : null,
            status: 'active',
          })
          .onConflict((oc) => oc.column('id').doNothing())
          .execute();
        if ('options' in question)
          for (const [optionIndex, option] of question.options.entries()) {
            const oid = `70000000-0000-4${String(service.n).padStart(3, '0')}-${String(index + 1).padStart(4, '0')}-${String(optionIndex + 1).padStart(12, '0')}`;
            await trx
              .insertInto('question_option')
              .values({
                id: oid,
                organization_id: organizationId,
                question_id: qid,
                option_key: option[0],
                label: option[1],
                display_order: optionIndex + 1,
                status: 'active',
              })
              .onConflict((oc) => oc.column('id').doNothing())
              .execute();
          }
      }
    }
  });
}

const environment = validateEnvironment(process.env);
const db = new Kysely<DatabaseSchema>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: environment.DATABASE_URL }),
  }),
});
seed(db)
  .then(() => process.stdout.write('Development catalog seed complete.\n'))
  .finally(() => db.destroy())
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Seed failed'}\n`,
    );
    process.exitCode = 1;
  });
