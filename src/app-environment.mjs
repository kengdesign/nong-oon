// Only explicitly supported application environments may process media.
export const mediaEnvironment = env => ['staging', 'production'].includes(env.APP_ENV);
