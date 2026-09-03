import assert from 'node:assert/strict';
import test from 'node:test';
import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from '../../src/config/configuration.js';
import type { DatabaseService } from '../../src/database/database.service.js';
import { GetServiceRequestDetailsService } from '../../src/service-request/get-service-request-details.service.js';
import type { ServiceRequestRepository } from '../../src/service-request/service-request.repository.js';

const id = '80000000-0000-4000-8000-000000000001';
const organizationId = '10000000-0000-4000-8000-000000000001';
const record = {
  request: {
    id,
    reference_number: 'SR-202609-000001',
    status: 'open',
    priority: 'medium',
    description: 'Synthetic description',
    reporting_identity: 'identified',
    revision: 1,
    created_at: new Date('2026-09-02T12:00:00Z'),
    updated_at: new Date('2026-09-02T12:00:00Z'),
    service_definition_id: '40000000-0000-4000-8000-000000000001',
    service_definition_version_id: '50000000-0000-4000-8000-000000000001',
    issue_name: 'Pothole',
    category_id: '30000000-0000-4000-8000-000000000001',
    category_name: 'Roads',
    department_id: '20000000-0000-4000-8000-000000000001',
    department_name: 'Public Works',
    division_id: null,
    division_name: null,
  },
  answers: [
    {
      question_id: '60000000-0000-4000-8000-000000000001',
      question_key: 'blocked',
      question_label: 'Historical blocked label',
      question_type: 'yes_no',
      display_order: 1,
      text_value: null,
      number_value: null,
      boolean_value: false,
      option_key: null,
      display_value: 'No',
    },
    {
      question_id: '60000000-0000-4000-8000-000000000002',
      question_key: 'condition',
      question_label: 'Historical condition label',
      question_type: 'single_select',
      display_order: 2,
      text_value: null,
      number_value: null,
      boolean_value: null,
      option_key: 'retired-key',
      display_value: 'Saved retired label',
    },
  ],
  contact: { name: 'Alex Example', email: 'resident@example.test' },
  location: {
    entered_address: '123 Test Street',
    location_type: 'entered_address',
    normalized_address: null,
    latitude: null,
    longitude: null,
    eligibility_result: null,
    validated_at: null,
  },
  activity: [
    {
      id: '90000000-0000-4000-8000-000000000001',
      activity_type: 'service_request_created',
      actor_type: 'identified_resident',
      occurred_at: new Date('2026-09-02T12:00:00Z'),
      metadata: { referenceNumber: 'SR-202609-000001', private: 'omitted' },
    },
  ],
};

function service(enabled = true, result: unknown = record) {
  const config = {
    get: (key: string) =>
      key === 'catalog.developmentOrganizationId' ? organizationId : enabled,
  } as unknown as ConfigService<AppConfiguration, true>;
  const database = {
    client: {
      transaction: () => ({
        execute: (callback: (trx: unknown) => unknown) => callback({}),
      }),
    },
  } as unknown as DatabaseService;
  const repository = {
    loadDetails: async (_trx: unknown, scope: string) => {
      assert.equal(scope, organizationId);
      return result;
    },
  } as unknown as ServiceRequestRepository;
  return new GetServiceRequestDetailsService(config, database, repository);
}

test('details service assembles snapshots, typed values, requester, location, and safe activity', async () => {
  const details = await service().execute(id);
  assert.equal(details.classification.department.name, 'Public Works');
  assert.equal(details.answers[0]?.value, false);
  assert.equal(details.answers[1]?.value, 'retired-key');
  assert.equal(details.answers[1].displayValue, 'Saved retired label');
  assert.deepEqual(details.requester, {
    anonymous: false,
    name: 'Alex Example',
    email: 'resident@example.test',
  });
  assert.equal(details.location?.enteredAddress, '123 Test Street');
  assert.deepEqual(details.activity[0]?.metadata, {
    referenceNumber: 'SR-202609-000001',
  });
});

test('details service fails closed when disabled, malformed, or unavailable', async () => {
  await assert.rejects(service(false).execute(id), NotFoundException);
  await assert.rejects(service().execute('bad'), NotFoundException);
  await assert.rejects(service(true, null).execute(id), NotFoundException);
});
