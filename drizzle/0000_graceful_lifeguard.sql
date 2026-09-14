CREATE TABLE `app_sessions` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`connection_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `capacity_lanes` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`name` text NOT NULL,
	`weekly_allocation` integer NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "capacity_lanes_allocation_nonnegative" CHECK("capacity_lanes"."weekly_allocation" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `capacity_lanes_plan_name_unique` ON `capacity_lanes` (`plan_id`,`name`);--> statement-breakpoint
CREATE TABLE `connections` (
	`id` text PRIMARY KEY NOT NULL,
	`linear_user_id` text NOT NULL,
	`linear_user_name` text DEFAULT '' NOT NULL,
	`workspace_id` text NOT NULL,
	`workspace_name` text NOT NULL,
	`access_token_ciphertext` text NOT NULL,
	`refresh_token_ciphertext` text NOT NULL,
	`expires_at` integer NOT NULL,
	`granted_scope` text NOT NULL,
	`reconnect_required` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connections_workspace_unique` ON `connections` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `forecast_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`forecast_id` text NOT NULL,
	`actor` text NOT NULL,
	`category` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	`unrefined_low` integer NOT NULL,
	`unrefined_expected` integer NOT NULL,
	`unrefined_high` integer NOT NULL,
	`completed_actual` integer NOT NULL,
	`detailed_open` integer NOT NULL,
	`baseline_lifetime_low` integer NOT NULL,
	`baseline_lifetime_expected` integer NOT NULL,
	`baseline_lifetime_high` integer NOT NULL,
	FOREIGN KEY (`forecast_id`) REFERENCES `forecasts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `forecasts` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`project_linear_id` text NOT NULL,
	`unrefined_low` integer NOT NULL,
	`unrefined_expected` integer NOT NULL,
	`unrefined_high` integer NOT NULL,
	`confidence` text NOT NULL,
	`estimate_basis` text NOT NULL,
	`forecast_as_of_date` text NOT NULL,
	`capacity_lane_id` text,
	`horizon_share` integer NOT NULL,
	`latest_revision_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`capacity_lane_id`) REFERENCES `capacity_lanes`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "forecasts_low_nonnegative" CHECK("forecasts"."unrefined_low" >= 0),
	CONSTRAINT "forecasts_range_order" CHECK("forecasts"."unrefined_low" <= "forecasts"."unrefined_expected" AND "forecasts"."unrefined_expected" <= "forecasts"."unrefined_high"),
	CONSTRAINT "forecasts_horizon_share" CHECK("forecasts"."horizon_share" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `forecasts_plan_project_unique` ON `forecasts` (`plan_id`,`project_linear_id`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`correlation_hash` text PRIMARY KEY NOT NULL,
	`state_hash` text NOT NULL,
	`verifier_ciphertext` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_states_state_hash_unique` ON `oauth_states` (`state_hash`);--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`name` text NOT NULL,
	`workspace_id` text NOT NULL,
	`team_id` text NOT NULL,
	`membership_label_id` text NOT NULL,
	`commitment_status_id` text NOT NULL,
	`horizon_weeks` integer NOT NULL,
	`weekly_capacity` integer NOT NULL,
	`capacity_effective_date` text NOT NULL,
	`refinement_lead_time_days` integer NOT NULL,
	`current_generation_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "plans_horizon_positive" CHECK("plans"."horizon_weeks" > 0),
	CONSTRAINT "plans_capacity_nonnegative" CHECK("plans"."weekly_capacity" >= 0),
	CONSTRAINT "plans_lead_time_nonnegative" CHECK("plans"."refinement_lead_time_days" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plans_connection_name_unique` ON `plans` (`connection_id`,`name`);--> statement-breakpoint
