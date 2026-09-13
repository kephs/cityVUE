import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConfigService } from '@nestjs/config';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type { AppConfiguration } from '../../src/config/configuration.js';
import { EntraTokenService } from '../../src/auth/entra-token.service.js';

const tenant = '11111111-1111-4111-8111-111111111111';
const audience = 'api://22222222-2222-4222-8222-222222222222';
test('validates signed Entra claims and fails closed for invalid security claims', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  Object.assign(jwk, { kid: 'test-key', alg: 'RS256' });
  const config = {
    get: (key: string) =>
      key === 'entra.tenantId'
        ? tenant
        : key === 'entra.expectedAudience'
          ? audience
          : 'access_as_user',
  } as unknown as ConfigService<AppConfiguration, true>;
  const service = new EntraTokenService(config);
  (service as unknown as { jwks: ReturnType<typeof createLocalJWKSet> }).jwks =
    createLocalJWKSet({ keys: [jwk] });
  const issuer = `https://login.microsoftonline.com/${tenant}/v2.0`;
  const sign = (claims: Record<string, unknown> = {}) =>
    new SignJWT({
      tid: tenant,
      oid: '33333333-3333-4333-8333-333333333333',
      scp: 'access_as_user',
      name: 'Test Staff',
      ver: '2.0',
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
  await assert.rejects(
    service.validate(
      await new SignJWT({
        tid: tenant,
        oid: '33333333-3333-4333-8333-333333333333',
        scp: 'access_as_user',
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer(issuer)
        .setAudience(audience)
        .sign(privateKey),
    ),
  );
  const principal = await service.validate(await sign());
  assert.equal(principal.objectId, '33333333-3333-4333-8333-333333333333');
  assert.equal(service.hasRequiredScope(principal), true);
  assert.equal(service.hasRequiredScope({ ...principal, scopes: [] }), false);
  await assert.rejects(
    service.validate(
      await sign({ tid: '44444444-4444-4444-8444-444444444444' }),
    ),
  );
  await assert.rejects(
    service.validate(
      await new SignJWT({ tid: tenant, oid: 'x', scp: 'access_as_user' })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer('https://wrong')
        .setAudience(audience)
        .setExpirationTime('5m')
        .sign(privateKey),
    ),
  );
  await assert.rejects(
    service.validate(
      await new SignJWT({ tid: tenant, oid: 'x', scp: 'access_as_user' })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer(issuer)
        .setAudience('wrong')
        .setExpirationTime('5m')
        .sign(privateKey),
    ),
  );
  await assert.rejects(
    service.validate(
      await new SignJWT({ tid: tenant, oid: 'x', scp: 'access_as_user' })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer(issuer)
        .setAudience(audience)
        .setExpirationTime('0s')
        .sign(privateKey),
    ),
  );
  await assert.rejects(
    service.validate(
      await new SignJWT({ tid: tenant, oid: 'x', scp: 'access_as_user' })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer(issuer)
        .setAudience(audience)
        .setNotBefore('5m')
        .setExpirationTime('10m')
        .sign(privateKey),
    ),
  );
  await assert.rejects(service.validate(await sign({ oid: undefined })));
  const other = await generateKeyPair('RS256');
  await assert.rejects(
    service.validate(
      await new SignJWT({ tid: tenant, oid: 'x', scp: 'access_as_user' })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer(issuer)
        .setAudience(audience)
        .setExpirationTime('5m')
        .sign(other.privateKey),
    ),
  );
});
