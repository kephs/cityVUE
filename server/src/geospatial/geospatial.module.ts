import { Module } from '@nestjs/common';
import { GeospatialAuthorizationService } from './geospatial-authorization.service.js';
import { GeospatialController } from './geospatial.controller.js';
import { GeospatialReadService } from './geospatial-read.service.js';
import { SyntheticGeospatialRepository } from './synthetic-geospatial.repository.js';

@Module({
  controllers: [GeospatialController],
  providers: [
    GeospatialAuthorizationService,
    SyntheticGeospatialRepository,
    {
      provide: GeospatialReadService,
      useFactory: (
        authorization: GeospatialAuthorizationService,
        repository: SyntheticGeospatialRepository,
      ) => new GeospatialReadService(authorization, repository),
      inject: [GeospatialAuthorizationService, SyntheticGeospatialRepository],
    },
  ],
})
export class GeospatialModule {}
