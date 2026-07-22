// Injection token for the shared ioredis Redis client.
// Kept in its own file for the same reason as USERS_CLIENT — avoids
// circular imports between the module and its consumers.
export const REDIS_CLIENT = 'REDIS_CLIENT';
