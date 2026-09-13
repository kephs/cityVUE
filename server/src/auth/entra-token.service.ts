import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { AppConfiguration } from '../config/configuration.js';

export interface EntraPrincipal {
  tenantId: string;
  objectId: string;
  name: string;
  preferredUsername?: string;
  scopes: string[];
  tokenVersion: string;
}

@Injectable()
export class EntraTokenService {
  private readonly tenantId?: string;
  private readonly audience?: string;
  private readonly requiredScope: string;
  private readonly issuer?: string;
  private readonly jwks?: ReturnType<typeof createRemoteJWKSet>;
  constructor(config: ConfigService<AppConfiguration, true>) {
    this.tenantId = config.get('entra.tenantId', { infer: true });
    this.audience = config.get('entra.expectedAudience', { infer: true });
    this.requiredScope = config.get('entra.requiredScope', { infer: true });
    if (this.tenantId) {
      const authority = `https://login.microsoftonline.com/${this.tenantId}`;
      this.issuer = `${authority}/v2.0`;
      this.jwks = createRemoteJWKSet(
        new URL(`${authority}/discovery/v2.0/keys`),
      );
    }
  }
  get enabled(): boolean {
    return Boolean(this.tenantId && this.audience && this.jwks);
  }
  async validate(token: string): Promise<EntraPrincipal> {
    if (
      !this.enabled ||
      !this.jwks ||
      !this.issuer ||
      !this.audience ||
      !this.tenantId
    )
      throw new UnauthorizedException();
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: this.audience,
        requiredClaims: ['exp'],
      }));
    } catch {
      throw new UnauthorizedException('Invalid bearer token');
    }
    const tid = typeof payload.tid === 'string' ? payload.tid : '';
    const oid = typeof payload.oid === 'string' ? payload.oid : '';
    if (tid !== this.tenantId || !oid)
      throw new UnauthorizedException('Invalid bearer token');
    const scopes =
      typeof payload.scp === 'string'
        ? payload.scp.split(' ').filter(Boolean)
        : [];
    return {
      tenantId: tid,
      objectId: oid,
      name: typeof payload.name === 'string' ? payload.name : 'CityVUE staff',
      ...(typeof payload.preferred_username === 'string'
        ? { preferredUsername: payload.preferred_username }
        : {}),
      scopes,
      tokenVersion: typeof payload.ver === 'string' ? payload.ver : '2.0',
    };
  }
  hasRequiredScope(principal: EntraPrincipal): boolean {
    return principal.scopes.includes(this.requiredScope);
  }
}
