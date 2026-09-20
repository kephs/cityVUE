import { ReferenceConfigurationController } from './reference-configuration.controller.js';
import { ReferenceConfigurationService } from './reference-configuration.service.js';
import { InternalRequestMutationsController } from './internal-request-mutations.controller.js';
import { InternalRequestMutationsService } from './internal-request-mutations.service.js';
import { StaffIntakeController } from './staff-intake.controller.js';
import { InternalRequestController } from './internal-request.controller.js';
import { InternalRequestRepository } from './internal-request.repository.js';
import { Module } from '@nestjs/common';
import { CreateServiceRequestService } from './create-service-request.service.js';
import { ServiceRequestController } from './service-request.controller.js';
import { ServiceRequestRepository } from './service-request.repository.js';
import { GetServiceRequestDetailsService } from './get-service-request-details.service.js';
import { ListServiceRequestsService } from './list-service-requests.service.js';
import { LocationEligibilityModule } from '../location-eligibility/location-eligibility.module.js';
import { StaffActionsService } from './staff-actions.service.js';

@Module({
  imports: [LocationEligibilityModule],
  controllers: [
    ReferenceConfigurationController,
    ServiceRequestController,
    StaffIntakeController,
    InternalRequestController,
    InternalRequestMutationsController,
  ],
  providers: [
    ReferenceConfigurationService,
    InternalRequestRepository,
    InternalRequestMutationsService,
    ServiceRequestRepository,
    CreateServiceRequestService,
    GetServiceRequestDetailsService,
    ListServiceRequestsService,
    StaffActionsService,
  ],
  exports: [CreateServiceRequestService, ServiceRequestRepository],
})
export class ServiceRequestModule {}
