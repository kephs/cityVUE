param location string
param namingPrefix string
param environmentId string
param frontendFqdn string

resource profile 'Microsoft.Cdn/profiles@2025-04-15' = {
  name: '${namingPrefix}-frontend-afd'
  location: 'global'
  sku: {
    name: 'Premium_AzureFrontDoor'
  }
}

resource endpoint 'Microsoft.Cdn/profiles/afdEndpoints@2025-04-15' = {
  parent: profile
  name: '${namingPrefix}-frontend-edge'
  location: 'global'
  properties: {
    enabledState: 'Disabled'
  }
}

resource originGroup 'Microsoft.Cdn/profiles/originGroups@2025-04-15' = {
  parent: profile
  name: 'frontend'
  properties: {
    // Single origin: no invented probe timing or balancing numbers.
    sessionAffinityState: 'Disabled'
  }
}

resource origin 'Microsoft.Cdn/profiles/originGroups/origins@2025-04-15' = {
  parent: originGroup
  name: 'frontend'
  properties: {
    hostName: frontendFqdn
    originHostHeader: frontendFqdn
    httpsPort: 443
    enforceCertificateNameCheck: true
    enabledState: 'Disabled'
    sharedPrivateLinkResource: {
      privateLink: {
        id: environmentId
      }
      groupId: 'managedEnvironments'
      privateLinkLocation: location
      requestMessage: 'Reqro frontend: authorized operator review required.'
      // Never set status Approved; operator must verify the actual AFD request.
    }
  }
}

resource route 'Microsoft.Cdn/profiles/afdEndpoints/routes@2025-04-15' = {
  parent: endpoint
  name: 'frontend'
  properties: {
    enabledState: 'Disabled'
    linkToDefaultDomain: 'Disabled'
    forwardingProtocol: 'HttpsOnly'
    supportedProtocols: [
      'Https'
    ]
    httpsRedirect: 'Disabled'
    originGroup: {
      id: originGroup.id
    }
    // Bounded foundation, not a full production route/asset inventory.
    // No /* or /api pattern: API cannot be assigned to the static origin.
    patternsToMatch: [
      '/'
      '/index.html'
      '/redirect.html'
      '/assets/*'
      '/staff'
      '/staff/*'
      '/admin'
      '/admin/*'
      '/map-preview'
      '/track'
      '/report'
      '/issues'
      '/issues/*'
      '/dashboard'
    ]
    // Omit cacheConfiguration: edge caching is disabled by this schema.
    // WAF, approved custom domains and API routing are pre-deployment blockers.
  }
  dependsOn: [
    origin
  ]
}