CREATE TABLE `project_aggregates` (
	`generation_id` text NOT NULL,
	`project_linear_id` text NOT NULL,
	`completed_actual` integer NOT NULL,
	`detailed_open` integer NOT NULL,
	`unestimated_open_count` integer NOT NULL,
	`possible_double_counting` integer NOT NULL,
	PRIMARY KEY(`generation_id`, `project_linear_id`),
	FOREIGN KEY (`generation_id`) REFERENCES `sync_generations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generation_id`,`project_linear_id`) REFERENCES `source_projects`(`generation_id`,`linear_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `source_issues` (
	`generation_id` text NOT NULL,
	`linear_id` text NOT NULL,
	`project_linear_id` text NOT NULL,
	`parent_linear_id` text,
	`estimate` integer,
	`state` text NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`generation_id`, `linear_id`),
	FOREIGN KEY (`generation_id`) REFERENCES `sync_generations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generation_id`,`project_linear_id`) REFERENCES `source_projects`(`generation_id`,`linear_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "source_issues_estimate_nonnegative" CHECK("source_issues"."estimate" IS NULL OR "source_issues"."estimate" >= 0)
);
--> statement-breakpoint
CREATE INDEX `source_issues_generation_project_idx` ON `source_issues` (`generation_id`,`project_linear_id`);--> statement-breakpoint
CREATE TABLE `source_labels` (
	`generation_id` text NOT NULL,
	`linear_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`generation_id`, `linear_id`),
	FOREIGN KEY (`generation_id`) REFERENCES `sync_generations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `source_project_labels` (
	`generation_id` text NOT NULL,
	`project_linear_id` text NOT NULL,
	`label_linear_id` text NOT NULL,
	PRIMARY KEY(`generation_id`, `project_linear_id`, `label_linear_id`),
	FOREIGN KEY (`generation_id`,`project_linear_id`) REFERENCES `source_projects`(`generation_id`,`linear_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generation_id`,`label_linear_id`) REFERENCES `source_labels`(`generation_id`,`linear_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `source_project_teams` (
	`generation_id` text NOT NULL,
	`project_linear_id` text NOT NULL,
	`team_linear_id` text NOT NULL,
	PRIMARY KEY(`generation_id`, `project_linear_id`, `team_linear_id`),
	FOREIGN KEY (`generation_id`,`project_linear_id`) REFERENCES `source_projects`(`generation_id`,`linear_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generation_id`,`team_linear_id`) REFERENCES `source_teams`(`generation_id`,`linear_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `source_projects` (
	`generation_id` text NOT NULL,
	`linear_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`status_id` text,
	`start_date` text,
	`archived` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`generation_id`, `linear_id`),
	FOREIGN KEY (`generation_id`) REFERENCES `sync_generations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generation_id`,`status_id`) REFERENCES `source_statuses`(`generation_id`,`linear_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `source_statuses` (
	`generation_id` text NOT NULL,
	`linear_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`team_id` text,
	`name` text NOT NULL,
	PRIMARY KEY(`generation_id`, `linear_id`),
	FOREIGN KEY (`generation_id`) REFERENCES `sync_generations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generation_id`,`team_id`) REFERENCES `source_teams`(`generation_id`,`linear_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `source_teams` (
	`generation_id` text NOT NULL,
	`linear_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`generation_id`, `linear_id`),
	FOREIGN KEY (`generation_id`) REFERENCES `sync_generations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sync_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`promoted_at` integer,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sync_generations_connection_status_idx` ON `sync_generations` (`connection_id`,`status`);--> statement-breakpoint
CREATE TABLE `sync_leases` (
	`connection_id` text PRIMARY KEY NOT NULL,
	`owner_token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`renewed_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`generation_id` text,
	`trigger` text NOT NULL,
	`mode` text DEFAULT 'full' NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`page_count` integer DEFAULT 0 NOT NULL,
	`record_count` integer DEFAULT 0 NOT NULL,
	`provider_request_count` integer DEFAULT 0 NOT NULL,
	`rate_limit_remaining` integer,
	`rate_limit_reset_at` text,
	`error_class` text,
	`error_summary` text,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generation_id`) REFERENCES `sync_generations`(`id`) ON UPDATE no action ON DELETE set null
);
