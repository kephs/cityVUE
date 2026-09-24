import { RequestAnswerController } from './request-answer.controller.js';
import { RequestAnswerService } from './request-answer.service.js';
import { ParticipationService } from './participation.service.js';
import {
  ParticipationAreaController,
  StaffParticipationAreaController,
  ParticipationAnalyticsController,
} from './participation.controller.js';
import { RequesterHistoryController } from './requester-history.controller.js';
import { RequesterHistoryService } from './requester-history.service.js';
import { AttachmentService } from '../attachments/attachment.service.js';
import {
  IntakeAttachmentController,
  StaffAttachmentController,
  AttachmentOriginGuard,
  AttachmentUploadGuard,
  AttachmentPrivacyMiddleware,
} from '../attachments/attachment.controller.js';
import { RequestCommunicationController } from './request-communication.controller.js';
import { RequestTrackingService } from './request-tracking.service.js';
import { RequestTrackingRepository } from './request-tracking.repository.js';
import {
  StaffRequestTrackingController,
  RequesterTrackingController,
  RequestTrackingPrivacyMiddleware,
} from './request-tracking.controller.js';
import { RequestCommunicationService } from './request-communication.service.js';
import { RequestCommunicationRepository } from './request-communication.repository.js';
import { RequestCommunicationPrivacyMiddleware } from './request-communication-privacy.middleware.js';
import { RequestOwnershipController } from './request-ownership.controller.js';
import { RequestOwnershipService } from './request-ownership.service.js';
import { ReferenceConfigurationController } from './reference-configuration.controller.js';
import { ReferenceConfigurationService } from './reference-configuration.service.js';
import { InternalRequestMutationsController } from './internal-request-mutations.controller.js';
import { InternalRequestMutationsService } from './internal-request-mutations.service.js';
import { StaffIntakeController } from './staff-intake.controller.js';
import { InternalRequestController } from './internal-request.controller.js';
import { InternalRequestRepository } from './internal-request.repository.js';
import { StaffRequestController } from './staff-request.controller.js';
import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { PublicRequestContactController } from './public-request-contact.controller.js';
import { RequestContactPrivacyMiddleware } from './request-contact-privacy.middleware.js';
import { RequestContactController } from './request-contact.controller.js';
import { RequestContactService } from './request-contact.service.js';
import { CreateServiceRequestService } from './create-service-request.service.js';
import { ServiceRequestController } from './service-request.controller.js';
import { ServiceRequestRepository } from './service-request.repository.js';
import { GetServiceRequestDetailsService } from './get-service-request-details.service.js';
import { ListServiceRequestsService } from './list-service-requests.service.js';
import { LocationEligibilityModule } from '../location-eligibility/location-eligibility.module.js';
import { StaffActionsService } from './staff-actions.service.js';
import { RequestNoteController } from './request-note.controller.js';
import { RequestNoteService } from './request-note.service.js';
import { RequestNoteRepository } from './request-note.repository.js';
import { RequestNotePrivacyMiddleware } from './request-note-privacy.middleware.js';

@Module({
  imports: [LocationEligibilityModule],
  controllers: [
    RequestAnswerController,
    ParticipationAreaController,
    StaffParticipationAreaController,
    ParticipationAnalyticsController,
    RequesterHistoryController,
    IntakeAttachmentController,
    StaffAttachmentController,
    StaffRequestTrackingController,
    RequesterTrackingController,
    RequestCommunicationController,
    RequestNoteController,
    RequestContactController,
    PublicRequestContactController,
    RequestOwnershipController,
    ReferenceConfigurationController,
    ServiceRequestController,
    StaffIntakeController,
    StaffRequestController,
    InternalRequestController,
    InternalRequestMutationsController,
  ],
  providers: [
    RequestAnswerService,
    ParticipationService,
    RequesterHistoryService,
    AttachmentService,
    AttachmentOriginGuard,
    AttachmentUploadGuard,
    RequestTrackingService,
    RequestTrackingRepository,
    RequestCommunicationService,
    RequestCommunicationRepository,
    RequestNoteService,
    RequestNoteRepository,
    RequestContactService,
    RequestOwnershipService,
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
export class ServiceRequestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(AttachmentPrivacyMiddleware)
      .forRoutes(IntakeAttachmentController, StaffAttachmentController);
    consumer
      .apply(RequestTrackingPrivacyMiddleware)
      .forRoutes(StaffRequestTrackingController, RequesterTrackingController);
    consumer
      .apply(RequestCommunicationPrivacyMiddleware)
      .forRoutes(RequestCommunicationController);
    consumer
      .apply(RequestNotePrivacyMiddleware)
      .forRoutes(RequestNoteController);
    consumer
      .apply(RequestContactPrivacyMiddleware)
      .forRoutes(
        RequestAnswerController,
        RequestContactController,
        PublicRequestContactController,
        RequesterHistoryController,
        ParticipationAnalyticsController,
      );
  }
}
