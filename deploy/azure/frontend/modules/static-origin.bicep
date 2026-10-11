param location string
param namingPrefix string
param infrastructureSubnetId string
param workloadProfileName string
param workloadProfileType string
param workloadProfileMinimumCount int
param workloadProfileMaximumCount int
param frontendCpu string
param frontendMemory string

@description('Published Reqro image only: <approved-registry>/<reqro-image>@sha256:<64 lowercase hex>; registry and SBOM/vulnerability/publication gates must pass. Not the upstream NGINX base.')
@minLength(74)
param frontendImageReference string

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
  properties: {
    environmentId: environment.id
    workloadProfileName: workloadProfileName
    configuration: {
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
          image: frontendImageReference
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
