ALTER TABLE "app_settings"
ADD COLUMN "country_restrictions" jsonb DEFAULT '{"version":1,"mode":"allow_list","countries":["TH"],"addressSource":"shipping_only"}'::jsonb NOT NULL;
