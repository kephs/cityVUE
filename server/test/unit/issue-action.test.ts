import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { approvedDestination } from '../../src/catalog/issue-action.domain.js';
for (const value of [
  'https://example.com/service',
  'https://sub.example.com/path?allowed=value',
  'https://EXAMPLE.com:443/service',
])
  test(`HTTPS destination accepts ${value}`, () => {
    assert.equal(new URL(approvedDestination(value)).protocol, 'https:');
  });
for (const value of [
  'javascript:alert(1)',
  'data:text/html,test',
  'file:///etc/passwd',
  'vbscript:msgbox(1)',
  '//example.com',
  'relative/path',
  'http://example.com/service',
  'malformed URL',
  'https://user:password@example.com/service',
  'https://@example.com/service',
  ' https://example.com',
  'https://example.com ',
  'https://example.com/%0a',
  'https://example.com/\n',
  'https://example.com/\t',
  'https://example.com/\\evil',
  'https://',
  'https:///example.com',
])
  test(`unsafe destination rejects ${JSON.stringify(value)}`, () => {
    assert.throws(() => approvedDestination(value), BadRequestException);
  });
