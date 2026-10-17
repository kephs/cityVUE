param location string
param namingPrefix string
param infrastructureSubnetId string
param workloadProfileName string
param workloadProfileType string
param workloadProfileMinimumCount int
param workloadProfileMaximumCount int
param frontendCpu string
param frontendMemory string

@description('Published Reqro frontend digest: exactly 64 lowercase hex, without prefix; SBOM, scan, signature and publication gates must pass.')
@minLength(64)
@maxLength(64)
param frontendImageDigest string
param registryLoginServer string
param pullIdentityId string

resource environment 'Microsoft.App/managedEnvironments@2026-07-01' = {
  name: '${namingPrefix}-frontend-env'
  location: location
  properties: {
    publicNetworkAccess: 'Disabled'
    vnetConfiguration: {
      infrastructureSubnetId: infrastructureSubnetId
      internal: true
    }
    workloadProfiles: [
      {
        name: workloadProfileName
        workloadProfileType: workloadProfileType
        minimumCount: workloadProfileMinimumCount
        maximumCount: workloadProfileMaximumCount
      }
    ]
  }
}

resource frontend 'Microsoft.App/containerApps@2025-01-01' = {
  name: '${namingPrefix}-frontend'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${pullIdentityId}': {}
    }
  }
  properties: {
    environmentId: environment.id
    workloadProfileName: workloadProfileName
    configuration: {
      registries: [
        {
          server: registryLoginServer
          identity: pullIdentityId
        }
      ]
      identitySettings: [
        {
          identity: pullIdentityId
          lifecycle: 'None'
        }
      ]
      ingress: {
        // External to this INTERNAL environment, never public environment access.
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
    }
    template: {
      containers: [
        {
          name: 'frontend'
          image: '${registryLoginServer}/reqro/frontend@sha256:${frontendImageDigest}'
          resources: {
            cpu: json(frontendCpu)
            memory: frontendMemory
          }
        }
      ]
      // Optional replica scaling/probe configuration intentionally omitted.
    }
  }
}

output environmentId string = environment.id
output frontendFqdn string = frontend.properties.configuration.ingress.fqdn
