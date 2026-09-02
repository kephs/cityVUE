import { Module } from '@nestjs/common';
import { CreateServiceRequestService } from './create-service-request.service.js';
import { ServiceRequestController } from './service-request.controller.js';
import { ServiceRequestRepository } from './service-request.repository.js';

@Module({
  controllers: [ServiceRequestController],
  providers: [ServiceRequestRepository, CreateServiceRequestService],
  exports: [CreateServiceRequestService, ServiceRequestRepository],
})
export class ServiceRequestModule {}
