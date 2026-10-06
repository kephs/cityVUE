import assert from 'node:assert/strict';
import test from 'node:test';
import {
  observeVerification,
  type DnsPort,
  type DnssecObservation,
  type ServerAnswer,
} from '../../src/tenancy/tenant-domain-verifier.js';
import {
  challengeHash,
  challengeValue,
} from '../../src/tenancy/tenant-domain-challenge.js';

const EXPECTED = challengeValue('a'.repeat(43));
const OTHER = challengeValue('b'.repeat(43));
const RECORD = '_reqro-verify.requests.example.gov';

function answer(
  values: string[],
  ttlSeconds: number | null = 300,
): ServerAnswer {
  return { kind: 'answer', answer: { values, ttlSeconds } };
}

/** Injected resolver. No network, no timers — the quorum rules are what is
 * under test, and they must be decidable from answers alone. */
function port(
  nameServers: string[],
  answers: Record<string, ServerAnswer>,
  dnssec?: (name: string) => Promise<DnssecObservation>,
): DnsPort {
  const base: DnsPort = {
    authoritativeNameServers: () => Promise.resolve(nameServers),
    txtAt: (server) =>
      Promise.resolve(answers[server] ?? { kind: 'unreachable' }),
  };
  return dnssec ? { ...base, dnssec } : base;
}

function observe(dns: DnsPort) {
  return observeVerification(dns, {
    recordName: RECORD,
    expectedValue: EXPECTED,
  });
}

test('two agreeing authoritative servers verify', async () => {
  const result = await observe(
    port(['ns1.example.gov', 'ns2.example.gov'], {
      'ns1.example.gov': answer([EXPECTED]),
      'ns2.example.gov': answer([EXPECTED]),
    }),
  );

  assert.equal(result.result, 'verified');
  assert.equal(result.agreementCount, 2);
  assert.equal(result.degradedSingleNs, false);
  assert.equal(result.observedValueHash, challengeHash(EXPECTED));
  assert.equal(result.expectedChallengeHash, challengeHash(EXPECTED));
  assert.deepEqual(result.nameServers, ['ns1.example.gov', 'ns2.example.gov']);
  assert.equal(result.ttlSeconds, 300);
});

test('server disagreement fails closed', async () => {
  const result = await observe(
    port(['ns1.example.gov', 'ns2.example.gov'], {
      'ns1.example.gov': answer([EXPECTED]),
      'ns2.example.gov': answer([OTHER]),
    }),
  );

  assert.equal(result.result, 'disagreement');
  assert.equal(result.observedValueHash, null);
  assert.equal(result.agreementCount, 0);
});

test('a zone mid-change where one server lacks the record fails closed', async () => {
  const result = await observe(
    port(['ns1.example.gov', 'ns2.example.gov'], {
      'ns1.example.gov': answer([EXPECTED]),
      'ns2.example.gov': { kind: 'absent' },
    }),
  );

  assert.equal(result.result, 'disagreement');
});

test('a multi-NS zone with only one reachable server never degrades to one', async () => {
  const result = await observe(
    port(['ns1.example.gov', 'ns2.example.gov'], {
      'ns1.example.gov': answer([EXPECTED]),
      'ns2.example.gov': { kind: 'timeout' },
    }),
  );

  assert.equal(result.result, 'insufficient_quorum');
  assert.equal(result.observedValueHash, null);
  assert.equal(result.degradedSingleNs, false);
});

test('a genuinely single-NS zone verifies as an explicitly recorded degraded case', async () => {
  const result = await observe(
    port(['ns1.example.gov'], { 'ns1.example.gov': answer([EXPECTED]) }),
  );

  assert.equal(result.result, 'verified');
  assert.equal(result.agreementCount, 1);
  assert.equal(result.degradedSingleNs, true);
});

test('three servers verify once two agree and none disagree', async () => {
  const result = await observe(
    port(['ns1.example.gov', 'ns2.example.gov', 'ns3.example.gov'], {
      'ns1.example.gov': answer([EXPECTED], 120),
      'ns2.example.gov': answer([EXPECTED], 600),
      'ns3.example.gov': { kind: 'unreachable' },
    }),
  );

  assert.equal(result.result, 'verified');
  assert.equal(result.agreementCount, 2);
  // The shortest observed TTL is recorded, not the longest.
  assert.equal(result.ttlSeconds, 120);
});

test('a missing record is distinguished from a wrong value', async () => {
  const absent = await observe(
    port(['ns1.example.gov', 'ns2.example.gov'], {
      'ns1.example.gov': { kind: 'absent' },
      'ns2.example.gov': { kind: 'absent' },
    }),
  );
  assert.equal(absent.result, 'no_record');

  const wrong = await observe(
    port(['ns1.example.gov', 'ns2.example.gov'], {
      'ns1.example.gov': answer([OTHER]),
      'ns2.example.gov': answer([OTHER]),
    }),
  );
  assert.equal(wrong.result, 'value_mismatch');
  assert.equal(wrong.observedValueCount, 1);
  assert.equal(wrong.observedValueHash, null);
});

