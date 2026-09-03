import { Module } from '@nestjs/common';
import { CreateServiceRequestService } from './create-service-request.service.js';
import { ServiceRequestController } from './service-request.controller.js';
import { ServiceRequestRepository } from './service-request.repository.js';
import { GetServiceRequestDetailsService } from './get-service-request-details.service.js';
import { ListServiceRequestsService } from './list-service-requests.service.js';

@Module({
  controllers: [ServiceRequestController],
  providers: [
    ServiceRequestRepository,
    CreateServiceRequestService,
    GetServiceRequestDetailsService,
    ListServiceRequestsService,
  ],
  exports: [CreateServiceRequestService, ServiceRequestRepository],
})
export class ServiceRequestModule {}
