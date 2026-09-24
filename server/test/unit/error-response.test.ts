import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { buildErrorResponse } from '../../src/common/errors/http-exception.filter.js';

test('unexpected errors are sanitized', () => {
  const error = new Error('password=secret SQL select private_data');

  assert.deepEqual(buildErrorResponse(error, 'request-1234'), {
    statusCode: 500,
    error: 'Internal Server Error',
    requestId: 'request-1234',
  });
});

test('HTTP errors retain only safe status metadata', () => {
  assert.deepEqual(
    buildErrorResponse(
      new BadRequestException('Invalid value'),
      'request-1234',
    ),
    {
      statusCode: 400,
      error: 'Bad Request',
      requestId: 'request-1234',
    },
  );
});
test('F056 duplicate response uses fixed safe text rather than supplied exception content', () => {
  const response = buildErrorResponse(
    new BadRequestException({
      code: 'ISSUE_DUPLICATE',
      error: 'Bad Request',
      message: 'private database detail',
    }),
    'request-1234',
  );
  assert.equal(response.message, 'An Issue with this name already exists.');
  assert.equal(response.code, 'ISSUE_DUPLICATE');
  assert.ok(!JSON.stringify(response).includes('private database detail'));
});