test('a name holding several values verifies on an exact match', async () => {
  const result = await observe(
    port(['ns1.example.gov', 'ns2.example.gov'], {
      'ns1.example.gov': answer(['v=spf1 -all', OTHER, EXPECTED]),
      'ns2.example.gov': answer([EXPECTED, 'unrelated']),
    }),
  );

  assert.equal(result.result, 'verified');
  assert.equal(result.observedValueCount, 3);
});

test('NXDOMAIN, SERVFAIL, timeout and unreachable are each reported distinctly', async () => {
  const cases: [ServerAnswer['kind'], string][] = [
    ['nxdomain', 'nxdomain'],
    ['servfail', 'servfail'],
    ['timeout', 'timeout'],
    ['unreachable', 'unreachable'],
  ];
  for (const [kind, expected] of cases) {
    const result = await observe(
      port(['ns1.example.gov', 'ns2.example.gov'], {
        'ns1.example.gov': { kind } as ServerAnswer,
        'ns2.example.gov': { kind } as ServerAnswer,
      }),
    );
    assert.equal(result.result, expected, kind);
    assert.equal(result.observedValueHash, null);
  }
});

test('an undetermined zone fails closed rather than guessing', async () => {
  const result = await observe(port([], {}));

  assert.equal(result.result, 'zone_undetermined');
  assert.deepEqual(result.nameServers, []);
  assert.equal(result.agreementCount, 0);
});

test('subdomain delegation is followed to the delegated servers', async () => {
  // The delegation point is the subdomain, so its own servers answer.
  const delegated: DnsPort = {
    authoritativeNameServers: (name) => {
      assert.equal(name, RECORD);
      return Promise.resolve([
        'ns1.delegated.example.gov',
        'ns2.delegated.example.gov',
      ]);
    },
    txtAt: (server, name) => {
      assert.equal(name, RECORD);
      assert.match(server, /delegated\.example\.gov$/);
      return Promise.resolve(answer([EXPECTED]));
    },
  };
  const result = await observe(delegated);

  assert.equal(result.result, 'verified');
  assert.deepEqual(result.nameServers, [
    'ns1.delegated.example.gov',
    'ns2.delegated.example.gov',
  ]);
});

test('DNSSEC absent is recorded honestly and never claimed as validated', async () => {
  const result = await observe(
    port(['ns1.example.gov', 'ns2.example.gov'], {
      'ns1.example.gov': answer([EXPECTED]),
      'ns2.example.gov': answer([EXPECTED]),
    }),
  );

  assert.equal(result.result, 'verified');
  assert.equal(result.dnssec.observed, false);
  assert.equal(result.dnssec.validated, false);
  assert.match(result.dnssec.reason, /cannot_validate_dnssec/);
});

test('observable but unvalidated DNSSEC never upgrades the decision', async () => {
  const observed: DnssecObservation = {
    observed: true,
    validated: false,
    reason: 'zone_signed_ad_bit_not_cryptographically_verified',
  };
  // An unvalidated signal must not rescue a failing check...
  const failing = await observe(
    port(
      ['ns1.example.gov', 'ns2.example.gov'],
      {
        'ns1.example.gov': { kind: 'absent' },
        'ns2.example.gov': { kind: 'absent' },
      },
      () => Promise.resolve(observed),
    ),
  );
  assert.equal(failing.result, 'no_record');
  assert.equal(failing.dnssec.validated, false);

  // ...nor change a passing one beyond being recorded.
  const passing = await observe(
    port(
      ['ns1.example.gov', 'ns2.example.gov'],
      {
        'ns1.example.gov': answer([EXPECTED]),
        'ns2.example.gov': answer([EXPECTED]),
      },
      () => Promise.resolve(observed),
    ),
  );
  assert.equal(passing.result, 'verified');
  assert.equal(passing.dnssec.observed, true);
  assert.equal(passing.dnssec.validated, false);
});

test('duplicate name servers are collapsed before quorum is counted', async () => {
  const result = await observe(
    port(['ns1.example.gov', 'ns1.example.gov'], {
      'ns1.example.gov': answer([EXPECTED]),
    }),
  );

  // One distinct server cannot masquerade as two-server agreement.
  assert.deepEqual(result.nameServers, ['ns1.example.gov']);
  assert.equal(result.agreementCount, 1);
  assert.equal(result.degradedSingleNs, true);
});

test('the expected value is hashed into evidence on every outcome', async () => {
  for (const answers of [
    { 'ns1.example.gov': answer([EXPECTED]) },
    { 'ns1.example.gov': { kind: 'timeout' } as ServerAnswer },
  ]) {
    const result = await observe(port(['ns1.example.gov'], answers));
    assert.equal(result.expectedChallengeHash, challengeHash(EXPECTED));
    assert.equal(result.recordName, RECORD);
  }
});
