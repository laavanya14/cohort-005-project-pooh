// One all-or-nothing switch for notifications. With KNOCK_SECRET_KEY set,
// Cadence sends to Knock, and every value below is required: a half-set
// config throws at startup. Without it, everything uses the fake.
//
// To add a required value, add one line to KNOCK_SETTINGS. Mark it `public`
// if the browser needs it; the root loader hands public values to the
// browser (never `VITE_` variables).

const KNOCK_SETTINGS = {
  publicKey: { env: "KNOCK_PUBLIC_KEY", public: true },
  inAppChannelId: { env: "KNOCK_IN_APP_CHANNEL_ID", public: true },
} as const satisfies Record<string, { env: string; public: boolean }>;

type KnockSettingName = keyof typeof KNOCK_SETTINGS;

type PublicSettingName = {
  [K in KnockSettingName]: (typeof KNOCK_SETTINGS)[K]["public"] extends true
    ? K
    : never;
}[KnockSettingName];

export type KnockConfig = { secretKey: string } & Record<
  KnockSettingName,
  string
>;

export type NotificationConfig = { knock: KnockConfig | null };

/** What the browser may see. Never holds the secret key. */
export type PublicNotificationConfig = {
  knock: Pick<KnockConfig, PublicSettingName> | null;
};

const settingNames = Object.keys(KNOCK_SETTINGS) as KnockSettingName[];

/**
 * Reads the notification config from the environment. Throws when
 * KNOCK_SECRET_KEY is set but anything else Knock needs is missing.
 */
export function readNotificationConfig(
  env: Record<string, string | undefined> = process.env
): NotificationConfig {
  const secretKey = env.KNOCK_SECRET_KEY;
  if (!secretKey) return { knock: null };

  const missing = settingNames
    .map((name) => KNOCK_SETTINGS[name].env)
    .filter((envName) => !env[envName]);
  if (missing.length > 0) {
    throw new Error(
      `KNOCK_SECRET_KEY is set, so Cadence sends notifications through Knock, ` +
        `but ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not ` +
        `set. Set ${missing.length === 1 ? "it" : "them"} too, or unset ` +
        `KNOCK_SECRET_KEY to write notifications to .outbox/notifications/.`
    );
  }

  const settings = Object.fromEntries(
    settingNames.map((name) => [name, env[KNOCK_SETTINGS[name].env] ?? ""])
  ) as Record<KnockSettingName, string>;

  return { knock: { secretKey, ...settings } };
}

/** The part of the config the browser needs, for the root loader. */
export function publicNotificationConfig(
  config: NotificationConfig
): PublicNotificationConfig {
  if (!config.knock) return { knock: null };

  const { knock } = config;
  const publicSettings = Object.fromEntries(
    settingNames
      .filter((name) => KNOCK_SETTINGS[name].public)
      .map((name) => [name, knock[name]])
  ) as Pick<KnockConfig, PublicSettingName>;

  return { knock: publicSettings };
}
