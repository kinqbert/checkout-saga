import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { infraProviders } from "./infra.js";
import {
  NotificationsController,
  NotificationsService,
} from "./notifications/notifications.js";

@Module({
  controllers: [NotificationsController, HealthController],
  providers: [...infraProviders, NotificationsService],
})
export class AppModule {}
