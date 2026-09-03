import { Module } from '@nestjs/common';
import { CreateServiceRequestService } from './create-service-request.service.js';
import { ServiceRequestController } from './service-request.controller.js';
import { ServiceRequestRepository } from './service-request.repository.js';
import { GetServiceRequestDetailsService } from './get-service-request-details.service.js';

@Module({
  controllers: [ServiceRequestController],
  providers: [
    ServiceRequestRepository,
    CreateServiceRequestService,
    GetServiceRequestDetailsService,
  ],
  exports: [CreateServiceRequestService, ServiceRequestRepository],
})
export class ServiceRequestModule {}
